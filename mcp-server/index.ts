#!/usr/bin/env node
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
/**
 * Zenborg MCP server — the gardener's voice.
 *
 * Exposes the full CRUD surface + service-level orchestration over the
 * Zenborg vault (JSON collections at `{vaultRoot}/{collection}.json`).
 * See TOOLS.md for the scoped tool inventory.
 *
 * Vault path resolution: --vault CLI > $ZENBORG_HOME > $KAIROS_HOME > ~/.zenborg.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { FenceDeps } from "../src/application/ports.ts";
import {
  clearFences,
  declareBrowserGate,
  declareBrowserTransform,
  declareFence,
  declareHostBlock,
  declareWateringHours,
  fenceReport,
  seedHostBlocks,
} from "../src/application/use-cases/fences.ts";
import { collectResolverHosts, readResolverHealth, syncResolverFences } from "./adapters/adguard.js";
import {
  crossingTally,
  expandHome,
  fenceStore,
  readFencesFile,
} from "./fences.js";
import { buildRelatedHabits } from "./graph.js";
import {
  computeHealth,
  countsAsAllocation,
  daysSinceLast,
  parseVaultDay,
  resolveRhythm,
} from "./health.js";
import { resolveAddMoment } from "./moments.js";
import { type RegistryPerson, selectPeopleToReach } from "./people.js";
import { searchHabits, searchPeople, searchPlaces } from "./search.js";
import { buildTagIndex, buildTagProfile } from "./tags.js";
import {
  areaHasMoments,
  computeCycleCascade,
  countMomentsInPhase,
  deriveRhythmFromSchedule,
  findAreaByIdOrName,
  findCycleByIdOrName,
  findHabitByIdOrName,
  isAllocated,
  isBudgeted,
  isInDeck,
  isSpontaneous,
  normalizeAliases,
  normalizeRefs,
  normalizeSchedule,
  normalizeTags,
  phaseForStartTime,
  requireActiveArea,
  requireActiveHabit,
  schedulePhaseError,
  scheduleRhythmError,
  slugify,
  timingFromSchedule,
  validateMomentTiming,
  validateOneToThreeWords,
  validatePlaceUrl,
  validateRefs,
  withResolvedTimezone,
} from "./validation.js";
import {
  type Area,
  AttitudeSchema,
  CustomMetricSchema,
  type Cycle,
  type CyclePlan,
  clearActiveMoment,
  EntityTypeSchema,
  type Habit,
  logVaultBanner,
  type Moment,
  type Person,
  type Phase,
  type PhaseConfig,
  PhaseSchema,
  type Place,
  type Relationship,
  RelationshipDirectionSchema,
  type Rhythm,
  type Routine,
  type RoutineEntry,
  RhythmSchema,
  readActiveMoment,
  readCollection,
  resolveVault,
  rhythmToCycleBudget,
  type Schedule,
  ScheduleInputSchema,
  StartTimeSchema,
  writeActiveMoment,
  writeCollection,
} from "./vault.js";

// ────────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────────

const vault = resolveVault();
logVaultBanner(vault);
const VAULT_ROOT = vault.root;

// ────────────────────────────────────────────────────────────────────────
// Phase auto-derive
// ────────────────────────────────────────────────────────────────────────

function derivePhaseFromStartTime(startTime: string): Phase | null {
  const phaseConfigs = Object.values(
    readCollection(VAULT_ROOT, "phaseConfigs"),
  ) as PhaseConfig[];
  return phaseForStartTime(startTime, phaseConfigs);
}

// ────────────────────────────────────────────────────────────────────────
// Result helpers + tool wrapper
// ────────────────────────────────────────────────────────────────────────

import { paginate } from "./paging.js";
import {
  conciseArea,
  conciseCycle,
  conciseHabit,
  conciseMoment,
  concisePerson,
  concisePlace,
  conciseRelationship,
  stripNulls,
} from "./serialize.js";
import { defineTool, err, ok, type ToolResult } from "./tooling.js";
import {
  boundaryKey,
  conciseRoutine,
  planMaterialization,
  resolveBoundaries,
  VALID_BOUNDARIES,
  validateRoutine,
} from "./routines.js";
import {
  getSurfaces,
  getAttention,
  getDayTrace,
  mapArea,
  migrateSurfaces,
  resolveWindow,
} from "./attention.js";
import { logDir, readActivityLog } from "./activity-log.js";
import { nightsOf, workoutsOf } from "../src/domain/garmin/BodyLog.ts";
import { parseHabitMap } from "../src/domain/garmin/GarminHabitMap.ts";
import { metricSeries } from "../src/domain/services/MetricTrendService.ts";

function nowIso(): string {
  return new Date().toISOString();
}

// category → tags migration for Person records from older vaults
function migratePerson(p: Person & { category?: string | null }): Person {
  if (!p.tags) {
    const legacy = (p as any).category;
    const migrated = legacy ? normalizeTags([legacy]) : [];
    (p as any).tags = migrated;
  }
  delete (p as any).category;
  return p;
}

// tags field backfill for Place records from older vaults
function migratePlace(p: Place): Place {
  if (!p.tags) (p as any).tags = [];
  return p;
}

function readPeople(): Record<string, Person> {
  const raw = readCollection(VAULT_ROOT, "people");
  let dirty = false;
  for (const p of Object.values(raw)) {
    if ((p as any).category !== undefined) dirty = true;
    migratePerson(p);
  }
  if (dirty) writeCollection(VAULT_ROOT, "people", raw);
  return raw;
}

function readPlaces(): Record<string, Place> {
  const raw = readCollection(VAULT_ROOT, "places");
  for (const p of Object.values(raw)) migratePlace(p);
  return raw;
}

/**
 * Reconciles a habit's schedule with the two fields it overlaps.
 *
 * `rhythm` and `phase` stay stored rather than derived — health, cycle budgets
 * and the (day, phase) grid all read them directly, and phase bands are
 * user-mutable. The schedule *fills* them when absent and *rejects* them when
 * they contradict it. Mirrors `reconcileSchedule` in
 * `src/domain/entities/Habit.ts`.
 */
function reconcileHabitSchedule(
  schedule: Schedule,
  rhythm: Rhythm | undefined,
  phase: Phase | null | undefined,
): { rhythm: Rhythm; phase: Phase | null } | { error: string } {
  const rhythmError = scheduleRhythmError(schedule, rhythm);
  if (rhythmError) {
    return { error: rhythmError };
  }

  const phaseConfigs = Object.values(
    readCollection(VAULT_ROOT, "phaseConfigs"),
  );
  const phaseError = schedulePhaseError(schedule, phase, phaseConfigs);
  if (phaseError) {
    return { error: phaseError };
  }

  return {
    rhythm: rhythm ?? deriveRhythmFromSchedule(schedule),
    phase: phase ?? phaseForStartTime(schedule.startTime, phaseConfigs),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Server
// ────────────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "zenborg-mcp", version: "0.4.0" },
  {
    instructions: `Zenborg is a garden for your attention. The vault at \`${VAULT_ROOT}\` stores the garden state as JSON collections written by the Tauri app.

## Metaphor

Your life is the garden. You are the gardener. Zenborg is the toolshed.

Four gestures: **Plant** (areas, habits, moments, cycles) · **Companion** (people and places, each held with an intention) · **Fence** (fence out the weeds: sites, feeds) · **Tend** (sunrise, sunset, weather, season). The everyday question is "What will I tend to today?". To the gardener, placing a moment is "tending" and removing one is "setting aside"; "pruning" is only the habit attitude, and things fenced out are "weeds".

- **Area** — a plot of the garden (a life domain you cultivate)
- **Habit** — a perennial (a recurring moment template, lives inside an area)
- **Moment** — what you plant today (a 1–3 word intention)
- **Cycle** — a season (a time container with an intention)
- **Phase** — time-of-day band (MORNING / AFTERNOON / EVENING / NIGHT)
- **Attitude** — relationship mode: BEGINNING → RETURNING → KEEPING → BUILDING → PUSHING → BEING, plus PRUNING (deliberate taper)
- **Rhythm** — how often (\`{ period, count }\`)
- **Schedule** — *when* on the clock (\`{ weekdays, startTime, durationMin, timezone? }\`), optional; most habits are ambient

## Vault layout

\`areas.json\`, \`habits.json\`, \`cycles.json\`, \`cyclePlans.json\`, \`moments.json\`, \`phaseConfigs.json\`, \`metricLogs.json\`, \`people.json\`, \`places.json\` — each keyed by entity id.

## Typical workflows

1. \`list_areas\` to orient yourself, then \`list_habits\` in an area.
2. \`plan_cycle\` to open a season (pass \`template: "week"\` for a 7-day cycle).
3. \`add_moment\` to plant an intention: pass \`habitId\` to create from a habit, or \`name\` + \`areaId\` for standalone. Add \`day\` to allocate; omit for the drawing board. \`fromPlan: true\` links to the cycle budget.
4. \`search\` to resolve fuzzy entity references before planting.
5. Every tool accepts \`response_format: "concise" | "full"\` (default concise).

## Invariants the MCP enforces

- Moment and habit names are **1–3 words**.
- **No cap on moments per (day, phase).** A phase holds as many moments as you plant. Past 3, \`add_moment\` reports \`dayViewOverflow\` (informative, never a refusal).
- A habit's \`schedule\` (optional) fills \`rhythm\` and \`phase\` when they're absent, and is **rejected** when they contradict it.
- Moments inherit \`startTime\`/\`durationMin\` from their habit's schedule at allocation, and may override either per instance.
- A schedule's \`timezone\` is optional and IANA (\`"America/Sao_Paulo"\`). Absent = **floating**: the clock time means that hour wherever you are, which is right for a run or a sit. Present = **anchored** to a fixed instant, which is right for a remote lesson someone else keeps — the calendar sidecar then fires the event at the correct local hour after you travel. Rewriting a schedule without naming \`timezone\` keeps the stored one; pass \`timezone: null\` to unanchor.
- \`update_habit { archived: true }\` cascade: deletes cycle plans, preserves allocated moments.
- \`archive_habit\` cascade: allocated moments preserved as historical records (orphan via habitId).
- \`delete_cycle\` cascades: deletes all moments scoped to the cycle.
- Active cycle is **derived from dates**, not a mutation. To activate a cycle, move its dates.
`,
  },
);

// ────────────────────────────────────────────────────────────────────────
// AREAS
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "list_areas",
  description:
    "List all areas, sorted by order.",
  schema: {},
  annotations: { readOnlyHint: true },
  concise: (p) => (p as unknown[]).map((a) => conciseArea(a as Area)),
  handler: async () => {
    const areas = readCollection(VAULT_ROOT, "areas");
    const list = Object.values(areas)
      .sort((a, b) => a.order - b.order);
    return ok(list);
  },
});

defineTool(server, {
  name: "get_area",
  description: "Get a single area by id or exact name.",
  schema: { idOrName: z.string() },
  annotations: { readOnlyHint: true },
  concise: (p) => conciseArea(p as Area),
  handler: async ({ idOrName }) => {
    const areas = readCollection(VAULT_ROOT, "areas");
    const area = findAreaByIdOrName(areas, idOrName);
    if (!area) return err(`Area not found or ambiguous: ${idOrName}`);
    return ok(area);
  },
});

defineTool(server, {
  name: "create_area",
  description: "Create a new area (plot of the garden).",
  schema: {
    name: z.string().min(1),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex like #aabbcc"),
    emoji: z.string().min(1),
    order: z.number().int().nonnegative(),
    attitude: AttitudeSchema.nullable().optional(),
    tags: z.array(z.string()).optional(),
  },
  concise: (p) => {
    const d = (p as any).created;
    return { id: d.id, name: d.name, emoji: d.emoji, color: d.color };
  },
  handler: async ({ name, color, emoji, order, attitude, tags }) => {
    const areas = readCollection(VAULT_ROOT, "areas");
    const now = nowIso();
    const area: Area = {
      id: crypto.randomUUID(),
      name: name.trim(),
      color,
      emoji: emoji.trim(),
      isDefault: false,
      order,
      attitude: attitude ?? null,
      tags: normalizeTags(tags),
      createdAt: now,
      updatedAt: now,
    };
    areas[area.id] = area;
    writeCollection(VAULT_ROOT, "areas", areas);
    return ok({ created: area });
  },
});

defineTool(server, {
  name: "update_area",
  description: "Partially update an area. Pass only fields you want to change.",
  schema: {
    idOrName: z.string(),
    name: z.string().min(1).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    emoji: z.string().min(1).optional(),
    order: z.number().int().nonnegative().optional(),
    attitude: AttitudeSchema.nullable().optional(),
    tags: z.array(z.string()).optional(),
    surfaces: z.object({
      paths: z.array(z.string()).optional(),
      hosts: z.array(z.string()).optional(),
      apps: z.array(z.string()).optional(),
    }).optional().describe("Where this area lives: filesystem paths, browser hosts, app names."),
  },
  concise: (p) => conciseArea((p as any).updated),
  handler: async (params) => {
    const { idOrName, ...updates } = params;
    const areas = readCollection(VAULT_ROOT, "areas");
    const area = findAreaByIdOrName(areas, idOrName);
    if (!area) return err(`Area not found or ambiguous: ${idOrName}`);
    const next: Area = {
      ...area,
      ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
      ...(updates.color !== undefined ? { color: updates.color } : {}),
      ...(updates.emoji !== undefined ? { emoji: updates.emoji.trim() } : {}),
      ...(updates.order !== undefined ? { order: updates.order } : {}),
      ...("attitude" in updates ? { attitude: updates.attitude ?? null } : {}),
      ...(updates.tags !== undefined
        ? { tags: normalizeTags(updates.tags) }
        : {}),
      ...(updates.surfaces !== undefined ? { surfaces: updates.surfaces } : {}),
      updatedAt: nowIso(),
    };
    areas[area.id] = next;
    writeCollection(VAULT_ROOT, "areas", areas);
    return ok({ updated: next });
  },
});

defineTool(server, {
  name: "delete_area",
  description:
    "Permanently delete an area. Only allowed if the area has no moments or habits.",
  schema: { idOrName: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ idOrName }) => {
    const areas = readCollection(VAULT_ROOT, "areas");
    const area =
      areas[idOrName] ??
      Object.values(areas).find(
        (a) => a.name.toLowerCase() === idOrName.toLowerCase(),
      );
    if (!area) return err(`Area not found: ${idOrName}`);
    const habits = readCollection(VAULT_ROOT, "habits");
    const areaHabits = Object.values(habits).filter(
      (h) => h.areaId === area.id,
    );
    if (areaHabits.length > 0) {
      return err(
        `Area has ${areaHabits.length} habit(s); cannot delete. Move or delete them first.`,
      );
    }
    const moments = readCollection(VAULT_ROOT, "moments");
    if (areaHasMoments(area.id, moments)) {
      return err(
        `Area has moments; cannot delete. Reassign or delete moments first.`,
      );
    }
    delete areas[area.id];
    writeCollection(VAULT_ROOT, "areas", areas);
    return ok({ deleted: area.id });
  },
});

// ────────────────────────────────────────────────────────────────────────
// HABITS
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "list_habits",
  description:
    'List habits. Filter by areaId, includeArchived, and/or health ("wilting"). Paginated: when `truncated` is true, pass `nextCursor` back with the same filters to continue.',
  schema: {
    areaId: z.string().optional(),
    includeArchived: z.boolean().optional(),
    health: z
      .enum(["wilting"])
      .optional()
      .describe("Filter to habits with this health status."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Page size, default 50."),
    cursor: z
      .string()
      .optional()
      .describe("Opaque cursor from a previous response."),
  },
  annotations: { readOnlyHint: true },
  concise: (p) => {
    const env = p as {
      items: unknown[];
      total: number;
      truncated: boolean;
      nextCursor: string | null;
    };
    return { ...env, items: env.items.map((h) => conciseHabit(h as Habit)) };
  },
  handler: async ({ areaId, includeArchived, health, limit, cursor }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    let list = Object.values(habits)
      .filter((h) => includeArchived || !h.isArchived)
      .filter((h) => (areaId ? h.areaId === areaId : true))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (health === "wilting") {
      const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
      const cycles = readCollection(VAULT_ROOT, "cycles");
      const moments = readCollection(VAULT_ROOT, "moments");
      const momentsArr = Object.values(moments);
      const now = new Date();
      const isoToday = now.toISOString().slice(0, 10);
      list = list.filter((habit) => {
        const activePlan =
          Object.values(cyclePlans).find((p) => {
            if (p.habitId !== habit.id) return false;
            const c = cycles[p.cycleId];
            if (!c) return false;
            return (
              c.startDate <= isoToday && (!c.endDate || c.endDate >= isoToday)
            );
          }) ?? null;
        return computeHealth(habit, activePlan, momentsArr, now) === "wilting";
      });
    }
    try {
      const filter: Record<string, unknown> = {
        areaId,
        includeArchived,
        health,
      };
      return ok(paginate(list, filter, { limit, cursor }));
    } catch (e) {
      return err((e as Error).message);
    }
  },
});

defineTool(server, {
  name: "get_habit",
  description:
    "Get a habit by id or exact name. Includes health, rhythm, and daysSinceLast.",
  schema: { idOrName: z.string() },
  annotations: { readOnlyHint: true },
  concise: (p) => {
    const d = p as Record<string, unknown>;
    const out = conciseHabit(d.habit as Habit);
    out.health = d.health;
    out.daysSinceLast = d.daysSinceLast;
    if (d.rhythm) out.effectiveRhythm = d.rhythm;
    return out;
  },
  handler: async ({ idOrName }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    const habit = findHabitByIdOrName(habits, idOrName);
    if (!habit) return err(`Habit not found or ambiguous: ${idOrName}`);
    const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const moments = readCollection(VAULT_ROOT, "moments");
    const now = new Date();
    const isoToday = now.toISOString().slice(0, 10);
    const activePlan =
      Object.values(cyclePlans).find((p) => {
        if (p.habitId !== habit.id) return false;
        const c = cycles[p.cycleId];
        if (!c) return false;
        return c.startDate <= isoToday && (!c.endDate || c.endDate >= isoToday);
      }) ?? null;
    const momentsArr = Object.values(moments);
    return ok({
      habit,
      health: computeHealth(habit, activePlan, momentsArr, now),
      rhythm: resolveRhythm(habit, activePlan),
      daysSinceLast: daysSinceLast(habit.id, momentsArr, now),
    });
  },
});

defineTool(server, {
  name: "create_habit",
  description:
    "Create a habit (perennial) inside an area. Name must be 1–3 words. Pass `schedule` for clock-time commitments (e.g. singing at 09:00 on Mondays); it fills `rhythm` and `phase` when they are absent and is rejected when they contradict it. Omit it for ambient habits. `schedule.timezone` is an optional IANA zone: omit it and the hour floats with wherever you are (a run, a sit); set it to anchor the commitment to a fixed instant (a remote lesson), so travelling shifts the wall clock instead of the appointment.",
  schema: {
    name: z.string(),
    areaId: z.string(),
    order: z.number().int().nonnegative(),
    attitude: AttitudeSchema.nullable().optional(),
    phase: PhaseSchema.nullable().optional(),
    tags: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    emoji: z.string().nullable().optional(),
    description: z.string().max(2000).optional(),
    guidance: z.string().optional(),
    rhythm: RhythmSchema.optional(),
    schedule: ScheduleInputSchema.optional(),
    placeIds: z.array(z.string()).optional(),
    parentHabitId: z.string().optional().describe("ID of the parent habit — makes this a variant (e.g. 'guided meditation' under 'Vipassana')."),
    durationMin: z.number().int().positive().optional().describe("Default duration in minutes for moments spawned from this habit."),
  },
  concise: (p) => conciseHabit((p as any).created),
  handler: async (params) => {
    const nameError = validateOneToThreeWords(params.name, "Habit");
    if (nameError) return err(nameError);

    const areas = readCollection(VAULT_ROOT, "areas");
    const areaCheck = requireActiveArea(areas, params.areaId);
    if (typeof areaCheck === "string") return err(areaCheck);

    const habits = readCollection(VAULT_ROOT, "habits");

    if (params.parentHabitId) {
      const parent = habits[params.parentHabitId];
      if (!parent) return err(`Parent habit not found: ${params.parentHabitId}`);
      if (parent.isArchived) return err("Parent habit is archived.");
      if ((parent as any).parentHabitId) return err("Variants cannot nest — parent is already a variant.");
    }

    let schedule: Schedule | undefined;
    let rhythm = params.rhythm;
    let phase: Phase | null = params.phase ?? null;
    if (params.schedule) {
      const normalized = normalizeSchedule(
        withResolvedTimezone(params.schedule, undefined),
      );
      if ("error" in normalized) return err(normalized.error);
      const reconciled = reconcileHabitSchedule(
        normalized,
        params.rhythm,
        params.phase ?? null,
      );
      if ("error" in reconciled) return err(reconciled.error);
      schedule = normalized;
      rhythm = reconciled.rhythm;
      phase = reconciled.phase;
    }

    const now = nowIso();
    const normalizedAliases = normalizeAliases(params.aliases, params.name);
    const habit: Habit = {
      id: crypto.randomUUID(),
      name: params.name.trim(),
      areaId: params.areaId,
      attitude: params.attitude ?? null,
      phase,
      tags: normalizeTags(params.tags),
      emoji: params.emoji ? params.emoji.trim() : null,
      isArchived: false,
      order: params.order,
      ...(normalizedAliases.length > 0 ? { aliases: normalizedAliases } : {}),
      ...(params.description?.trim()
        ? { description: params.description.trim() }
        : {}),
      ...(params.guidance?.trim() ? { guidance: params.guidance.trim() } : {}),
      ...(rhythm ? { rhythm } : {}),
      ...(schedule ? { schedule } : {}),
      ...(params.placeIds && params.placeIds.length > 0
        ? {
            placeIds: params.placeIds.map(slugify).filter((k) => k.length > 0),
          }
        : {}),
      ...(params.parentHabitId ? { parentHabitId: params.parentHabitId } : {}),
      ...(params.durationMin && params.durationMin > 0 ? { durationMin: params.durationMin } : {}),
      createdAt: now,
      updatedAt: now,
    };
    habits[habit.id] = habit;
    writeCollection(VAULT_ROOT, "habits", habits);
    return ok({ created: habit });
  },
});

defineTool(server, {
  name: "update_habit",
  description:
    "Partially update a habit. Pass `schedule: null` to drop a clock-time commitment. Setting or keeping a schedule re-reconciles `rhythm` and `phase` against it. Rewriting `schedule` without naming `timezone` preserves the anchor already stored — moving the hour never silently unanchors the habit; pass `schedule.timezone: null` to do that deliberately. Set archived: true to archive (cascades: deletes cycle plans; moments preserved). Set archived: false to restore.",
  schema: {
    id: z.string(),
    name: z.string().optional(),
    areaId: z.string().optional(),
    order: z.number().int().nonnegative().optional(),
    attitude: AttitudeSchema.nullable().optional(),
    phase: PhaseSchema.nullable().optional(),
    tags: z.array(z.string()).optional(),
    aliases: z.array(z.string()).nullable().optional(),
    emoji: z.string().nullable().optional(),
    description: z.string().max(2000).optional(),
    guidance: z.string().optional(),
    rhythm: RhythmSchema.nullable().optional(),
    schedule: ScheduleInputSchema.nullable().optional(),
    placeIds: z.array(z.string()).nullable().optional(),
    parentHabitId: z.string().nullable().optional().describe("Set parent habit ID to make this a variant; null to detach."),
    durationMin: z.number().int().positive().nullable().optional().describe("Default duration in minutes; null to clear."),
    archived: z
      .boolean()
      .optional()
      .describe(
        "true to archive (cascades: deletes cycle plans; moments preserved). false to restore.",
      ),
  },
  concise: (p) => conciseHabit((p as any).updated),
  handler: async (params) => {
    const { id, ...updates } = params;
    const habits = readCollection(VAULT_ROOT, "habits");
    const habit = habits[id];
    if (!habit) return err(`Habit not found: ${id}`);

    if (updates.name !== undefined) {
      const nameError = validateOneToThreeWords(updates.name, "Habit");
      if (nameError) return err(nameError);
    }

    if (updates.areaId !== undefined) {
      const areas = readCollection(VAULT_ROOT, "areas");
      const areaCheck = requireActiveArea(areas, updates.areaId);
      if (typeof areaCheck === "string") return err(areaCheck);
    }

    if ("parentHabitId" in updates && updates.parentHabitId !== null) {
      const parent = habits[updates.parentHabitId!];
      if (!parent) return err(`Parent habit not found: ${updates.parentHabitId}`);
      if (parent.isArchived) return err("Parent habit is archived.");
      if ((parent as any).parentHabitId) return err("Variants cannot nest — parent is already a variant.");
      if (updates.parentHabitId === id) return err("A habit cannot be its own parent.");
    }

    const nextName =
      updates.name !== undefined ? updates.name.trim() : habit.name;
    // Hoisted: inside the `else` of `'aliases' in updates` below, TS narrows
    // `updates` to `never`, so it cannot be read there.
    const nameProvided = updates.name !== undefined;

    const next: Habit = {
      ...habit,
      ...(updates.name !== undefined ? { name: nextName } : {}),
      ...(updates.areaId !== undefined ? { areaId: updates.areaId } : {}),
      ...(updates.order !== undefined ? { order: updates.order } : {}),
      ...("attitude" in updates ? { attitude: updates.attitude ?? null } : {}),
      ...("phase" in updates ? { phase: updates.phase ?? null } : {}),
      ...(updates.tags !== undefined
        ? { tags: normalizeTags(updates.tags) }
        : {}),
      ...("emoji" in updates
        ? { emoji: updates.emoji ? updates.emoji.trim() : null }
        : {}),
      ...(updates.description !== undefined
        ? { description: updates.description.trim() }
        : {}),
      ...(updates.guidance !== undefined
        ? { guidance: updates.guidance.trim() }
        : {}),
      updatedAt: nowIso(),
    };
    if ("rhythm" in updates) {
      if (updates.rhythm === null) {
        delete next.rhythm;
      } else if (updates.rhythm !== undefined) {
        next.rhythm = updates.rhythm;
      }
    }
    if ("placeIds" in updates) {
      const keys = (updates.placeIds ?? [])
        .map(slugify)
        .filter((k) => k.length > 0);
      if (keys.length === 0) {
        delete next.placeIds;
      } else {
        next.placeIds = keys;
      }
    }
    if ("parentHabitId" in updates) {
      if (updates.parentHabitId === null) {
        delete next.parentHabitId;
      } else if (updates.parentHabitId) {
        next.parentHabitId = updates.parentHabitId;
      }
    }
    if ("durationMin" in updates) {
      if (updates.durationMin === null) {
        delete next.durationMin;
      } else if (updates.durationMin && updates.durationMin > 0) {
        next.durationMin = updates.durationMin;
      }
    }
    if ("aliases" in updates) {
      const list = updates.aliases === null ? [] : updates.aliases;
      const normalized = normalizeAliases(list, nextName);
      if (normalized.length === 0) {
        delete next.aliases;
      } else {
        next.aliases = normalized;
      }
    } else if (nameProvided && habit.aliases) {
      // Name changed but aliases untouched — re-normalize so an alias that
      // now collides with the new name gets dropped.
      const renormalized = normalizeAliases(habit.aliases, nextName);
      if (renormalized.length === 0) {
        delete next.aliases;
      } else {
        next.aliases = renormalized;
      }
    }
    if ("schedule" in updates) {
      if (updates.schedule === null) {
        delete next.schedule;
      } else if (updates.schedule !== undefined) {
        next.schedule = withResolvedTimezone(updates.schedule, habit.schedule);
      }
    }

    if (next.schedule) {
      const normalized = normalizeSchedule(next.schedule);
      if ("error" in normalized) return err(normalized.error);
      const reconciled = reconcileHabitSchedule(
        normalized,
        next.rhythm,
        next.phase,
      );
      if ("error" in reconciled) return err(reconciled.error);
      next.schedule = normalized;
      next.rhythm = reconciled.rhythm;
      next.phase = reconciled.phase;
    }

    let deletedPlans = 0;
    if (updates.archived !== undefined) {
      next.isArchived = updates.archived;
      if (updates.archived) {
        const plans = readCollection(VAULT_ROOT, "cyclePlans");
        const planIdsToDelete: string[] = [];
        for (const p of Object.values(plans)) {
          if (p.habitId === id) planIdsToDelete.push(p.id);
        }
        for (const pId of planIdsToDelete) delete plans[pId];
        deletedPlans = planIdsToDelete.length;
        if (deletedPlans > 0) writeCollection(VAULT_ROOT, "cyclePlans", plans);
      }
    }

    habits[id] = next;
    writeCollection(VAULT_ROOT, "habits", habits);

    return ok({
      updated: next,
      ...(deletedPlans > 0 ? { deletedPlans } : {}),
    });
  },
});

defineTool(server, {
  name: "archive_habit",
  description:
    "DEPRECATED — use update_habit { archived: true } instead. Archive a habit. Cascades: deletes all cycle plans for this habit.",
  schema: { id: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ id }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    const habit = habits[id];
    if (!habit) return err(`Habit not found: ${id}`);

    const plans = readCollection(VAULT_ROOT, "cyclePlans");
    const planIdsToDelete: string[] = [];
    for (const p of Object.values(plans)) {
      if (p.habitId === id) planIdsToDelete.push(p.id);
    }
    for (const pId of planIdsToDelete) delete plans[pId];
    habits[id] = { ...habit, isArchived: true, updatedAt: nowIso() };

    writeCollection(VAULT_ROOT, "habits", habits);
    writeCollection(VAULT_ROOT, "cyclePlans", plans);

    return ok({
      archived: id,
      deletedPlans: planIdsToDelete.length,
      deprecated: "use update_habit { archived: true }",
    });
  },
});

defineTool(server, {
  name: "unarchive_habit",
  description:
    "DEPRECATED — use update_habit { archived: false } instead. Restore an archived habit.",
  schema: { id: z.string() },
  handler: async ({ id }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    const habit = habits[id];
    if (!habit) return err(`Habit not found: ${id}`);
    habits[id] = { ...habit, isArchived: false, updatedAt: nowIso() };
    writeCollection(VAULT_ROOT, "habits", habits);
    return ok({
      unarchived: id,
      deprecated: "use update_habit { archived: false }",
    });
  },
});

defineTool(server, {
  name: "get_habit_health",
  description:
    "DEPRECATED — use get_habit instead (includes health in response). Compute health, effective rhythm, and days-since-last-allocation for a habit.",
  schema: { habitId: z.string() },
  annotations: { readOnlyHint: true },
  handler: async ({ habitId }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    const habit = habits[habitId];
    if (!habit) return err(`Habit not found: ${habitId}`);

    const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const moments = readCollection(VAULT_ROOT, "moments");

    const now = new Date();
    const isoToday = now.toISOString().slice(0, 10);

    const activePlan =
      Object.values(cyclePlans).find((p) => {
        if (p.habitId !== habitId) return false;
        const c = cycles[p.cycleId];
        if (!c) return false;
        return c.startDate <= isoToday && (!c.endDate || c.endDate >= isoToday);
      }) ?? null;

    const momentsArr = Object.values(moments);
    const health = computeHealth(habit, activePlan, momentsArr, now);

    return ok({
      habitId,
      health,
      rhythm: resolveRhythm(habit, activePlan),
      daysSinceLast: daysSinceLast(habitId, momentsArr, now),
      deprecated: "use get_habit",
    });
  },
});

defineTool(server, {
  name: "list_wilting_habits",
  description:
    'DEPRECATED — use list_habits { health: "wilting" } instead. List habits whose current health is "wilting".',
  schema: {
    areaId: z.string().optional(),
    attitude: AttitudeSchema.optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ areaId, attitude }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const moments = readCollection(VAULT_ROOT, "moments");
    const momentsArr = Object.values(moments);
    const now = new Date();
    const isoToday = now.toISOString().slice(0, 10);

    const results: Array<{
      habitId: string;
      habitName: string;
      areaId: string;
      attitude: Habit["attitude"];
      rhythm: ReturnType<typeof resolveRhythm>;
      daysSinceLast: number | null;
    }> = [];

    for (const habit of Object.values(habits)) {
      if (habit.isArchived) continue;
      if (areaId && habit.areaId !== areaId) continue;
      if (attitude && habit.attitude !== attitude) continue;

      const activePlan =
        Object.values(cyclePlans).find((p) => {
          if (p.habitId !== habit.id) return false;
          const c = cycles[p.cycleId];
          if (!c) return false;
          return (
            c.startDate <= isoToday && (!c.endDate || c.endDate >= isoToday)
          );
        }) ?? null;

      const health = computeHealth(habit, activePlan, momentsArr, now);
      if (health !== "wilting") continue;

      results.push({
        habitId: habit.id,
        habitName: habit.name,
        areaId: habit.areaId,
        attitude: habit.attitude,
        rhythm: resolveRhythm(habit, activePlan),
        daysSinceLast: daysSinceLast(habit.id, momentsArr, now),
      });
    }

    return ok(results);
  },
});

defineTool(server, {
  name: "list_people_to_reach",
  description:
    "The outreach queue: people who have gone quiet past their declared cadence (weekly | monthly | quarterly | yearly, a registry fact) and have nothing already arranged. Ordered by `overdueRatio` (days-since divided by the cadence bucket, so 2.86 means nearly three buckets of silence), NOT by raw elapsed days — a weekly friend at 20 days outranks a yearly one at 400. Never-contacted people come first. Rows carry entity keys, not names: the registry owns display names, so render the key. Until wake exposes its key-resolve tool the registry is empty and the queue is an empty list — normal, not an error. Filter by `tag` (friend, family, lover, colleague), or by `far` — whether they are based somewhere other than where the current cycle is being lived. Every row carries `far`; `null` means unknown, either because the registry has no base place for them or because the season states none, and nobody is ever dropped by a distance that could not be checked.",
  schema: {
    tag: z.string().optional(),
    limit: z.number().int().positive().optional(),
    far: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ tag, limit, far }) => {
    const people = readPeople();
    const places = readPlaces();
    const rels = Object.values(readCollection(VAULT_ROOT, "relationships"));
    const basePlaceMap = buildBasePlaceKeyMap(rels, people, places);
    const registryPeople: RegistryPerson[] = Object.values(people).filter((p) => !p.isArchived).map((p) => ({
      key: p.key,
      cadence: p.cadence,
      tags: p.tags,
      favorite: false,
      basePlace: basePlaceMap.get(p.id) ?? p.basePlace,
    }));
    const moments = Object.values(readCollection(VAULT_ROOT, "moments"));
    return ok(
      selectPeopleToReach(registryPeople, moments, new Date(), {
        tag,
        limit,
        here: currentPlaceIds(),
        ...(far !== undefined ? { far } : {}),
      }),
    );
  },
});

// ────────────────────────────────────────────────────────────────────────
// PEOPLE
// ────────────────────────────────────────────────────────────────────────

const CadenceSchema = z.enum(["weekly", "monthly", "quarterly", "yearly"]);

defineTool(server, {
  name: "list_people",
  description: "List all people in the registry. Filter by tag. Archived people are hidden by default; pass includeArchived=true to show them.",
  schema: {
    tag: z.string().optional(),
    includeArchived: z.boolean().optional().describe("Include archived people (default false)"),
  },
  annotations: { readOnlyHint: true },
  concise: (p) => (p as unknown[]).map((x) => concisePerson(x as Person)),
  handler: async ({ tag, includeArchived }) => {
    let list = Object.values(readPeople());
    if (!includeArchived) list = list.filter((p) => !p.isArchived);
    if (tag) list = list.filter((p) => p.tags.includes(tag));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return ok(list);
  },
});

defineTool(server, {
  name: "get_person",
  description: "Get a person by id or key.",
  schema: { idOrKey: z.string() },
  annotations: { readOnlyHint: true },
  concise: (p) => concisePerson(p as Person),
  handler: async ({ idOrKey }) => {
    const people = readPeople();
    const person =
      people[idOrKey] ?? Object.values(people).find((p) => p.key === idOrKey);
    if (!person) return err(`Person not found: ${idOrKey}`);
    return ok(person);
  },
});

defineTool(server, {
  name: "create_person",
  description:
    'Add a person to the registry. `name` is the display name (e.g. "Elias"); `key` is derived via slugify if omitted. `aliases` are nicknames or relational terms (e.g. ["mom", "mama"]). `cadence` sets the outreach rhythm (weekly | monthly | quarterly | yearly). `tags` classify the person (e.g. ["friend"], ["family", "paris"]). `basePlace` is a place key — creates a "based-in" relationship to the matching place entity.',
  schema: {
    name: z.string(),
    key: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    cadence: CadenceSchema.nullable().optional(),
    tags: z.array(z.string()).optional(),
    basePlace: z.string().nullable().optional(),
    emoji: z.string().nullable().optional(),
    isSelf: z.boolean().optional(),
  },
  concise: (p) => concisePerson((p as any).created),
  handler: async (params) => {
    const people = readPeople();
    const key = params.key ? slugify(params.key) : slugify(params.name);
    if (!key) return err("Name produces an empty key");
    const existing = Object.values(people).find((p) => p.key === key);
    if (existing)
      return err(`Person with key "${key}" already exists: ${existing.id}`);
    if (params.isSelf) {
      const selfExists = Object.values(people).find((p) => p.isSelf);
      if (selfExists)
        return err(
          `A self person already exists: ${selfExists.name} (${selfExists.id})`,
        );
    }
    const id = crypto.randomUUID();
    const now = nowIso();
    const normalized = normalizeAliases(params.aliases, params.name);
    const person: Person = {
      id,
      name: params.name,
      key,
      ...(normalized.length > 0 ? { aliases: normalized } : {}),
      cadence: params.cadence ?? null,
      tags: normalizeTags(params.tags ?? []),
      basePlace: null,
      emoji: params.emoji ?? null,
      isArchived: false,
      ...(params.isSelf ? { isSelf: true } : {}),
      createdAt: now,
      updatedAt: now,
    };
    people[id] = person;
    writeCollection(VAULT_ROOT, "people", people);

    if (params.basePlace) {
      const placeKey = slugify(params.basePlace);
      const places = readPlaces();
      const place = Object.values(places).find((p) => p.key === placeKey);
      if (place) {
        const rels = readCollection(VAULT_ROOT, "relationships");
        const relId = crypto.randomUUID();
        rels[relId] = {
          id: relId,
          fromType: "person",
          fromId: id,
          toType: "place",
          toId: place.id,
          label: BASED_IN_LABEL,
          direction: "directed" as const,
          createdAt: now,
          updatedAt: now,
        };
        writeCollection(VAULT_ROOT, "relationships", rels);
      }
    }

    return ok({ created: person });
  },
});

defineTool(server, {
  name: "update_person",
  description:
    'Update a person by id or key. Only provided fields are changed. Pass `aliases` to set nicknames (e.g. ["mom", "mama"]); pass `[]` to clear. Pass `tags` to set classification (e.g. ["friend"]); pass `[]` to clear. Set archived: true to archive, archived: false to restore.',
  schema: {
    idOrKey: z.string(),
    name: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    cadence: CadenceSchema.nullable().optional(),
    tags: z.array(z.string()).optional(),
    basePlace: z.string().nullable().optional(),
    emoji: z.string().nullable().optional(),
    isSelf: z.boolean().optional(),
    archived: z.boolean().optional().describe("true to archive, false to restore"),
  },
  concise: (p) => concisePerson((p as any).updated),
  handler: async ({ idOrKey, ...updates }) => {
    const people = readPeople();
    const id =
      people[idOrKey]?.id ??
      Object.values(people).find((p) => p.key === idOrKey)?.id;
    if (!id) return err(`Person not found: ${idOrKey}`);
    const person = { ...people[id] };
    if ("name" in updates && updates.name !== undefined) {
      person.name = updates.name;
      person.key = slugify(updates.name);
    }
    if ("aliases" in updates) {
      const normalized = normalizeAliases(updates.aliases, person.name);
      if (normalized.length === 0) {
        delete person.aliases;
      } else {
        person.aliases = normalized;
      }
    } else if (person.aliases && updates.name) {
      const renormalized = normalizeAliases(person.aliases, person.name);
      if (renormalized.length === 0) {
        delete person.aliases;
      } else {
        person.aliases = renormalized;
      }
    }
    if ("cadence" in updates) person.cadence = updates.cadence ?? null;
    if ("tags" in updates) person.tags = normalizeTags(updates.tags ?? []);
    if ("basePlace" in updates) {
      person.basePlace = null;
      const rels = readCollection(VAULT_ROOT, "relationships");
      const existingRel = Object.values(rels).find(
        (r) =>
          r.label === BASED_IN_LABEL &&
          ((r.fromType === "person" && r.fromId === id && r.toType === "place") ||
           (r.toType === "person" && r.toId === id && r.fromType === "place" && r.direction === "mutual")),
      );
      if (existingRel) delete rels[existingRel.id];
      if (updates.basePlace) {
        const placeKey = slugify(updates.basePlace);
        const places = readPlaces();
        const place = Object.values(places).find((p) => p.key === placeKey);
        if (place) {
          const relId = crypto.randomUUID();
          rels[relId] = {
            id: relId,
            fromType: "person",
            fromId: id,
            toType: "place",
            toId: place.id,
            label: BASED_IN_LABEL,
            direction: "directed" as const,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
        }
      }
      writeCollection(VAULT_ROOT, "relationships", rels);
    }
    if ("emoji" in updates) person.emoji = updates.emoji ?? null;
    if (updates.archived !== undefined) person.isArchived = updates.archived;
    if ("isSelf" in updates && updates.isSelf !== undefined) {
      if (updates.isSelf) {
        const selfExists = Object.values(people).find(
          (p) => p.isSelf && p.id !== id,
        );
        if (selfExists)
          return err(
            `Another person is already self: ${selfExists.name} (${selfExists.id})`,
          );
      }
      person.isSelf = updates.isSelf;
    }
    person.updatedAt = nowIso();
    people[id] = person;
    writeCollection(VAULT_ROOT, "people", people);
    return ok({ updated: person });
  },
});

defineTool(server, {
  name: "delete_person",
  description:
    "Remove a person from the registry. Does NOT remove their key from existing moments.",
  schema: { idOrKey: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ idOrKey }) => {
    const people = readPeople();
    const id =
      people[idOrKey]?.id ??
      Object.values(people).find((p) => p.key === idOrKey)?.id;
    if (!id) return err(`Person not found: ${idOrKey}`);
    const removed = people[id];
    delete people[id];
    writeCollection(VAULT_ROOT, "people", people);
    return ok({ deleted: removed });
  },
});

// ────────────────────────────────────────────────────────────────────────
// PLACES
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "list_places",
  description: "List all places in the registry. Archived places are hidden by default; pass includeArchived=true to show them.",
  schema: {
    includeArchived: z.boolean().optional().describe("Include archived places (default false)"),
  },
  annotations: { readOnlyHint: true },
  concise: (p) => (p as unknown[]).map((x) => concisePlace(x as Place)),
  handler: async ({ includeArchived }) => {
    let list = Object.values(readPlaces());
    if (!includeArchived) list = list.filter((p) => !p.isArchived);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return ok(list);
  },
});

defineTool(server, {
  name: "get_place",
  description: "Get a place by id or key.",
  schema: { idOrKey: z.string() },
  annotations: { readOnlyHint: true },
  concise: (p) => concisePlace(p as Place),
  handler: async ({ idOrKey }) => {
    const places = readPlaces();
    const place =
      places[idOrKey] ?? Object.values(places).find((p) => p.key === idOrKey);
    if (!place) return err(`Place not found: ${idOrKey}`);
    return ok(place);
  },
});

defineTool(server, {
  name: "create_place",
  description:
    'Add a place to the registry. `name` is the display name (e.g. "Soho House"); `key` is derived via slugify if omitted. `parentKey` links to a containing place (e.g. "sp" for Sao Paulo). `tags` classify the place (e.g. ["country"], ["city"], ["place"]). `aliases` are alternate names that match when searching (e.g. ["sp", "sampa"] for São Paulo). `address` is a street/postal address for calendar event locations. `coordinates` is `{ lat, lng }` for map pins. `url` is a map link.',
  schema: {
    name: z.string(),
    key: z.string().optional(),
    parentKey: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    address: z.string().nullable().optional(),
    coordinates: z
      .object({ lat: z.number(), lng: z.number() })
      .nullable()
      .optional(),
    emoji: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  },
  concise: (p) => concisePlace((p as any).created),
  handler: async (params) => {
    const places = readPlaces();
    const key = params.key ? slugify(params.key) : slugify(params.name);
    if (!key) return err("Name produces an empty key");
    const existing = Object.values(places).find((p) => p.key === key);
    if (existing)
      return err(`Place with key "${key}" already exists: ${existing.id}`);
    const id = crypto.randomUUID();
    const now = nowIso();
    const normalized = normalizeAliases(params.aliases, params.name);
    const place: Place = {
      id,
      name: params.name,
      key,
      parentKey: params.parentKey ? slugify(params.parentKey) : null,
      tags: normalizeTags(params.tags ?? []),
      ...(normalized.length > 0 ? { aliases: normalized } : {}),
      address: params.address ?? null,
      coordinates: params.coordinates ?? null,
      emoji: params.emoji ?? null,
      url: params.url ?? null,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };
    places[id] = place;
    writeCollection(VAULT_ROOT, "places", places);
    return ok({ created: place });
  },
});

defineTool(server, {
  name: "update_place",
  description: "Update a place by id or key. Only provided fields are changed. Set archived: true to archive, archived: false to restore.",
  schema: {
    idOrKey: z.string(),
    name: z.string().optional(),
    parentKey: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    address: z.string().nullable().optional(),
    coordinates: z
      .object({ lat: z.number(), lng: z.number() })
      .nullable()
      .optional(),
    emoji: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    archived: z.boolean().optional().describe("true to archive, false to restore"),
  },
  concise: (p) => concisePlace((p as any).updated),
  handler: async ({ idOrKey, ...updates }) => {
    const places = readPlaces();
    const id =
      places[idOrKey]?.id ??
      Object.values(places).find((p) => p.key === idOrKey)?.id;
    if (!id) return err(`Place not found: ${idOrKey}`);
    const place = { ...places[id] };
    const nextName = updates.name ?? place.name;
    if ("name" in updates && updates.name !== undefined) {
      place.name = updates.name;
      place.key = slugify(updates.name);
    }
    if ("parentKey" in updates)
      place.parentKey = updates.parentKey ? slugify(updates.parentKey) : null;
    if ("tags" in updates) place.tags = normalizeTags(updates.tags ?? []);
    if ("aliases" in updates) {
      const normalized = normalizeAliases(updates.aliases, nextName);
      if (normalized.length === 0) delete place.aliases;
      else place.aliases = normalized;
    } else if (place.aliases && updates.name) {
      const renormalized = normalizeAliases(place.aliases, nextName);
      if (renormalized.length === 0) delete place.aliases;
      else place.aliases = renormalized;
    }
    if ("address" in updates) place.address = updates.address ?? null;
    if ("coordinates" in updates)
      place.coordinates = updates.coordinates ?? null;
    if ("emoji" in updates) place.emoji = updates.emoji ?? null;
    if ("url" in updates) place.url = updates.url ?? null;
    if (updates.archived !== undefined) place.isArchived = updates.archived;
    place.updatedAt = nowIso();
    places[id] = place;
    writeCollection(VAULT_ROOT, "places", places);
    return ok({ updated: place });
  },
});

defineTool(server, {
  name: "delete_place",
  description:
    "Remove a place from the registry. Does NOT remove its key from existing moments, habits, or cycles.",
  schema: { idOrKey: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ idOrKey }) => {
    const places = readPlaces();
    const id =
      places[idOrKey]?.id ??
      Object.values(places).find((p) => p.key === idOrKey)?.id;
    if (!id) return err(`Place not found: ${idOrKey}`);
    const removed = places[id];
    delete places[id];
    writeCollection(VAULT_ROOT, "places", places);
    return ok({ deleted: removed });
  },
});

// ────────────────────────────────────────────────────────────────────────
// RELATIONSHIPS — authored edges between entities
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "list_relationships",
  description:
    'List all relationships, optionally filtered by entity type, entity id, or label. Pass `entityType` + `entityId` to find all edges touching one entity (both directions for mutual edges). Pass `label` to filter by edge label (e.g. "lives-in").',
  schema: {
    entityType: EntityTypeSchema.optional(),
    entityId: z.string().optional(),
    label: z.string().optional(),
  },
  annotations: { readOnlyHint: true },
  concise: (p) =>
    (p as unknown[]).map((r) => conciseRelationship(r as Relationship)),
  handler: async ({ entityType, entityId, label }) => {
    const rels = Object.values(readCollection(VAULT_ROOT, "relationships"));
    const filtered = rels.filter((r) => {
      if (label && r.label !== label) return false;
      if (entityType && entityId) {
        const matchesFrom = r.fromType === entityType && r.fromId === entityId;
        const matchesTo = r.toType === entityType && r.toId === entityId;
        if (r.direction === "mutual") return matchesFrom || matchesTo;
        return matchesFrom || matchesTo;
      }
      if (entityType) {
        return r.fromType === entityType || r.toType === entityType;
      }
      return true;
    });
    filtered.sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        a.fromType.localeCompare(b.fromType) ||
        a.createdAt.localeCompare(b.createdAt),
    );
    return ok(filtered);
  },
});

defineTool(server, {
  name: "create_relationship",
  description:
    'Create an edge between two entities. `fromType`/`fromId` and `toType`/`toId` identify the endpoints. `label` is a freeform slug (e.g. "mother-of", "lives-in", "trains-at"). `direction` defaults to "mutual".',
  schema: {
    fromType: EntityTypeSchema,
    fromId: z.string(),
    toType: EntityTypeSchema,
    toId: z.string(),
    label: z.string().min(1),
    direction: RelationshipDirectionSchema.optional(),
  },
  concise: (p) => conciseRelationship((p as any).created),
  handler: async (params) => {
    const rels = readCollection(VAULT_ROOT, "relationships");
    const dupe = Object.values(rels).find(
      (r) =>
        r.fromType === params.fromType &&
        r.fromId === params.fromId &&
        r.toType === params.toType &&
        r.toId === params.toId &&
        r.label === params.label,
    );
    if (dupe) return err(`Duplicate relationship: ${dupe.id}`);

    const id = crypto.randomUUID();
    const now = nowIso();
    const rel: Relationship = {
      id,
      fromType: params.fromType,
      fromId: params.fromId,
      toType: params.toType,
      toId: params.toId,
      label: params.label,
      direction: params.direction ?? "mutual",
      createdAt: now,
      updatedAt: now,
    };
    rels[id] = rel;
    writeCollection(VAULT_ROOT, "relationships", rels);
    return ok({ created: rel });
  },
});

defineTool(server, {
  name: "delete_relationship",
  description: "Remove a relationship by id.",
  schema: { id: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ id }) => {
    const rels = readCollection(VAULT_ROOT, "relationships");
    if (!rels[id]) return err(`Relationship not found: ${id}`);
    const removed = rels[id];
    delete rels[id];
    writeCollection(VAULT_ROOT, "relationships", rels);
    return ok({ deleted: removed });
  },
});

// ────────────────────────────────────────────────────────────────────────
// ROUTINES — ordered habit sequences at phase boundaries
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "list_routines",
  description:
    "List all routines. Each routine is an ordered sequence of habits that carries the day across a phase boundary.",
  schema: {},
  annotations: { readOnlyHint: true },
  concise: (p) =>
    (p as unknown[]).map((x) => conciseRoutine(x as Routine)),
  handler: async () => {
    const list = Object.values(readCollection(VAULT_ROOT, "routines"));
    list.sort(
      (a, b) =>
        VALID_BOUNDARIES.indexOf(boundaryKey(a)) -
        VALID_BOUNDARIES.indexOf(boundaryKey(b)),
    );
    return ok(list);
  },
});

defineTool(server, {
  name: "get_routine",
  description:
    'Get a routine by id or boundary key (e.g. "NIGHT->MORNING").',
  schema: { idOrBoundary: z.string() },
  annotations: { readOnlyHint: true },
  concise: (p) => conciseRoutine(p as Routine),
  handler: async ({ idOrBoundary }) => {
    const routines = readCollection(VAULT_ROOT, "routines");
    const routine =
      routines[idOrBoundary] ??
      Object.values(routines).find(
        (r) => boundaryKey(r) === idOrBoundary,
      );
    if (!routine) return err(`Routine not found: ${idOrBoundary}`);
    return ok(routine);
  },
});

defineTool(server, {
  name: "create_routine",
  description: `Create a routine — an ordered habit sequence at a phase boundary. One routine per boundary (4 max). Valid boundaries: ${VALID_BOUNDARIES.join(", ")}. Each entry is { habitId, order }.`,
  schema: {
    name: z.string(),
    from: PhaseSchema,
    to: PhaseSchema,
    entries: z.array(
      z.object({ habitId: z.string(), order: z.number().int() }),
    ),
  },
  concise: (p) => conciseRoutine((p as any).created),
  handler: async ({ name, from, to, entries }) => {
    const routines = readCollection(VAULT_ROOT, "routines");
    const habits = readCollection(VAULT_ROOT, "habits");
    const problems = validateRoutine(
      { from, to, entries },
      habits,
      routines,
    );
    if (problems.length > 0) return err(problems.join("; "));
    const id = crypto.randomUUID();
    const now = nowIso();
    const routine: Routine = {
      id,
      name: name.trim(),
      from,
      to,
      entries: [...entries].sort((a, b) => a.order - b.order),
      createdAt: now,
      updatedAt: now,
    };
    routines[id] = routine;
    writeCollection(VAULT_ROOT, "routines", routines);
    return ok({ created: routine });
  },
});

defineTool(server, {
  name: "update_routine",
  description:
    "Update a routine by id or boundary key. Provide `entries` to replace the full entry list. Other fields are patched.",
  schema: {
    idOrBoundary: z.string(),
    name: z.string().optional(),
    from: PhaseSchema.optional(),
    to: PhaseSchema.optional(),
    entries: z
      .array(z.object({ habitId: z.string(), order: z.number().int() }))
      .optional(),
  },
  concise: (p) => conciseRoutine((p as any).updated),
  handler: async ({ idOrBoundary, ...updates }) => {
    const routines = readCollection(VAULT_ROOT, "routines");
    const found =
      routines[idOrBoundary] ??
      Object.values(routines).find(
        (r) => boundaryKey(r) === idOrBoundary,
      );
    if (!found) return err(`Routine not found: ${idOrBoundary}`);
    const habits = readCollection(VAULT_ROOT, "habits");
    const patched = { ...found };
    if (updates.name !== undefined) patched.name = updates.name.trim();
    if (updates.from !== undefined) patched.from = updates.from;
    if (updates.to !== undefined) patched.to = updates.to;
    if (updates.entries !== undefined) {
      patched.entries = [...updates.entries].sort(
        (a, b) => a.order - b.order,
      );
    }
    const problems = validateRoutine(
      { from: patched.from, to: patched.to, entries: patched.entries as RoutineEntry[] },
      habits,
      routines,
      found.id,
    );
    if (problems.length > 0) return err(problems.join("; "));
    patched.updatedAt = nowIso();
    routines[found.id] = patched;
    writeCollection(VAULT_ROOT, "routines", routines);
    return ok({ updated: patched });
  },
});

defineTool(server, {
  name: "delete_routine",
  description: "Remove a routine by id or boundary key.",
  schema: { idOrBoundary: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ idOrBoundary }) => {
    const routines = readCollection(VAULT_ROOT, "routines");
    const found =
      routines[idOrBoundary] ??
      Object.values(routines).find(
        (r) => boundaryKey(r) === idOrBoundary,
      );
    if (!found) return err(`Routine not found: ${idOrBoundary}`);
    delete routines[found.id];
    writeCollection(VAULT_ROOT, "routines", routines);
    return ok({ deleted: found });
  },
});

// ponytail: no daemon — materialization fires when sunrise/sunset skill runs.
// Upgrade path: Rust-side daily tick if skill-driven proves leaky.
defineTool(server, {
  name: "materialize_routine",
  description:
    "Plant moments from a routine's entries into today (or a given day). Idempotent — skips entries whose habit already has a moment on (day, phase). Pass boundary (e.g. 'NIGHT->MORNING') or routineId to materialize one routine; omit both to materialize all routines for the day.",
  schema: {
    boundary: z
      .string()
      .optional()
      .describe("Boundary key, e.g. 'NIGHT->MORNING'."),
    routineId: z.string().optional().describe("Routine id."),
    day: z
      .string()
      .optional()
      .describe("YYYY-MM-DD. Defaults to today."),
  },
  handler: async ({ boundary, routineId, day }) => {
    const routines = readCollection(VAULT_ROOT, "routines");
    const habits = readCollection(VAULT_ROOT, "habits");
    const moments = readCollection(VAULT_ROOT, "moments");
    const targetDay =
      day ?? new Date().toISOString().slice(0, 10);

    let targets: typeof routines[string][];
    if (routineId) {
      const r = routines[routineId];
      if (!r) return err(`Routine not found: ${routineId}`);
      targets = [r];
    } else if (boundary) {
      const r = Object.values(routines).find(
        (r) => boundaryKey(r) === boundary,
      );
      if (!r) return err(`No routine for boundary: ${boundary}`);
      targets = [r];
    } else {
      targets = Object.values(routines);
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const routine of targets) {
      const planned = planMaterialization(
        routine,
        moments,
        habits,
        targetDay,
      );
      for (const p of planned) {
        const result = runAddMoment({
          habitId: p.habitId,
          day: targetDay,
          phase: p.phase,
        });
        if ("err" in result) {
          errors.push(
            `${habits[p.habitId]?.name ?? p.habitId}: ${result.err}`,
          );
        } else {
          moments[result.created.id] = result.created;
          created.push(result.created.name);
        }
      }
      for (const entry of routine.entries) {
        const habit = habits[entry.habitId];
        if (!habit || habit.isArchived) continue;
        if (!planned.some((p) => p.habitId === entry.habitId)) {
          skipped.push(habit.name);
        }
      }
    }

    return ok({
      day: targetDay,
      created,
      skipped,
      ...(errors.length ? { errors } : {}),
    });
  },
  concise: (result) => {
    const r = result as {
      day: string;
      created: string[];
      skipped: string[];
      errors?: string[];
    };
    const parts = [`${r.day}: +${r.created.length} created`];
    if (r.skipped.length) parts.push(`${r.skipped.length} already planted`);
    if (r.errors?.length) parts.push(`${r.errors.length} errors`);
    return parts.join(", ");
  },
});

defineTool(server, {
  name: "get_boundaries",
  description:
    "Return the four phase-boundary transition times for today, derived from phaseConfigs. Pass sleepAnchors (wakeAnchor + onsetAnchor as clock hours) to adjust NIGHT→MORNING and EVENING→NIGHT boundaries with observed sleep data.",
  schema: {
    wakeAnchor: z
      .number()
      .optional()
      .describe("Wake hour from Garmin sleep (e.g. 6.5 = 06:30)."),
    onsetAnchor: z
      .number()
      .optional()
      .describe("Sleep onset hour from Garmin sleep (e.g. 22.5 = 22:30)."),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ wakeAnchor, onsetAnchor }) => {
    const configs = Object.values(
      readCollection(VAULT_ROOT, "phaseConfigs"),
    );
    const anchors =
      wakeAnchor != null && onsetAnchor != null
        ? { wakeAnchor, onsetAnchor }
        : undefined;
    const boundaries = resolveBoundaries(configs, anchors);
    return ok(
      boundaries.map((b) => ({
        boundary: boundaryKey(b),
        hour: b.hour,
        time: `${String(Math.floor(b.hour)).padStart(2, "0")}:${String(Math.round((b.hour % 1) * 60)).padStart(2, "0")}`,
      })),
    );
  },
});

defineTool(server, {
  name: "get_related",
  description:
    "DEPRECATED — use list_relationships { entityType, entityId } instead. Get all entities related to a given entity.",
  schema: {
    entityType: EntityTypeSchema,
    entityId: z.string(),
    label: z.string().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ entityType, entityId, label }) => {
    const rels = Object.values(readCollection(VAULT_ROOT, "relationships"));
    const people = readPeople();
    const places = readPlaces();
    const habits = readCollection(VAULT_ROOT, "habits");
    const areas = readCollection(VAULT_ROOT, "areas");

    function resolveName(type: string, id: string): string | null {
      switch (type) {
        case "person":
          return people[id]?.name ?? null;
        case "place":
          return places[id]?.name ?? null;
        case "habit":
          return habits[id]?.name ?? null;
        case "area":
          return areas[id]?.name ?? null;
        default:
          return null;
      }
    }

    const edges = rels
      .filter((r) => {
        if (label && r.label !== label) return false;
        const matchesFrom = r.fromType === entityType && r.fromId === entityId;
        const matchesTo = r.toType === entityType && r.toId === entityId;
        return matchesFrom || matchesTo;
      })
      .map((r) => {
        const isFrom = r.fromType === entityType && r.fromId === entityId;
        const otherType = isFrom ? r.toType : r.fromType;
        const otherId = isFrom ? r.toId : r.fromId;
        return {
          relationshipId: r.id,
          label: r.label,
          direction: r.direction,
          otherType,
          otherId,
          otherName: resolveName(otherType, otherId),
        };
      });

    return ok({ entityType, entityId, related: edges });
  },
});

// ────────────────────────────────────────────────────────────────────────
// MENTIONS — @-mention people and places on a moment
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "mention",
  description:
    "Mention people and/or places on a moment, like @-tagging. Each name is resolved against the people and places registries by key. Matched people go to `personIds`, matched places go to `placeIds`. Unresolved names are returned so you can create them first. Additive: existing mentions are kept.",
  schema: {
    momentId: z.string(),
    entities: z.array(z.string()),
  },
  handler: async ({ momentId, entities }) => {
    const moments = readCollection(VAULT_ROOT, "moments");
    const moment = moments[momentId];
    if (!moment) return err(`Moment not found: ${momentId}`);

    const people = readPeople();
    const places = readPlaces();
    const peopleByKey = new Map(Object.values(people).map((p) => [p.key, p]));
    const placesByKey = new Map(Object.values(places).map((p) => [p.key, p]));

    const addedPeople: string[] = [];
    const addedPlaces: string[] = [];
    const unresolved: string[] = [];

    const currentPersonIds = new Set(moment.personIds ?? []);
    const currentPlaceIds = new Set(moment.placeIds ?? []);

    for (const raw of entities) {
      const key = slugify(raw);
      if (!key) continue;
      if (peopleByKey.has(key)) {
        if (!currentPersonIds.has(key)) {
          currentPersonIds.add(key);
          addedPeople.push(key);
        }
      } else if (placesByKey.has(key)) {
        if (!currentPlaceIds.has(key)) {
          currentPlaceIds.add(key);
          addedPlaces.push(key);
        }
      } else {
        unresolved.push(key);
      }
    }

    const next = { ...moment };
    if (currentPersonIds.size > 0) {
      next.personIds = [...currentPersonIds];
    }
    if (currentPlaceIds.size > 0) {
      next.placeIds = [...currentPlaceIds];
    }
    next.updatedAt = nowIso();
    moments[momentId] = next;
    writeCollection(VAULT_ROOT, "moments", moments);

    return ok({
      updated: next,
      addedPeople,
      addedPlaces,
      unresolved,
    });
  },
});

// ────────────────────────────────────────────────────────────────────────
// CYCLES
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "get_cycle_planning_proposals",
  description:
    "Read-only: compute habit proposals for a cycle based on attitude + rhythm + health. Caller decides what to accept.",
  schema: { cycleId: z.string() },
  annotations: { readOnlyHint: true },
  handler: async ({ cycleId }) => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const cycle = cycles[cycleId];
    if (!cycle) return err(`Cycle not found: ${cycleId}`);

    const start = parseVaultDay(cycle.startDate);
    const end = cycle.endDate ? parseVaultDay(cycle.endDate) : new Date();
    const cycleDays = Math.max(
      1,
      Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
    );

    const habits = readCollection(VAULT_ROOT, "habits");
    const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
    const moments = readCollection(VAULT_ROOT, "moments");
    const momentsArr = Object.values(moments);
    const now = new Date();

    const proposals: Array<Record<string, unknown>> = [];
    for (const habit of Object.values(habits)) {
      if (habit.isArchived) continue;
      if (habit.attitude === null) continue;
      if (habit.attitude === "BEING") continue;

      const plan =
        Object.values(cyclePlans).find(
          (p) => p.cycleId === cycleId && p.habitId === habit.id,
        ) ?? null;
      const effectiveRhythm = resolveRhythm(habit, plan);
      const health = computeHealth(habit, plan, momentsArr, now);
      const dsl = daysSinceLast(habit.id, momentsArr, now);

      if (habit.attitude === "BEGINNING") {
        const count = momentsArr.filter((m) => m.habitId === habit.id).length;
        if (count >= 5) continue;
        proposals.push({
          habitId: habit.id,
          habitName: habit.name,
          areaId: habit.areaId,
          attitude: habit.attitude,
          suggestedRhythm: effectiveRhythm,
          suggestedCount: 0,
          reason: "beginning",
          currentHealth: health,
          daysSinceLast: dsl,
        });
        continue;
      }

      if (!effectiveRhythm) continue;

      const suggestedCount = rhythmToCycleBudget(effectiveRhythm, cycleDays);
      let reason:
        | "wilting"
        | "on-rhythm"
        | "beginning"
        | "returning"
        | "pruning";
      if (health === "wilting") {
        reason = "wilting";
      } else if (habit.attitude === "RETURNING") {
        reason = "returning";
      } else if (habit.attitude === "PRUNING") {
        reason = "pruning";
      } else {
        reason = "on-rhythm";
      }
      proposals.push({
        habitId: habit.id,
        habitName: habit.name,
        areaId: habit.areaId,
        attitude: habit.attitude,
        suggestedRhythm: effectiveRhythm,
        suggestedCount,
        reason,
        currentHealth: health,
        daysSinceLast: dsl,
      });
    }

    return ok(proposals);
  },
});

defineTool(server, {
  name: "get_cycle_review",
  description:
    "Read-only: descriptive review of a cycle. No aggregate scores. Observational mirror only.",
  schema: { cycleId: z.string() },
  annotations: { readOnlyHint: true },
  handler: async ({ cycleId }) => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const cycle = cycles[cycleId];
    if (!cycle) return err(`Cycle not found: ${cycleId}`);

    const habitsColl = readCollection(VAULT_ROOT, "habits");
    const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
    const momentsColl = readCollection(VAULT_ROOT, "moments");
    const momentsArr = Object.values(momentsColl);

    const cycleMoments = momentsArr.filter((m) => m.cycleId === cycleId);
    const unplannedMoments = cycleMoments.filter((m) => m.cyclePlanId === null);
    const start = parseVaultDay(cycle.startDate);
    const end = cycle.endDate ? parseVaultDay(cycle.endDate) : new Date();

    const reviewHabits: Array<Record<string, unknown>> = [];
    const plansForCycle = Object.values(cyclePlans).filter(
      (p) => p.cycleId === cycleId,
    );
    for (const plan of plansForCycle) {
      const habit = habitsColl[plan.habitId];
      if (!habit) continue;

      const allocated = cycleMoments.filter(
        (m) =>
          countsAsAllocation(m) && m.habitId === habit.id && m.day !== null,
      );
      const dates = allocated
        .map((m) => (m.day ? parseVaultDay(m.day) : null))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime());

      const first = dates[0] ?? null;
      const last = dates[dates.length - 1] ?? null;
      let longestGap: number | null = null;
      for (let i = 1; i < dates.length; i++) {
        const gap = Math.floor(
          (dates[i].getTime() - dates[i - 1].getTime()) / (24 * 60 * 60 * 1000),
        );
        if (longestGap === null || gap > longestGap) longestGap = gap;
      }

      const priorMoments = momentsArr.filter(
        (m) => m.day !== null && parseVaultDay(m.day) < start,
      );
      const startHealth = computeHealth(habit, plan, priorMoments, start);
      const endHealth = computeHealth(habit, plan, momentsArr, end);

      reviewHabits.push({
        habitId: habit.id,
        habitName: habit.name,
        areaId: habit.areaId,
        attitude: habit.attitude,
        rhythmSnapshot: resolveRhythm(habit, plan),
        budgetedCount: plan.budgetedCount,
        actualCount: allocated.length,
        startHealth,
        endHealth,
        firstAllocation: first ? first.toISOString().slice(0, 10) : null,
        lastAllocation: last ? last.toISOString().slice(0, 10) : null,
        longestGapDays: longestGap,
      });
    }

    return ok({
      cycleId: cycle.id,
      cycleName: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      habits: reviewHabits,
      unplannedMoments,
      totalMoments: cycleMoments.length,
    });
  },
});

// ────────────────────────────────────────────────────────────────────────
// CYCLES
// ────────────────────────────────────────────────────────────────────────

// Date.parse("YYYY-MM-DD") → UTC midnight, but todayMs is local midnight.
// In any timezone east of UTC the cycle "hasn't started yet" for up to 14h.
function parseLocalDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function isCycleActive(cycle: Cycle, todayMs: number): boolean {
  const startMs = parseLocalDate(cycle.startDate);
  if (Number.isNaN(startMs) || startMs > todayMs) return false;
  if (cycle.endDate === null) return true;
  const endMs = parseLocalDate(cycle.endDate);
  return !Number.isNaN(endMs) && endMs >= todayMs;
}

/**
 * Where the season is being lived, as entity keys.
 *
 * A cycle is a stretch of time somewhere, so the current cycle is the smallest
 * container that already knows where "here" is — nothing has to be told twice
 * and nothing has to ask an operating system. Empty when no cycle is running or
 * the running one states no place, and an empty "here" excludes nobody.
 */
const BASED_IN_LABEL = "based-in";

function buildBasePlaceKeyMap(
  rels: Relationship[],
  people: Record<string, Person>,
  places: Record<string, Place>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rels) {
    if (r.label !== BASED_IN_LABEL) continue;
    let personId: string | null = null;
    let placeId: string | null = null;
    if (r.fromType === "person" && r.toType === "place") {
      personId = r.fromId;
      placeId = r.toId;
    } else if (r.toType === "person" && r.fromType === "place" && r.direction === "mutual") {
      personId = r.toId;
      placeId = r.fromId;
    }
    if (personId && placeId && places[placeId]) {
      map.set(personId, places[placeId].key);
    }
  }
  return map;
}

function currentPlaceIds(): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  // Latest-starting active cycle wins, matching how overlapping seasons
  // resolve everywhere else dates are the arbiter.
  const active = Object.values(readCollection(VAULT_ROOT, "cycles"))
    .filter((c) => isCycleActive(c, todayMs))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return active[0]?.placeIds ?? [];
}

defineTool(server, {
  name: "list_cycles",
  description:
    'List cycles. filter: "active"/"current" = contains today (derived from dates), "upcoming" = starts in future, "all" = everything. Default "all".',
  schema: {
    filter: z.enum(["active", "upcoming", "current", "all"]).optional(),
  },
  annotations: { readOnlyHint: true },
  concise: (p) => (p as unknown[]).map((c) => conciseCycle(c as Cycle)),
  handler: async ({ filter = "all" }) => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const list = Object.values(cycles)
      .filter((c) => {
        switch (filter) {
          case "active":
          case "current":
            return isCycleActive(c, todayMs);
          case "upcoming": {
            const start = parseLocalDate(c.startDate);
            return !Number.isNaN(start) && start > todayMs;
          }
          default:
            return true;
        }
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return ok(list);
  },
});

defineTool(server, {
  name: "get_cycle",
  description: "Get a cycle by id or exact name.",
  schema: { idOrName: z.string() },
  annotations: { readOnlyHint: true },
  concise: (p) => conciseCycle(p as Cycle),
  handler: async ({ idOrName }) => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const cycle = findCycleByIdOrName(cycles, idOrName);
    if (!cycle) return err(`Cycle not found or ambiguous: ${idOrName}`);
    return ok(cycle);
  },
});

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

defineTool(server, {
  name: "plan_cycle",
  description:
    'Create a new cycle (season). If startDate is omitted, defaults to today. Pass template ("week"=7d, "month"=28d, "quarter"=90d) OR endDate, not both. If neither, cycle is open-ended.',
  schema: {
    name: z.string().min(1),
    template: z
      .enum(["week", "month", "quarter"])
      .optional()
      .describe(
        'Computes endDate: "week"=7d, "month"=28d, "quarter"=90d from startDate.',
      ),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD")
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD")
      .nullable()
      .optional(),
    intention: z.string().optional(),
    placeIds: z.array(z.string()).optional(),
  },
  concise: (p) => conciseCycle((p as any).created),
  handler: async ({
    name,
    template,
    startDate,
    endDate,
    intention,
    placeIds,
  }) => {
    if (template && endDate !== undefined) {
      return err("pass template or endDate, not both");
    }
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const now = nowIso();
    const resolvedStart = startDate ?? new Date().toISOString().slice(0, 10);
    let resolvedEnd: string | null = endDate ?? null;
    if (template) {
      const days = template === "week" ? 7 : template === "month" ? 28 : 90;
      resolvedEnd = addDays(resolvedStart, days - 1);
    }
    const cycle: Cycle = {
      id: crypto.randomUUID(),
      name: name.trim(),
      startDate: resolvedStart,
      endDate: resolvedEnd,
      ...(intention?.trim() ? { intention: intention.trim() } : {}),
      ...(placeIds && placeIds.length > 0
        ? { placeIds: placeIds.map(slugify).filter((k) => k.length > 0) }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    cycles[cycle.id] = cycle;
    writeCollection(VAULT_ROOT, "cycles", cycles);
    return ok({ created: cycle });
  },
});

defineTool(server, {
  name: "quick_create_cycle",
  description:
    "DEPRECATED — use plan_cycle { template } instead. Shortcut for common cycle templates.",
  schema: {
    name: z.string().min(1),
    template: z.enum(["week", "month", "quarter"]),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    intention: z.string().optional(),
  },
  concise: (p) => conciseCycle((p as any).created),
  handler: async ({ name, template, startDate, intention }) => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const now = nowIso();
    const resolvedStart = startDate ?? new Date().toISOString().slice(0, 10);
    const days = template === "week" ? 7 : template === "month" ? 28 : 90;
    const resolvedEnd = addDays(resolvedStart, days - 1);
    const cycle: Cycle = {
      id: crypto.randomUUID(),
      name: name.trim(),
      startDate: resolvedStart,
      endDate: resolvedEnd,
      ...(intention?.trim() ? { intention: intention.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    };
    cycles[cycle.id] = cycle;
    writeCollection(VAULT_ROOT, "cycles", cycles);
    return ok({
      created: cycle,
      deprecated: "use plan_cycle { template }",
    });
  },
});

defineTool(server, {
  name: "update_cycle",
  description:
    "Partially update a cycle (name, dates, intention, reflection). Writing a reflection here stamps it as a machine draft, so harvest never shows it as the human's own words.",
  schema: {
    id: z.string(),
    name: z.string().min(1).optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    intention: z.string().optional(),
    reflection: z.string().optional(),
    placeIds: z.array(z.string()).nullable().optional(),
  },
  concise: (p) => conciseCycle((p as any).updated),
  handler: async (params) => {
    const { id, ...updates } = params;
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const cycle = cycles[id];
    if (!cycle) return err(`Cycle not found: ${id}`);
    const next: Cycle = {
      ...cycle,
      ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
      ...(updates.startDate !== undefined
        ? { startDate: updates.startDate }
        : {}),
      ...("endDate" in updates ? { endDate: updates.endDate ?? null } : {}),
      ...(updates.intention !== undefined
        ? { intention: updates.intention.trim() }
        : {}),
      ...(updates.reflection !== undefined
        ? { reflection: updates.reflection.trim() }
        : {}),
      // An agent writing a reflection is a machine writing it, whoever asked
      // for it. The stamp records who typed the bytes, not who wanted them —
      // which is what keeps a draft from passing as the person's own words.
      // Only an edit made by hand in the app stamps "human".
      ...(updates.reflection !== undefined
        ? { reflectionSource: "machine" as const }
        : {}),
      updatedAt: nowIso(),
    };
    if ("placeIds" in updates) {
      const keys = (updates.placeIds ?? [])
        .map(slugify)
        .filter((k) => k.length > 0);
      if (keys.length === 0) {
        delete next.placeIds;
      } else {
        next.placeIds = keys;
      }
    }
    cycles[id] = next;
    writeCollection(VAULT_ROOT, "cycles", cycles);
    return ok({ updated: next });
  },
});

defineTool(server, {
  name: "end_cycle",
  description:
    "DEPRECATED — use update_cycle { endDate } instead. Set a cycle's endDate (defaults to today).",
  schema: {
    id: z.string(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  },
  handler: async ({ id, endDate }) => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const cycle = cycles[id];
    if (!cycle) return err(`Cycle not found: ${id}`);
    const next: Cycle = {
      ...cycle,
      endDate: endDate ?? new Date().toISOString().slice(0, 10),
      updatedAt: nowIso(),
    };
    cycles[id] = next;
    writeCollection(VAULT_ROOT, "cycles", cycles);
    return ok({
      ended: id,
      endDate: next.endDate,
      deprecated: "use update_cycle { endDate }",
    });
  },
});

defineTool(server, {
  name: "delete_cycle",
  description:
    "Permanently delete a cycle. Cascades: deletes all moments + cycle plans scoped to this cycle.",
  schema: { id: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ id }) => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const cycle = cycles[id];
    if (!cycle) return err(`Cycle not found: ${id}`);

    const moments = readCollection(VAULT_ROOT, "moments");
    const plans = readCollection(VAULT_ROOT, "cyclePlans");
    const cascade = computeCycleCascade(id, moments, plans);

    for (const mId of cascade.momentIdsToDelete) delete moments[mId];
    for (const pId of cascade.planIdsToDelete) delete plans[pId];
    delete cycles[id];

    writeCollection(VAULT_ROOT, "cycles", cycles);
    writeCollection(VAULT_ROOT, "moments", moments);
    writeCollection(VAULT_ROOT, "cyclePlans", plans);

    return ok({
      deleted: id,
      deletedMoments: cascade.momentIdsToDelete.length,
      deletedPlans: cascade.planIdsToDelete.length,
    });
  },
});

// ────────────────────────────────────────────────────────────────────────
// RUNNING CYCLE (replaces cycle plan CRUD — see pitch 2026-08-24)
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "get_running_cycle",
  description:
    "Orientation snapshot: the active cycle with its intention, elapsed/remaining days, and per-habit health. One tool call instead of stitching list_cycles + list_cycle_plans + list_wilting_habits.",
  schema: {},
  annotations: { readOnlyHint: true },
  handler: async () => {
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const active = Object.values(cycles)
      .filter((c) => isCycleActive(c, todayMs))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));

    if (active.length === 0) {
      return ok({ running: null, message: "No active cycle." });
    }

    const cycle = active[0];
    const startMs = parseLocalDate(cycle.startDate);
    const daysElapsed = Math.floor((todayMs - startMs) / 86_400_000);
    const daysRemaining =
      cycle.endDate !== null
        ? Math.max(
            0,
            Math.floor((parseLocalDate(cycle.endDate) - todayMs) / 86_400_000),
          )
        : null;

    const habits = readCollection(VAULT_ROOT, "habits");
    const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
    const moments = readCollection(VAULT_ROOT, "moments");
    const momentsArr = Object.values(moments);
    const areas = readCollection(VAULT_ROOT, "areas");
    const isoToday = today.toISOString().slice(0, 10);

    const wilting: Array<Record<string, unknown>> = [];
    const habitSnapshots: Array<Record<string, unknown>> = [];

    for (const habit of Object.values(habits)) {
      if (habit.isArchived) continue;
      if (habit.attitude === null) continue;

      const activePlan =
        Object.values(cyclePlans).find((p) => {
          if (p.habitId !== habit.id) return false;
          const c = cycles[p.cycleId];
          if (!c) return false;
          return (
            c.startDate <= isoToday && (!c.endDate || c.endDate >= isoToday)
          );
        }) ?? null;

      const health = computeHealth(habit, activePlan, momentsArr, today);
      const dsl = daysSinceLast(habit.id, momentsArr, today);
      const area = areas[habit.areaId];

      const snapshot = {
        habitId: habit.id,
        habitName: habit.name,
        areaId: habit.areaId,
        areaName: area?.name ?? null,
        attitude: habit.attitude,
        health,
        daysSinceLast: dsl,
        rhythm: resolveRhythm(habit, activePlan),
      };

      habitSnapshots.push(snapshot);
      if (health === "wilting") wilting.push(snapshot);
    }

    return ok({
      running: {
        id: cycle.id,
        name: cycle.name,
        intention: cycle.intention ?? null,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        daysElapsed,
        daysRemaining,
        placeIds: cycle.placeIds ?? [],
      },
      habits: habitSnapshots,
      wilting,
    });
  },
});

// ────────────────────────────────────────────────────────────────────────
// MOMENTS
// ────────────────────────────────────────────────────────────────────────

const MomentAllocationFilter = z.enum([
  "unallocated",
  "deck",
  "allocated",
  "budgeted",
  "spontaneous",
]);

defineTool(server, {
  name: "list_moments",
  description:
    "List moments with optional structured filters. Paginated: when `truncated` is true, pass `nextCursor` back with the same filters to continue. `tags` requires ALL given tags (AND).",
  schema: {
    filter: z
      .object({
        areaId: z.string().optional(),
        habitId: z.string().optional(),
        cycleId: z.string().optional(),
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        phase: PhaseSchema.optional(),
        allocation: MomentAllocationFilter.optional(),
        tags: z.array(z.string()).nonempty().optional(),
      })
      .optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Page size, default 50."),
    cursor: z
      .string()
      .optional()
      .describe("Opaque cursor from a previous response."),
  },
  annotations: { readOnlyHint: true },
  concise: (p) => {
    const env = p as {
      items: unknown[];
      total: number;
      truncated: boolean;
      nextCursor: string | null;
    };
    return { ...env, items: env.items.map((m) => conciseMoment(m as Moment)) };
  },
  handler: async ({ filter, limit, cursor }) => {
    const moments = readCollection(VAULT_ROOT, "moments");
    const wantedTags = filter?.tags ? normalizeTags(filter.tags) : null;
    const PHASE_ORDER: Record<string, number> = {
      MORNING: 0,
      AFTERNOON: 1,
      EVENING: 2,
      NIGHT: 3,
    };
    const list = Object.values(moments).filter((m) => {
      if (!filter) return true;
      if (filter.areaId && m.areaId !== filter.areaId) return false;
      if (filter.habitId && m.habitId !== filter.habitId) return false;
      if (filter.cycleId && m.cycleId !== filter.cycleId) return false;
      if (filter.day && m.day !== filter.day) return false;
      if (filter.phase && m.phase !== filter.phase) return false;
      if (wantedTags && !wantedTags.every((t) => (m.tags ?? []).includes(t)))
        return false;
      if (filter.allocation) {
        switch (filter.allocation) {
          case "unallocated":
            if (!(m.day === null && m.cyclePlanId === null)) return false;
            break;
          case "deck":
            if (!isInDeck(m)) return false;
            break;
          case "allocated":
            if (!isAllocated(m)) return false;
            break;
          case "budgeted":
            if (!isBudgeted(m)) return false;
            break;
          case "spontaneous":
            if (!(isAllocated(m) && isSpontaneous(m))) return false;
            break;
        }
      }
      return true;
    });
    list.sort((a, b) => {
      const aDay = a.day ?? "\xff";
      const bDay = b.day ?? "\xff";
      if (aDay !== bDay) return bDay.localeCompare(aDay);
      const aPhase = PHASE_ORDER[a.phase ?? ""] ?? 99;
      const bPhase = PHASE_ORDER[b.phase ?? ""] ?? 99;
      if (aPhase !== bPhase) return aPhase - bPhase;
      if (a.order !== b.order) return a.order - b.order;
      return a.id.localeCompare(b.id);
    });
    try {
      const filterKey: Record<string, unknown> = filter ?? {};
      return ok(paginate(list, filterKey, { limit, cursor }));
    } catch (e) {
      return err((e as Error).message);
    }
  },
});

defineTool(server, {
  name: "get_moment",
  description: "Get a moment by id.",
  schema: { id: z.string() },
  annotations: { readOnlyHint: true },
  concise: (p) => conciseMoment(p as Moment),
  handler: async ({ id }) => {
    const moments = readCollection(VAULT_ROOT, "moments");
    const moment = moments[id];
    if (!moment) return err(`Moment not found: ${id}`);
    return ok(moment);
  },
});

function buildMoment(params: {
  name: string;
  areaId: string;
  habitId?: string | null;
  cycleId?: string | null;
  cyclePlanId?: string | null;
  phase?: Phase | null;
  day?: string | null;
  order?: number;
  emoji?: string | null;
  tags?: string[] | null;
  personIds?: string[];
  placeIds?: string[];
  placeUrl?: string;
  customMetric?: Moment["customMetric"];
  startTime?: string;
  durationMin?: number;
  refs?: readonly string[];
  status?: "tentative" | "accepted";
}): Moment {
  const now = nowIso();
  const refs = normalizeRefs(params.refs);
  return {
    id: crypto.randomUUID(),
    name: params.name.trim(),
    areaId: params.areaId,
    habitId: params.habitId ?? null,
    cycleId: params.cycleId ?? null,
    cyclePlanId: params.cyclePlanId ?? null,
    phase: params.phase ?? null,
    day: params.day ?? null,
    order: params.order ?? 0,
    ...(params.startTime !== undefined ? { startTime: params.startTime } : {}),
    ...(params.durationMin !== undefined
      ? { durationMin: params.durationMin }
      : {}),
    emoji: params.emoji ?? null,
    tags: normalizeTags(params.tags ?? undefined),
    ...(params.personIds && params.personIds.length > 0
      ? { personIds: params.personIds }
      : {}),
    ...(params.placeIds && params.placeIds.length > 0
      ? { placeIds: params.placeIds.map(slugify).filter((k) => k.length > 0) }
      : {}),
    ...(params.placeUrl !== undefined ? { placeUrl: params.placeUrl } : {}),
    ...(params.customMetric ? { customMetric: params.customMetric } : {}),
    ...(refs.length > 0 ? { refs } : {}),
    ...(params.status !== undefined ? { status: params.status } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The write half of `resolveAddMoment`: persist the moment it resolved.
 *
 * The return type is written out rather than inferred. Inference gives each
 * branch an optional `err?: undefined` / `created?: undefined` counterpart,
 * which defeats `"err" in result` narrowing at the call sites and leaves
 * `result.err` as `string | undefined`. Two disjoint shapes narrow cleanly.
 */
type RunAddMomentResult =
  | { err: string }
  | {
      created: Moment;
      dayViewOverflow?: { count: number };
      wateringHoursAdvisory?: string;
    };

function runAddMoment(
  input: Parameters<typeof resolveAddMoment>[0],
): RunAddMomentResult {
  const areas = readCollection(VAULT_ROOT, "areas");
  const habits = readCollection(VAULT_ROOT, "habits");
  const cycles = readCollection(VAULT_ROOT, "cycles");
  const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
  const moments = readCollection(VAULT_ROOT, "moments");
  const phaseConfigs = readCollection(VAULT_ROOT, "phaseConfigs");
  const result = resolveAddMoment(input, {
    areas,
    habits,
    cycles,
    cyclePlans,
    moments,
    phaseConfigs,
    now: new Date(),
  });
  if (!result.ok) return { err: result.error };
  moments[result.moment.id] = result.moment;
  writeCollection(VAULT_ROOT, "moments", moments);
  const advisory = wateringHoursAdvisory(
    result.moment.areaId,
    result.moment.phase,
  );
  return {
    created: result.moment,
    ...(result.dayViewOverflow
      ? { dayViewOverflow: { count: result.dayViewOverflow } }
      : {}),
    ...(advisory ? { wateringHoursAdvisory: advisory } : {}),
  };
}

defineTool(server, {
  name: "add_moment",
  description:
    "Put an intention on the board. Pass habitId to create from a habit (inherits name/area/emoji/tags/timing), or name + areaId for standalone. Add day to allocate; omit for drawing board. fromPlan: true links to the covering cycle's budget.",
  schema: {
    habitId: z
      .string()
      .optional()
      .describe(
        "Create from this habit. Inherits name, areaId, emoji, tags, schedule timing.",
      ),
    name: z
      .string()
      .optional()
      .describe("Moment name, 1–3 words. Required when habitId is absent."),
    areaId: z
      .string()
      .optional()
      .describe("Required when habitId is absent; override when present."),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Allocate to this day. Omit for drawing-board."),
    phase: PhaseSchema.optional().describe(
      "Required with day unless startTime derives it.",
    ),
    startTime: StartTimeSchema.optional(),
    durationMin: z.number().int().positive().optional(),
    order: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Position in (day, phase) slot. Default: appended."),
    fromPlan: z
      .boolean()
      .optional()
      .describe(
        "Link to covering cycle plan and consume budget. Requires habitId + day.",
      ),
    emoji: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    personIds: z.array(z.string()).optional(),
    placeIds: z.array(z.string()).optional(),
    placeUrl: z.string().optional(),
    customMetric: CustomMetricSchema.optional(),
    refs: z.array(z.string()).optional(),
    status: z.enum(["tentative", "accepted"]).optional(),
  },
  concise: (p) => {
    const d = p as Record<string, unknown>;
    const m = d.created as Moment;
    const out: Record<string, unknown> = conciseMoment(m);
    if (d.dayViewOverflow) out.dayViewOverflow = d.dayViewOverflow;
    if (d.wateringHoursAdvisory)
      out.wateringHoursAdvisory = d.wateringHoursAdvisory;
    if (m.cyclePlanId) {
      out.fromPlan = true;
    }
    return out;
  },
  handler: async (params) => {
    const result = runAddMoment(params);
    if ("err" in result) return err(result.err);
    return ok(result);
  },
});

defineTool(server, {
  name: "create_moment",
  description:
    "DEPRECATED — use add_moment instead. Create an unallocated moment (drawing board).",
  schema: {
    name: z.string(),
    areaId: z.string(),
    phase: PhaseSchema.nullable().optional(),
    emoji: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    personIds: z.array(z.string()).optional(),
    placeIds: z.array(z.string()).optional(),
    placeUrl: z.string().optional(),
    customMetric: CustomMetricSchema.optional(),
    startTime: StartTimeSchema.optional(),
    durationMin: z.number().int().positive().optional(),
    refs: z.array(z.string()).optional(),
    status: z.enum(["tentative", "accepted"]).optional(),
  },
  concise: (p) => conciseMoment((p as any).created),
  handler: async (params) => {
    // This deprecated schema still accepts `phase: null` (the pre-add_moment
    // shape); AddMomentInput has no null there, so drop it rather than widen
    // the input type for a tool on its way out.
    const { phase, ...rest } = params;
    const result = runAddMoment({
      ...rest,
      ...(phase ? { phase } : {}),
    });
    if ("err" in result) return err(result.err);
    return ok({ ...result, deprecated: "use add_moment" });
  },
});

defineTool(server, {
  name: "update_moment",
  description:
    "Partially update a moment. Set `day` to allocate/move; `day: null` returns a spontaneous moment to the drawing board (plan-linked moments must use unallocate_moment). When `startTime` is set (not null), phase is auto-derived from phase configs. `startTime`/`durationMin` override what the moment inherited from its habit schedule; pass null to clear. `refs` replaces the URLs; pass `[]` to clear. `personIds`/`placeIds`/`placeUrl`: pass null or [] to clear, omit to leave alone.",
  schema: {
    id: z.string(),
    name: z.string().optional(),
    areaId: z.string().optional(),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional()
      .describe(
        "Set to allocate/move; null to return a spontaneous moment to the drawing board.",
      ),
    order: z.number().int().nonnegative().optional(),
    emoji: z.string().nullable().optional(),
    phase: PhaseSchema.nullable().optional(),
    tags: z.array(z.string()).optional(),
    personIds: z.array(z.string()).nullable().optional(),
    placeIds: z.array(z.string()).nullable().optional(),
    placeUrl: z.string().nullable().optional(),
    customMetric: CustomMetricSchema.optional(),
    startTime: StartTimeSchema.nullable().optional(),
    durationMin: z.number().int().positive().nullable().optional(),
    refs: z.array(z.string()).optional(),
    status: z.enum(["tentative", "accepted"]).optional(),
  },
  concise: (p) => {
    const d = p as Record<string, unknown>;
    const out: Record<string, unknown> = conciseMoment(d.updated as Moment);
    if (d.wateringHoursAdvisory)
      out.wateringHoursAdvisory = d.wateringHoursAdvisory;
    return out;
  },
  handler: async (params) => {
    const { id, ...updates } = params;
    const moments = readCollection(VAULT_ROOT, "moments");
    const moment = moments[id];
    if (!moment) return err(`Moment not found: ${id}`);

    if (updates.name !== undefined) {
      const nameError = validateOneToThreeWords(updates.name, "Moment");
      if (nameError) return err(nameError);
    }
    if (updates.refs !== undefined) {
      const refsError = validateRefs(updates.refs);
      if (refsError) return err(refsError);
    }
    if (updates.areaId !== undefined) {
      const areas = readCollection(VAULT_ROOT, "areas");
      const areaCheck = requireActiveArea(areas, updates.areaId);
      if (typeof areaCheck === "string") return err(areaCheck);
    }

    const next: Moment = {
      ...moment,
      ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
      ...(updates.areaId !== undefined ? { areaId: updates.areaId } : {}),
      ...("emoji" in updates ? { emoji: updates.emoji ?? null } : {}),
      ...("phase" in updates ? { phase: updates.phase ?? null } : {}),
      ...(updates.tags !== undefined
        ? { tags: normalizeTags(updates.tags) }
        : {}),
      ...(updates.customMetric !== undefined
        ? { customMetric: updates.customMetric }
        : {}),
      ...(updates.startTime ? { startTime: updates.startTime } : {}),
      ...(updates.durationMin ? { durationMin: updates.durationMin } : {}),
      ...(updates.refs !== undefined
        ? { refs: normalizeRefs(updates.refs) }
        : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      updatedAt: nowIso(),
    };
    if (updates.startTime === null) {
      delete next.startTime;
    } else if (updates.startTime) {
      const derived = derivePhaseFromStartTime(updates.startTime);
      if (derived) next.phase = derived;
    }
    if (updates.durationMin === null) {
      delete next.durationMin;
    }
    // An empty replacement clears the field rather than storing `[]`, so
    // "refers to nothing" has exactly one representation.
    if (next.refs !== undefined && next.refs.length === 0) {
      delete next.refs;
    }
    if ("personIds" in updates) {
      // Absent is the single empty representation — the same one `buildMoment`
      // writes — so an empty list clears the key rather than persisting `[]`.
      const list = updates.personIds ?? [];
      if (list.length === 0) {
        delete next.personIds;
      } else {
        next.personIds = list;
      }
    }
    if ("placeIds" in updates) {
      const keys = (updates.placeIds ?? [])
        .map(slugify)
        .filter((k) => k.length > 0);
      if (keys.length === 0) {
        delete next.placeIds;
      } else {
        next.placeIds = keys;
      }
    }
    if ("placeUrl" in updates) {
      const placeUrlError = validatePlaceUrl(updates.placeUrl ?? undefined);
      if (placeUrlError) return err(placeUrlError);
      if (updates.placeUrl === null || updates.placeUrl === undefined) {
        delete next.placeUrl;
      } else {
        next.placeUrl = updates.placeUrl;
      }
    }
    if ("day" in updates) {
      if (updates.day === null) {
        if (moment.cyclePlanId) {
          return err(
            "use unallocate_moment — plan-linked moments are deleted, and the deck ghost reappears",
          );
        }
        next.day = null;
        next.phase = null;
        next.order = 0;
        next.cycleId = null;
      } else if (updates.day !== undefined) {
        next.day = updates.day;
        if (next.startTime) {
          const derived = derivePhaseFromStartTime(next.startTime);
          if (derived) next.phase = derived;
        }
        if (!next.phase) {
          return err(
            "phase is required when allocating — set phase or startTime",
          );
        }
        const allMoments = Object.values(moments);
        next.order =
          updates.order ??
          countMomentsInPhase(allMoments, updates.day, next.phase, id);
        const cycles = readCollection(VAULT_ROOT, "cycles");
        const dayMs = parseLocalDate(updates.day);
        let covCycleId: string | null = null;
        for (const c of Object.values(cycles)) {
          const startMs = parseLocalDate(c.startDate);
          const endMs = c.endDate ? parseLocalDate(c.endDate) : Infinity;
          if (!Number.isNaN(startMs) && dayMs >= startMs && dayMs <= endMs) {
            if (
              !covCycleId ||
              c.startDate > (cycles[covCycleId]?.startDate ?? "")
            ) {
              covCycleId = c.id;
            }
          }
        }
        next.cycleId = covCycleId;
      }
    } else if ("order" in updates && updates.order !== undefined) {
      next.order = updates.order;
    }
    moments[id] = next;
    writeCollection(VAULT_ROOT, "moments", moments);
    const advisory = wateringHoursAdvisory(next.areaId, next.phase);
    return ok({
      updated: next,
      ...(advisory ? { wateringHoursAdvisory: advisory } : {}),
    });
  },
});

defineTool(server, {
  name: "delete_moment",
  description: "Permanently delete a moment.",
  schema: { id: z.string() },
  annotations: { destructiveHint: true },
  handler: async ({ id }) => {
    const moments = readCollection(VAULT_ROOT, "moments");
    if (!moments[id]) return err(`Moment not found: ${id}`);
    delete moments[id];
    writeCollection(VAULT_ROOT, "moments", moments);
    return ok({ deleted: id });
  },
});

defineTool(server, {
  name: "allocate_moment",
  description:
    "DEPRECATED — use update_moment { day, phase } instead. Allocate a moment to a specific (day, phase).",
  schema: {
    id: z.string(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    phase: PhaseSchema.optional(),
    order: z.number().int().nonnegative().optional(),
    startTime: StartTimeSchema.optional(),
    durationMin: z.number().int().positive().optional(),
  },
  concise: (p) => conciseMoment((p as any).allocated),
  handler: async ({
    id,
    day,
    phase: explicitPhase,
    order,
    startTime,
    durationMin,
  }) => {
    const moments = readCollection(VAULT_ROOT, "moments");
    const moment = moments[id];
    if (!moment) return err(`Moment not found: ${id}`);

    const timingError = validateMomentTiming(startTime, durationMin);
    if (timingError) return err(timingError);

    let phase = explicitPhase ?? null;
    if (startTime) {
      const derived = derivePhaseFromStartTime(startTime);
      if (derived) phase = derived;
    }
    if (!phase) return err("phase is required when no startTime is provided");

    const allMoments = Object.values(moments);
    const slotCount = countMomentsInPhase(allMoments, day, phase, id);
    const next: Moment = {
      ...moment,
      day,
      phase,
      order: order ?? slotCount,
      ...(startTime !== undefined ? { startTime } : {}),
      ...(durationMin !== undefined ? { durationMin } : {}),
      updatedAt: nowIso(),
    };
    moments[id] = next;
    writeCollection(VAULT_ROOT, "moments", moments);
    return ok({
      allocated: next,
      deprecated: "use update_moment { day, phase }",
    });
  },
});

defineTool(server, {
  name: "unallocate_moment",
  description:
    "Delete the moment row for a previously-allocated plan-linked moment. Virtual deck ghost reappears automatically as allocatedCount drops. Spontaneous moments (cyclePlanId === null) must use delete_moment instead.",
  schema: { id: z.string() },
  handler: async ({ id }) => {
    const moments = readCollection(VAULT_ROOT, "moments");
    const moment = moments[id];
    if (!moment) return err(`Moment not found: ${id}`);
    if (moment.cyclePlanId === null) {
      return err(
        "Cannot unallocate spontaneous moment; use delete_moment instead",
      );
    }
    delete moments[id];
    writeCollection(VAULT_ROOT, "moments", moments);
    return ok({ unallocated: id });
  },
});

defineTool(server, {
  name: "allocate_from_plan",
  description:
    "DEPRECATED — use add_moment { habitId, day, phase, fromPlan: true } instead. Allocate a deck card into a day/phase slot.",
  schema: {
    cycleId: z.string(),
    habitId: z.string(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    phase: z.enum(["MORNING", "AFTERNOON", "EVENING", "NIGHT"]).optional(),
  },
  concise: (p) => conciseMoment((p as any).created),
  handler: async ({ habitId, day, phase }) => {
    const result = runAddMoment({ habitId, day, phase, fromPlan: true });
    if ("err" in result) return err(result.err);
    return ok({ ...result, deprecated: "use add_moment { fromPlan: true }" });
  },
});

defineTool(server, {
  name: "spawn_spontaneous_from_habit",
  description:
    "DEPRECATED — use add_moment { habitId, day, phase } instead. Create an ad-hoc moment from a habit template.",
  schema: {
    habitId: z.string(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    phase: PhaseSchema.optional(),
    order: z.number().int().nonnegative().optional(),
  },
  concise: (p) => conciseMoment((p as any).created),
  handler: async ({ habitId, day, phase, order }) => {
    const result = runAddMoment({ habitId, day, phase, order });
    if ("err" in result) return err(result.err);
    return ok({ ...result, deprecated: "use add_moment" });
  },
});

defineTool(server, {
  name: "create_standalone_moment",
  description:
    "DEPRECATED — use add_moment { name, areaId, day, phase } instead. Create and allocate an ad-hoc moment.",
  schema: {
    name: z.string(),
    areaId: z.string(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    phase: PhaseSchema.optional(),
    order: z.number().int().nonnegative().optional(),
    emoji: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    personIds: z.array(z.string()).optional(),
    placeIds: z.array(z.string()).optional(),
    placeUrl: z.string().optional(),
    startTime: StartTimeSchema.optional(),
    durationMin: z.number().int().positive().optional(),
    refs: z.array(z.string()).optional(),
  },
  concise: (p) => conciseMoment((p as any).created),
  handler: async (params) => {
    const result = runAddMoment(params);
    if ("err" in result) return err(result.err);
    return ok({ ...result, deprecated: "use add_moment" });
  },
});

// ────────────────────────────────────────────────────────────────────────
// ACTIVE MOMENT — the intention pointer
// ────────────────────────────────────────────────────────────────────────
//
// One moment at a time is "what I'm doing now". Zenborg writes the pointer;
// keel reads it and surfaces it in every Claude Code session. The file contract
// lives in vault.ts.

/**
 * The waking-day key, rolling at 04:00 rather than midnight.
 *
 * Mirrors `focusDayKey` / `DAY_START_HOUR` in keel's `apps/agent/core.mjs` and
 * must stay in lockstep with it: keel honours the pointer only while the moment
 * it names sits on *its* waking-day, so if the two disagreed, a moment set at
 * 02:00 would be written here and silently ignored there.
 */
const DAY_START_HOUR = 4;

function wakingDayKey(now: Date = new Date()): string {
  const rolled = new Date(now.getTime() - DAY_START_HOUR * 3600_000);
  const y = rolled.getFullYear();
  const m = String(rolled.getMonth() + 1).padStart(2, "0");
  const d = String(rolled.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shape the pointer into something a reader can act on without a second call. */
function describeActiveMoment(pointer: { momentId: string; at: string }) {
  const moment = readCollection(VAULT_ROOT, "moments")[pointer.momentId];
  if (!moment) {
    return {
      ...pointer,
      moment: null,
      active: false,
      stale: true,
      reason: "moment no longer exists",
    };
  }
  const area = readCollection(VAULT_ROOT, "areas")[moment.areaId];
  const onToday = moment.day === wakingDayKey();
  return {
    ...pointer,
    moment: {
      id: moment.id,
      name: moment.name,
      day: moment.day,
      phase: moment.phase,
    },
    area: area ? { id: area.id, name: area.name } : null,
    // keel surfaces the intention only while this is true.
    active: onToday,
    ...(onToday
      ? {}
      : {
          stale: true,
          reason: `moment is allocated to ${moment.day}, not today`,
        }),
  };
}

defineTool(server, {
  name: "set_active_moment",
  description:
    "Point the intention at a moment — 'this is what I'm doing now'. Accepts a moment id or name matched against today's board. Pass null to clear (release the intention).",
  schema: {
    momentIdOrName: z
      .string()
      .min(1)
      .nullable()
      .describe("Moment id or name on today's board. null to clear."),
  },
  handler: async ({ momentIdOrName }) => {
    if (momentIdOrName === null) {
      const previous = readActiveMoment(VAULT_ROOT);
      clearActiveMoment(VAULT_ROOT);
      return ok({ cleared: previous ? previous.momentId : null });
    }
    const moments = readCollection(VAULT_ROOT, "moments");
    const today = wakingDayKey();
    const needle = momentIdOrName.trim();

    let moment: Moment | undefined = moments[needle];
    if (!moment) {
      const lower = needle.toLowerCase();
      const todays = Object.values(moments).filter((m) => m.day === today);
      const matches = todays.filter(
        (m) => m.name.trim().toLowerCase() === lower,
      );
      if (matches.length > 1) {
        return err(
          `Ambiguous on today's board: ${matches.length} moments named "${needle}". ` +
            `Pass the id — ${matches.map((m) => m.id).join(", ")}.`,
        );
      }
      moment = matches[0];
      if (!moment) {
        const board = todays.map((m) => `"${m.name}"`).join(", ") || "(empty)";
        return err(`No moment "${needle}" on today's board. Today: ${board}.`);
      }
    }

    if (moment.day !== today) {
      return err(
        `"${moment.name}" is allocated to ${moment.day ?? "no day"}, not today (${today}). ` +
          "The active moment is what you are doing NOW — allocate it to today first.",
      );
    }

    const pointer = writeActiveMoment(VAULT_ROOT, moment.id, nowIso());
    return ok({ set: describeActiveMoment(pointer) });
  },
});

defineTool(server, {
  name: "get_active_moment",
  description:
    "Read the current intention pointer, resolved to its moment and area. Returns null when nothing is active.",
  schema: {},
  annotations: { readOnlyHint: true },
  handler: async () => {
    const pointer = readActiveMoment(VAULT_ROOT);
    if (!pointer) return ok({ active: null });
    return ok({ active: describeActiveMoment(pointer) });
  },
});

defineTool(server, {
  name: "clear_active_moment",
  description:
    "DEPRECATED — use set_active_moment { momentIdOrName: null } instead. Release the intention.",
  schema: {},
  handler: async () => {
    const previous = readActiveMoment(VAULT_ROOT);
    clearActiveMoment(VAULT_ROOT);
    return ok({
      cleared: previous ? previous.momentId : null,
      deprecated: "use set_active_moment { momentIdOrName: null }",
    });
  },
});

// ────────────────────────────────────────────────────────────────────────
// PHASE CONFIGS (Should-have)
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "list_phase_configs",
  description: "List phase configurations, sorted by order.",
  schema: {},
  annotations: { readOnlyHint: true },
  handler: async () => {
    const configs = readCollection(VAULT_ROOT, "phaseConfigs");
    const list = Object.values(configs).sort((a, b) => a.order - b.order);
    return ok(list);
  },
});

defineTool(server, {
  name: "update_phase_config",
  description:
    "Update a phase configuration (label, emoji, color, hours, visibility, order).",
  schema: {
    id: z.string(),
    label: z.string().min(1).optional(),
    emoji: z.string().min(1).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
    isVisible: z.boolean().optional(),
    order: z.number().int().nonnegative().optional(),
  },
  handler: async (params) => {
    const { id, ...updates } = params;
    const configs = readCollection(VAULT_ROOT, "phaseConfigs");
    const config = configs[id];
    if (!config) return err(`Phase config not found: ${id}`);
    const next: PhaseConfig = {
      ...config,
      ...(updates.label !== undefined ? { label: updates.label } : {}),
      ...(updates.emoji !== undefined ? { emoji: updates.emoji } : {}),
      ...(updates.color !== undefined ? { color: updates.color } : {}),
      ...(updates.startHour !== undefined
        ? { startHour: updates.startHour }
        : {}),
      ...(updates.endHour !== undefined ? { endHour: updates.endHour } : {}),
      ...(updates.isVisible !== undefined
        ? { isVisible: updates.isVisible }
        : {}),
      ...(updates.order !== undefined ? { order: updates.order } : {}),
      updatedAt: nowIso(),
    };
    configs[id] = next;
    writeCollection(VAULT_ROOT, "phaseConfigs", configs);
    return ok({ updated: next });
  },
});

// ────────────────────────────────────────────────────────────────────────
// TAGS — derived people/place/theme index (read-side, computed, no storage)
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "list_tags",
  description:
    "The tag index: every tag in use with counts across moments, habits, areas, people and places, plus first/last allocated day. Filter with `prefix` to read any namespace as an index. Sorted by total usage.",
  schema: {
    prefix: z.string().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ prefix }) => {
    const moments = Object.values(readCollection(VAULT_ROOT, "moments"));
    const habits = Object.values(readCollection(VAULT_ROOT, "habits"));
    const areas = Object.values(readCollection(VAULT_ROOT, "areas"));
    const people = Object.values(readPeople());
    const places = Object.values(readPlaces());
    return ok(buildTagIndex(moments, habits, areas, people, places, prefix));
  },
});

defineTool(server, {
  name: "get_tag_profile",
  description:
    'One tag\'s neighbourhood in the garden graph, derived at read time: which habits and areas its moments landed in, which tags co-occur on the same moments, first/last day, and a recent sample. Generic tag aggregation — it never parsed a prefix and does not know what a person or a place is. "What did I do with someone, and where?" is now a question for `personIds` and `placeIds`, which hold references rather than strings.',
  schema: {
    tag: z.string().min(1),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ tag }) => {
    const normalized = normalizeTags([tag])[0];
    if (!normalized)
      return err(
        `Not a valid tag after normalization: "${tag}". Tags are lowercase letters, digits and dashes, max 20 chars — e.g. "person-ada".`,
      );
    const moments = Object.values(readCollection(VAULT_ROOT, "moments"));
    const habits = Object.values(readCollection(VAULT_ROOT, "habits"));
    const areas = Object.values(readCollection(VAULT_ROOT, "areas"));
    return ok(buildTagProfile(normalized, moments, habits, areas));
  },
});

defineTool(server, {
  name: "get_related_habits",
  description:
    "DEPRECATED — use get_tag_profile (includes relatedHabits). A habit's derived edges in the garden graph.",
  schema: {
    habitId: z.string(),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ habitId }) => {
    const habits = Object.values(readCollection(VAULT_ROOT, "habits"));
    const moments = Object.values(readCollection(VAULT_ROOT, "moments"));
    const areas = Object.values(readCollection(VAULT_ROOT, "areas"));
    const related = buildRelatedHabits(habitId, habits, moments, areas);
    if (!related) return err(`Habit not found: ${habitId}`);
    return ok(related);
  },
});

// ────────────────────────────────────────────────────────────────────────
// FUZZY SEARCH — entity resolution for the garden skills plugin
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "search",
  description:
    "Fuzzy-search habits, people, or places by name. Returns matches ranked by confidence (exact > prefix > substring > levenshtein). Use to resolve natural-language entity references. Pass areaId only for habit searches. includeArchived works for all entity types.",
  schema: {
    type: z.enum(["habit", "person", "place"]),
    query: z.string().describe("Name, alias, or approximate spelling"),
    areaId: z.string().optional().describe("habit only: restrict to this area"),
    includeArchived: z
      .boolean()
      .optional()
      .describe("Include archived entities (default false)"),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ type, query, areaId, includeArchived }) => {
    if (type === "habit") {
      const habits = readCollection(VAULT_ROOT, "habits");
      const results = searchHabits(query, habits, { areaId, includeArchived });
      return ok(
        results.map((r) => ({
          habitId: r.habit.id,
          name: r.habit.name,
          areaId: r.habit.areaId,
          emoji: r.habit.emoji,
          attitude: r.habit.attitude,
          aliases: r.habit.aliases ?? [],
          matchedOn: r.matchedOn,
          matchedValue: r.matchedValue,
          matchMethod: r.method,
        })),
      );
    }
    if (type === "person") {
      const people = readPeople();
      const results = searchPeople(query, people, { includeArchived });
      return ok(
        results.map((r) => ({
          personKey: r.person.key,
          name: r.person.name,
          emoji: r.person.emoji,
          tags: r.person.tags,
            matchedOn: r.matchedOn,
          matchedValue: r.matchedValue,
          matchMethod: r.method,
        })),
      );
    }
    const places = readPlaces();
    const results = searchPlaces(query, places, { includeArchived });
    return ok(
      results.map((r) => ({
        placeKey: r.place.key,
        name: r.place.name,
        emoji: r.place.emoji,
        parentKey: r.place.parentKey,
        matchedOn: r.matchedOn,
        matchedValue: r.matchedValue,
        matchMethod: r.method,
      })),
    );
  },
});

defineTool(server, {
  name: "search_habits",
  description:
    "DEPRECATED — use search { type: 'habit' } instead. Fuzzy-search habits by name or alias.",
  schema: {
    query: z
      .string()
      .describe("The habit name, alias, or approximate spelling to search for"),
    areaId: z
      .string()
      .optional()
      .describe("Restrict results to habits in this area"),
    includeArchived: z
      .boolean()
      .optional()
      .describe("Include archived habits in results (default false)"),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ query, areaId, includeArchived }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    const results = searchHabits(query, habits, { areaId, includeArchived });
    return ok(
      results.map((r) => ({
        habitId: r.habit.id,
        name: r.habit.name,
        areaId: r.habit.areaId,
        emoji: r.habit.emoji,
        attitude: r.habit.attitude,
        aliases: r.habit.aliases ?? [],
        matchedOn: r.matchedOn,
        matchedValue: r.matchedValue,
        matchMethod: r.method,
      })),
    );
  },
});

defineTool(server, {
  name: "search_people",
  description:
    "DEPRECATED — use search { type: 'person' } instead. Fuzzy-search people by name or key.",
  schema: {
    query: z
      .string()
      .describe(
        "The person's name, key, or approximate spelling to search for",
      ),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ query }) => {
    const people = readPeople();
    const results = searchPeople(query, people);
    return ok(
      results.map((r) => ({
        personKey: r.person.key,
        name: r.person.name,
        emoji: r.person.emoji,
        tags: r.person.tags,
        matchedOn: r.matchedOn,
        matchedValue: r.matchedValue,
        matchMethod: r.method,
      })),
    );
  },
});

defineTool(server, {
  name: "search_places",
  description:
    "DEPRECATED — use search { type: 'place' } instead. Fuzzy-search places by name, key, or parent key.",
  schema: {
    query: z
      .string()
      .describe("The place name, key, or approximate spelling to search for"),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ query }) => {
    const places = readPlaces();
    const results = searchPlaces(query, places);
    return ok(
      results.map((r) => ({
        placeKey: r.place.key,
        name: r.place.name,
        emoji: r.place.emoji,
        parentKey: r.place.parentKey,
        matchedOn: r.matchedOn,
        matchedValue: r.matchedValue,
        matchMethod: r.method,
      })),
    );
  },
});

// ────────────────────────────────────────────────────────────────────────
// Fences (fences.json) — declared rules only
// ────────────────────────────────────────────────────────────────────────

/**
 * Garden-surface advisory for `add_moment`/`update_moment`: is this area
 * currently inside a declared watering-hours window? Informative only — the
 * garden surface never refuses a planting, it just says so.
 *
 * Fail-soft by design: `readFencesFile` throws on genuinely malformed JSON
 * (it's the writer's read path elsewhere), but a garbled fences.json must
 * never turn a moment write into an error, so every failure here just means
 * no advisory.
 */
function wateringHoursAdvisory(
  areaId: string,
  phase: string | null,
): string | null {
  if (!phase) return null;
  try {
    const fences = readFencesFile(VAULT_ROOT);
    const now = new Date();
    const hour = now.getHours();
    const weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
      now.getDay()
    ];

    for (const rule of Object.values(fences)) {
      if (rule.scope.surface !== "garden") continue;
      if (!rule.scope.areaIds.includes(areaId)) continue;

      for (const prim of rule.primitives) {
        if (prim.kind !== "schedule") continue;
        const w = prim.window as {
          fromHour: number;
          toHour: number;
          weekdays?: string[];
          cutFrom?: string;
        };

        if (
          w.weekdays &&
          w.weekdays.length > 0 &&
          !w.weekdays.includes(weekday)
        ) {
          continue;
        }

        const inWindow =
          w.toHour <= w.fromHour
            ? hour >= w.fromHour || hour < w.toHour
            : hour >= w.fromHour && hour < w.toHour;
        if (!inWindow) continue;

        return `${rule.name}: this area is restricted during ${w.cutFrom || "this window"}`;
      }
    }
  } catch {
    // fail-soft: advisory is never worth an error
  }
  return null;
}

/**
 * The handlers below are thin adapters: construction, validation and the
 * validate-before-write discipline live in `src/application/use-cases/
 * fences.ts` and, below that, `src/domain/intervention/`. What this layer
 * owns is environment: vault I/O (`./fences.ts`), `~` expansion, and reading
 * the garden through the collections it already has open.
 *
 * Per the stamped 2026-08-20 decision, only *declared* rules enter `fences` —
 * every fence written here is built from the caller's arguments, and no code
 * path in this server reads `discrepancy.json`.
 */
const fenceDeps: FenceDeps = {
  store: fenceStore(VAULT_ROOT),
  tally: crossingTally(VAULT_ROOT),
  garden: {
    async areas() {
      return Object.values(readCollection(VAULT_ROOT, "areas"))
        .map((a) => ({ id: a.id, name: a.name }));
    },
    async activeCycleId() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();
      // Latest-starting active cycle wins, matching how overlapping seasons
      // resolve everywhere else dates are the arbiter.
      const active = Object.values(readCollection(VAULT_ROOT, "cycles"))
        .filter((c) => isCycleActive(c, todayMs))
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      return active[0]?.id ?? null;
    },
    async phaseConfigs() {
      const raw = readCollection(VAULT_ROOT, "phaseConfigs");
      return Object.values(raw).map((c: any) => ({
        phase: c.phase,
        startHour: c.startHour,
        endHour: c.endHour,
      }));
    },
  },
  newRuleId: () => crypto.randomUUID(),
};

defineTool(server, {
  name: "set_fence",
  description:
    'Declare a session fence: "only this stream, and friction on anything else". Builds a declared rule (never derived — fences come from what you say here, nothing else) and writes it to the fences collection, which zenborg alone writes. Every rung of the escalation ladder carries an exit; a fence can ask, never deny. Areas may be passed by name ("Themia") or id; paths are absolute prefixes INSIDE the fence (~ expands).',
  schema: {
    label: z
      .string()
      .min(1)
      .describe(
        'What the stream is called — shown back at every crossing, e.g. "Themia data"',
      ),
    paths: z
      .array(z.string().min(1))
      .min(1)
      .describe("Absolute path prefixes the fence encloses"),
    areas: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Areas the fence encloses — names or ids. Attention is expected to return to one of them.",
      ),
    description: z
      .string()
      .optional()
      .describe("Optional: the declaration in the principal's own words"),
  },
  handler: async ({ label, paths, areas, description }) => {
    const result = await declareFence(fenceDeps, {
      label,
      paths: paths.map(expandHome),
      areas,
      description,
    });
    if ("problems" in result) return err(result.problems.join("; "));
    return ok({ declared: result.declared, standing: result.standing });
  },
});

// ── Browser-scoped fences ─────────────────────────────────────────────
//
// `set_fence` above writes a session fence, which the plugin's PreToolUse hook
// reads. The three below write BROWSER-scoped ones, which the extension reads
// out of the fence record the native host pushes. Same collection, same writer,
// same validate-before-write discipline — a different surface.
//
// They exist because migration step 5 could not flip the readers without them:
// with no browser-scoped writer, a fences-only read reached no browser at all.

defineTool(server, {
  name: "set_host_block",
  description:
    "Declare a standing block on a host, as a rule that says what it is for. Browser-enforced by default — the extension actuates it from the pushed fence record; pass `resolverProfile` for a resolver-level block instead, which is the only reach that covers a phone. `unlockNote` is required and is the exit: a block that names no way out is refused, never set.",
  schema: {
    host: z
      .string()
      .min(1)
      .describe('A registrable host — "chess.com", not a URL and not a path'),
    returnsTo: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Areas attention should land in when the wall is met — names or ids. This is the proximal claim: blocking is not the point, not losing the next ten minutes is.",
      ),
    unlockNote: z
      .string()
      .min(1)
      .describe(
        "How the block is lifted, deliberately outside the running system so it cannot be taken in the moment of wanting",
      ),
    name: z.string().optional(),
    description: z.string().optional(),
    resolverProfile: z
      .string()
      .optional()
      .describe(
        "Name the resolver profile carrying the block to enforce it there instead of in the browser",
      ),
  },
  handler: async (input) => {
    const result = await declareHostBlock(fenceDeps, input);
    if ("problems" in result) return err(result.problems.join("; "));
    syncResolverFences(() => readFencesFile(VAULT_ROOT), VAULT_ROOT);
    return ok({ declared: result.declared, standing: result.standing });
  },
});

defineTool(server, {
  name: "set_browser_gate",
  description:
    "Declare a recurring stopping cue on a host: every N attended minutes of dwell, the page asks a question with an exit. Friction on the duration rather than on the visit — which is the answer to a standing block on a host you have a real reason to use, since that block gets lifted and a block lifted in the moment is not a boundary. Ships below delivery probability 1, because whether a cue like this returns attention is exactly what is unknown.",
  schema: {
    host: z
      .string()
      .min(1)
      .describe('A registrable host — "linkedin.com", not a URL'),
    returnsTo: z
      .array(z.string().min(1))
      .min(1)
      .describe("Areas attention should land in after the gate — names or ids"),
    everyMinutes: z
      .number()
      .describe(
        "Accumulated ATTENDED dwell between firings — a backgrounded tab or an idle person does not accrue it",
      ),
    prompt: z
      .string()
      .min(1)
      .describe("What the gate asks. The question is the friction."),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  handler: async (input) => {
    const result = await declareBrowserGate(fenceDeps, input);
    if ("problems" in result) return err(result.problems.join("; "));
    return ok({ declared: result.declared, standing: result.standing });
  },
});

defineTool(server, {
  name: "set_browser_transform",
  description:
    "Declare a DOM transform on a host: hide, restyle or replace a region rather than gate or block it — the LinkedIn feed, the YouTube Shorts shelf. Completes the fence trilogy: set_host_block asks whether you should reach a host at all, set_browser_gate asks whether you've been there longer than you meant to be, this asks whether a cue needs to be visible at all. No exit to name: a CSS conceal withholds nothing, the concealed content is still one direct navigation away, so invariant 6 does not apply to this primitive the way it does to a block or a gate.",
  schema: {
    host: z
      .string()
      .min(1)
      .describe('A registrable host — "linkedin.com", not a URL'),
    selectors: z
      .object({
        primary: z
          .string()
          .min(1)
          .describe("The main CSS selector for the region to transform"),
        fallbacks: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Selectors to emit alongside the primary — all match together, not primary-then-fallback, because selectors rot on the next deploy",
          ),
      })
      .describe("What gets transformed"),
    replacement: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("hide") }),
        z.object({
          type: z.literal("restyle"),
          style: z
            .record(z.string(), z.string())
            .describe('CSS properties, e.g. { "visibility": "hidden" }'),
        }),
        z.object({
          type: z.literal("text"),
          content: z.string().min(1).describe("Placeholder text"),
        }),
      ])
      .optional()
      .describe('How the target is replaced. Defaults to { type: "hide" }.'),
    returnsTo: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Areas attention is free to land in with the cue gone — names or ids",
      ),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  handler: async (input) => {
    const result = await declareBrowserTransform(fenceDeps, input);
    if ("problems" in result) return err(result.problems.join("; "));
    return ok({ declared: result.declared, standing: result.standing });
  },
});

defineTool(server, {
  name: "seed_host_blocks",
  description:
    "Write the seed blocklist into fences as rules — the oldest working piece of the system, carried out of keel's own rules directory and into the collection the kernel contract registers. Idempotent: each rule's id is derived from its host and enforcement point, so re-running replaces rather than accumulating, and fences it did not write are left alone.",
  schema: {
    returnsTo: z
      .array(z.string().min(1))
      .min(1)
      .describe("Areas attention should land in when a wall is met"),
    unlockNote: z
      .string()
      .min(1)
      .describe("How any of these blocks is lifted, out of band"),
    hosts: z
      .array(z.string().min(1))
      .describe(
        "The hosts to wall. Required: there is no default list, so a seed names its own hosts.",
      ),
    resolverProfile: z
      .string()
      .optional()
      .describe("Enforce at the resolver instead of in the browser"),
  },
  handler: async (input) => {
    const result = await seedHostBlocks(fenceDeps, input);
    if ("problems" in result) return err(result.problems.join("; "));
    syncResolverFences(() => readFencesFile(VAULT_ROOT), VAULT_ROOT);
    return ok({
      declared: result.declared.map((r) => ({
        id: r.id,
        host: (r.scope as { domain: string }).domain,
      })),
      standing: result.standing,
    });
  },
});

defineTool(server, {
  name: "set_watering_hours",
  description:
    "Declare a standing temporal attention policy — which plots get watered when, with friction for watering the wrong plot at the wrong time. Three modes: 'regular' (gentle gate friction), 'dry' (standing block, no water at all), 'by_hand' (tool-level friction, manual work passes through). One declaration generates per-surface rules with derived ids; re-declaring replaces.",
  schema: {
    name: z
      .string()
      .min(1)
      .describe(
        "Policy handle — shown back at every crossing, used in derived ids",
      ),
    mode: z
      .enum(["regular", "dry", "by_hand"])
      .describe(
        "regular = gentle friction, dry = standing block, by_hand = tool-level gate",
      ),
    window: z.object({
      phases: z
        .array(z.enum(["MORNING", "AFTERNOON", "EVENING", "NIGHT"]))
        .max(1)
        .optional()
        .describe(
          "One phase name — resolved to hours at declaration, frozen with cutFrom provenance",
        ),
      weekdays: z
        .array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]))
        .optional()
        .describe("Days of the week this policy is in force"),
      fromHour: z.number().min(0).max(23).optional(),
      toHour: z.number().min(0).max(23).optional(),
    }),
    waters: z
      .array(z.string().min(1))
      .min(1)
      .describe("Areas this window IS for — names or ids"),
    restricts: z.object({
      areas: z
        .array(z.string().min(1))
        .optional()
        .describe("Areas that get friction (garden surface)"),
      paths: z
        .array(z.string().min(1))
        .optional()
        .describe("Path prefixes that get friction (session surface)"),
      hosts: z
        .array(z.string().min(1))
        .optional()
        .describe(
          "Hosts that get friction (browser surface, deferred to slice 2)",
        ),
      tools: z
        .array(z.string().min(1))
        .optional()
        .describe("Tool names to gate — Edit, Write (by_hand mode)"),
    }),
    prompt: z
      .string()
      .optional()
      .describe("The gate's question (regular/by_hand modes)"),
    unlockNote: z
      .string()
      .optional()
      .describe("How the block is lifted (REQUIRED for dry mode)"),
  },
  handler: async (input) => {
    const result = await declareWateringHours(fenceDeps, {
      ...input,
      restricts: {
        ...input.restricts,
        paths: input.restricts.paths?.map(expandHome),
      },
    });
    if ("problems" in result) return err(result.problems.join("; "));
    syncResolverFences(() => readFencesFile(VAULT_ROOT), VAULT_ROOT);
    return ok({
      declared: result.declared.map((r) => ({
        id: r.id,
        surface: r.scope.surface,
      })),
      standing: result.standing,
    });
  },
});

defineTool(server, {
  name: "clear_fence",
  description:
    "Take a fence down, by id, by watering-policy name, or all of them at once. Pass exactly one of `id`, `all`, or `policy`. The crossing tally is plugin-owned and left alone; a cleared fence's id is never reused, so its count can never gate anything again.",
  schema: {
    id: z.string().optional().describe("The fence's rule id"),
    all: z.boolean().optional().describe("Take every standing fence down"),
    policy: z
      .string()
      .optional()
      .describe("Clear all rules belonging to a watering policy by name"),
  },
  annotations: { destructiveHint: true },
  handler: async ({ id, all, policy }) => {
    if ([id, all, policy].filter(Boolean).length !== 1) {
      return err("pass exactly one of `id`, `all`, or `policy`");
    }
    const target = all
      ? { all: true as const }
      : policy
        ? { policy }
        : { id: id as string };
    const result = await clearFences(fenceDeps, target);
    if ("problems" in result) return err(result.problems.join("; "));
    syncResolverFences(() => readFencesFile(VAULT_ROOT), VAULT_ROOT);
    return ok({
      cleared: result.cleared.map((f) => ({ id: f.id, label: f.name })),
    });
  },
});

defineTool(server, {
  name: "get_fence",
  description:
    "Report what is currently fenced: each standing fence with its crossing tally (from the plugin's fences-state.json, zero when never crossed), the rung the NEXT crossing would land on, and the enforcement reach per surface.",
  schema: {},
  annotations: { readOnlyHint: true },
  handler: async () => {
    const report = await fenceReport(fenceDeps);
    const allFences = readFencesFile(VAULT_ROOT);
    const resolverHosts = collectResolverHosts(allFences);
    const health = readResolverHealth(VAULT_ROOT);

    const fences = report.fences.map((f) => {
      const reach: Record<string, string> = {};
      if (f.fence.scope.surface === "browser") {
        reach.browser = "extension";
        const domains = Array.isArray(f.fence.scope.domain)
          ? f.fence.scope.domain
          : [f.fence.scope.domain];
        const inSyncSet = domains.some((d) => resolverHosts.has(d));
        if (!inSyncSet) {
          reach.resolver = "skipped";
        } else if (health && !health.reachable) {
          reach.resolver = "unreachable";
        } else if (health && health.reachable) {
          reach.resolver = "synced";
        } else {
          // No health record yet — never synced
          reach.resolver = "skipped";
        }
      }
      return { ...f, reach };
    });

    return ok({ fences });
  },
});

// ────────────────────────────────────────────────────────────────────────
// ATTENTION — the plan ↔ trace bridge
// ────────────────────────────────────────────────────────────────────────

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

defineTool(server, {
  name: "get_attention",
  description:
    "Where did attention go? Dwell time by area per surface (desktop/agent/browser), " +
    "unmapped locators (top 10), and agent sessions. Minutes, never ms. " +
    "Coverage on every response — an empty surface means unrecorded, not idle.",
  schema: {
    day: DaySchema.optional().describe(
      "One waking day (04:00 roll). Omit for today.",
    ),
    from: DaySchema.optional().describe(
      "Inclusive start day. Use with `to` for a range.",
    ),
    to: DaySchema.optional().describe(
      "Inclusive end day.",
    ),
    surfaces: z
      .array(z.enum(["desktop", "agent", "browser"]))
      .optional()
      .describe("Surfaces to query. Default: all three."),
    pathPrefix: z
      .string()
      .optional()
      .describe(
        "Agent surface only: restrict to cwds under this path (~ expands).",
      ),
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const areas = readCollection(VAULT_ROOT, "areas");
    return ok(getAttention(VAULT_ROOT, areas, params));
  },
});

defineTool(server, {
  name: "get_area_map",
  description:
    "Show the area map: path, host, and app rules that resolve trace events to areas. " +
    "Flags rules whose areaId no longer exists.",
  schema: {},
  annotations: { readOnlyHint: true },
  handler: async () => {
    const areas = readCollection(VAULT_ROOT, "areas");
    return ok(getSurfaces(VAULT_ROOT, areas));
  },
});

defineTool(server, {
  name: "map_area",
  description:
    "Add, update, or remove a rule in the area map. " +
    '"Slack → Themia" becomes kind=app, key=Slack, area=Themia. ' +
    "Pass area=null to remove a rule.",
  schema: {
    kind: z.enum(["path", "host", "app"]),
    key: z.string().min(1).describe("The path prefix, host, or app name."),
    area: z
      .string()
      .nullable()
      .describe("Area name or id. null removes the rule."),
  },
  annotations: { readOnlyHint: false },
  handler: async (params) => {
    const areas = readCollection(VAULT_ROOT, "areas");
    const result = mapArea(VAULT_ROOT, areas, params);
    if (!result.ok) return err(result.message);
    if (result.mutated) writeCollection(VAULT_ROOT, "areas", areas);
    return ok(result);
  },
});

// ────────────────────────────────────────────────────────────────────────
// BODY + METRIC TREND
// ────────────────────────────────────────────────────────────────────────

function loadHabitMap() {
  const mapPath = path.join(VAULT_ROOT, "integrations", "garmin", "habit-map.json");
  if (!fs.existsSync(mapPath)) return parseHabitMap(null);
  try {
    return parseHabitMap(JSON.parse(fs.readFileSync(mapPath, "utf8")));
  } catch {
    return parseHabitMap(null);
  }
}

defineTool(server, {
  name: "get_body",
  description:
    "Sleep nights and workouts from Garmin. " +
    "Nights report the morning woken (calendarDate describes the night before that day's work). " +
    "Workouts resolve to habits via the garmin habit map when mapped.",
  schema: {
    day: DaySchema.optional().describe("One waking day (04:00 roll). Omit for today."),
    from: DaySchema.optional().describe("Inclusive start day."),
    to: DaySchema.optional().describe("Inclusive end day."),
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const window = resolveWindow(params);
    const events = readActivityLog(logDir(VAULT_ROOT), window.from, window.to, ["garmin"]);
    const habitMap = loadHabitMap();
    const habits = readCollection(VAULT_ROOT, "habits");
    const habitName = (id: string) => habits[id]?.name ?? id;
    const nights = nightsOf(events).map((n) => ({
      calendarDate: n.calendarDate,
      asleepHours: +(n.asleepMs / 3_600_000).toFixed(1),
      ...(n.score !== undefined ? { score: n.score } : {}),
      ...(n.deepS !== undefined ? { deepMin: Math.round(n.deepS / 60) } : {}),
      ...(n.remS !== undefined ? { remMin: Math.round(n.remS / 60) } : {}),
      ...(n.avgHrBpm !== undefined ? { avgHrBpm: n.avgHrBpm } : {}),
    }));
    const workouts = workoutsOf(events, habitMap).map((w) => {
      const d = new Date(w.start);
      const p = (n: number) => String(n).padStart(2, "0");
      return {
        day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
        start: `${p(d.getHours())}:${p(d.getMinutes())}`,
        activityType: w.activityType,
        elapsedMin: Math.round(w.elapsedMs / 60_000),
        ...(w.movingS !== undefined ? { movingMin: Math.round(w.movingS / 60) } : {}),
        ...(w.calories !== undefined ? { calories: w.calories } : {}),
        ...(w.avgHrBpm !== undefined ? { avgHrBpm: w.avgHrBpm } : {}),
        ...(w.habitId ? { habitId: w.habitId, habitName: habitName(w.habitId) } : {}),
      };
    });
    const garminEvents = events.filter((e) => e.surface === "garmin");
    const first = garminEvents.length > 0 ? garminEvents[0].ts : undefined;
    const last = garminEvents.length > 0 ? garminEvents[garminEvents.length - 1].ts : undefined;
    const localDate = (ts: number) => {
      const d = new Date(ts);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    return ok({
      window: { from: window.fromDay, to: window.toDay },
      coverage: {
        ...(first !== undefined ? { first: localDate(first) } : {}),
        ...(last !== undefined ? { last: localDate(last) } : {}),
      },
      nights,
      workouts,
    });
  },
});

defineTool(server, {
  name: "get_metric_trend",
  description:
    "Metric values over time for a habit. Points only — no slope, no target distance.",
  schema: {
    habitId: z.string().min(1),
    metricName: z.string().optional().describe("Filter to one metric name."),
    since: DaySchema.optional().describe("Only points on or after this date."),
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const moments = Object.values(readCollection(VAULT_ROOT, "moments"));
    const logs = Object.values(readCollection(VAULT_ROOT, "metricLogs"));
    const habits = readCollection(VAULT_ROOT, "habits");
    const habit = habits[params.habitId];
    if (!habit) return err(`Habit not found: ${params.habitId}`);

    let series = metricSeries(params.habitId, moments, logs, params.metricName);
    if (params.since) {
      series = series.map((s) => ({
        ...s,
        points: s.points.filter((p) => p.date >= params.since!),
      })).filter((s) => s.points.length > 0);
    }
    return ok({ habitId: params.habitId, habitName: habit.name, series });
  },
});

// ────────────────────────────────────────────────────────────────────────
// DAY TRACE — plan vs actual
// ────────────────────────────────────────────────────────────────────────

defineTool(server, {
  name: "get_day_trace",
  description:
    "How aligned was the day with the plan? For each planted moment: " +
    "attention traced in its cell (same area), attention elsewhere (different area), " +
    "and whether any trace was found. Also reports unplanted attention — " +
    "spans in cells that planted nothing for that area. " +
    "No alignment %, no score.",
  schema: {
    day: DaySchema.optional().describe("Waking day (04:00 roll). Omit for today."),
    idleGapMin: z.number().int().positive().optional()
      .describe("Idle gap in minutes for span derivation. Default 15."),
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const areas = readCollection(VAULT_ROOT, "areas");
    const moments = readCollection(VAULT_ROOT, "moments");
    const phaseConfigs = readCollection(VAULT_ROOT, "phaseConfigs");
    return ok(getDayTrace(VAULT_ROOT, areas, moments, phaseConfigs, params));
  },
});

// ────────────────────────────────────────────────────────────────────────
// Gap proposals
// ────────────────────────────────────────────────────────────────────────

import { proposeGap } from "./thirst.js";

defineTool(server, {
  name: "propose_gap",
  description:
    "Propose the thirstiest gap habits for an available window. " +
    'Use when the gardener says "I have time" or a gap is detected. ' +
    "Returns 2–3 habits sorted by thirst (highest first), filtered by duration and place.",
  schema: {
    durationMinutes: z.number().positive().optional()
      .describe("Max available time in minutes. Omit for open-ended."),
    place: z.string().optional()
      .describe("Where the gardener is (city/place key). Omit if unknown."),
    maxResults: z.number().int().min(1).max(5).optional()
      .describe("How many proposals to return. Default 3."),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ durationMinutes, place, maxResults }) => {
    const habits = readCollection(VAULT_ROOT, "habits");
    const moments = Object.values(readCollection(VAULT_ROOT, "moments"));
    const cycles = readCollection(VAULT_ROOT, "cycles");
    const cyclePlans = readCollection(VAULT_ROOT, "cyclePlans");
    const now = new Date();
    const withinMs = durationMinutes ? durationMinutes * 60_000 : undefined;
    const proposals = proposeGap(
      habits, moments, cycles, cyclePlans, now, withinMs, place, maxResults ?? 3,
    );
    if (proposals.length === 0) return ok({ proposals: [], message: "No gap habits fit the window." });
    return ok({ proposals });
  },
});

// ────────────────────────────────────────────────────────────────────────
// Connect
// ────────────────────────────────────────────────────────────────────────

// Migrate area-map.json → area surfaces (one-time, idempotent)
{
  const areas = readCollection(VAULT_ROOT, "areas");
  const m = migrateSurfaces(VAULT_ROOT, areas);
  if (m.migrated > 0) {
    writeCollection(VAULT_ROOT, "areas", areas);
    process.stderr.write(`[zenborg-mcp] migrated ${m.migrated} area-map rules to area surfaces\n`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[zenborg-mcp] connected (vault: ${VAULT_ROOT})\n`);
