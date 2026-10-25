/**
 * Validation helpers — mirror src/domain invariants.
 *
 * The MCP server is a separate pnpm workspace, so we cannot import from
 * `@/domain/*` directly. We port the small set of invariants that cross
 * collection boundaries (referential integrity, phase cap, cascades).
 * Entity-shape validation lives in zod schemas on the tool layer.
 */
import {
  type Area,
  type Cycle,
  type CyclePlan,
  type Habit,
  isValidTimezone,
  type Moment,
  type Phase,
  type PhaseConfig,
  type Rhythm,
  type Schedule,
  type ScheduleInput,
  START_TIME_PATTERN,
  WEEKDAYS,
  type Weekday,
} from "./vault.js";

// ────────────────────────────────────────────────────────────────────────
// Name validation (1–3 words) — used by Habit and Moment
// ────────────────────────────────────────────────────────────────────────

export function validateOneToThreeWords(
  name: string,
  subject: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return `${subject} name cannot be empty`;
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 1) {
    return `${subject} name must contain at least 1 word`;
  }
  if (words.length > 3) {
    return `${subject} name cannot exceed 3 words`;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Tag normalization (mirrors src/domain/services/TagService)
// ────────────────────────────────────────────────────────────────────────

const TAG_VALID = /^[a-z0-9-]{1,20}$/;

function normalizeSingleTag(tag: string): string | null {
  if (!tag || typeof tag !== "string") return null;
  const normalized = tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .substring(0, 20);
  return TAG_VALID.test(normalized) ? normalized : null;
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const normalized: string[] = [];
  for (const raw of tags) {
    const n = normalizeSingleTag(raw);
    if (n !== null) normalized.push(n);
  }
  return Array.from(new Set(normalized));
}

// ────────────────────────────────────────────────────────────────────────
// Refs (mirrors src/domain/entities/Moment.ts)
//
// A ref is a URL this moment refers to — the Linear issue, the PR, the doc.
// A pointer, nothing more. Any parseable scheme is accepted, because a moment
// can just as well point at `things:///show?id=…` as at an https page.
// ────────────────────────────────────────────────────────────────────────

export function isParseableRef(ref: string): boolean {
  try {
    new URL(ref);
    return true;
  } catch {
    return false;
  }
}

/** First unparseable ref, named. Null when every ref parses. */
export function validateRefs(
  refs: readonly string[] | undefined,
): string | null {
  for (const ref of refs ?? []) {
    if (!isParseableRef(ref.trim())) {
      return `Moment ref is not a parseable URL: ${ref}`;
    }
  }
  return null;
}

/**
 * Derives an entity key from a human label.
 *
 * lowercase → strip diacritics → non-alphanumeric to dash → collapse dash runs
 * → trim dashes. The rule lives in the kernel contract because zenborg and
 * wake must agree on it without coordinating. Mirrors
 * src/domain/entities/Moment.ts, which this workspace cannot import.
 */
export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Maps raw `personIds` entries to person keys, which is what the app resolves
 * badges by. A key stays; a person's UUID becomes that person's key; anything
 * else is slugified (an unknown key is still allowed through). Deduped, empties
 * dropped.
 */
export function resolvePersonKeys(
  raw: readonly string[],
  people: Record<string, { id: string; key: string }>,
): string[] {
  const all = Object.values(people);
  const keys: string[] = [];
  for (const entry of raw) {
    const hit =
      all.find((p) => p.key === entry) ?? all.find((p) => p.id === entry);
    const key = hit ? hit.key : slugify(entry);
    if (key.length > 0 && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** The pasted place link, named when it does not parse. Null when absent. */
export function validatePlaceUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  if (!isParseableRef(url.trim())) {
    return `Moment placeUrl is not a parseable URL: ${url}`;
  }
  return null;
}

/** Trims, drops empties, de-duplicates; preserves first-occurrence order. */
export function normalizeRefs(refs: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of refs ?? []) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Normalizes habit aliases: trims, drops empties, drops any alias
 * case-insensitively equal to the habit name, dedupes case-insensitively,
 * and preserves the original casing of the first occurrence.
 */
export function normalizeAliases(
  aliases: readonly string[] | undefined,
  name: string,
): string[] {
  if (!aliases) return [];
  const lowerName = name.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower === lowerName) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}

export function countMomentsInPhase(
  moments: readonly Moment[],
  day: string,
  phase: Phase,
  excludeMomentId?: string,
): number {
  let count = 0;
  for (const m of moments) {
    if (excludeMomentId && m.id === excludeMomentId) continue;
    if (m.day === day && m.phase === phase) count++;
  }
  return count;
}

// ────────────────────────────────────────────────────────────────────────
// Schedule (mirrors src/domain/value-objects/Schedule.ts)
// ────────────────────────────────────────────────────────────────────────

export function isValidStartTime(value: string): boolean {
  return START_TIME_PATTERN.test(value);
}

export function startTimeHour(startTime: string): number {
  return Number.parseInt(startTime.slice(0, 2), 10);
}

export function normalizeWeekdays(weekdays: readonly Weekday[]): Weekday[] {
  const present = new Set(weekdays);
  return WEEKDAYS.filter((day) => present.has(day));
}

/**
 * Normalizes a schedule: weekdays de-duplicated and ordered MON..SUN, start
 * time and duration validated. Zod already enforces most of this at the tool
 * boundary; this keeps the invariant true for any other caller.
 */
export function normalizeSchedule(input: {
  weekdays: readonly Weekday[];
  startTime: string;
  durationMin: number;
  timezone?: string;
}): Schedule | { error: string } {
  const weekdays = normalizeWeekdays(input.weekdays);
  if (weekdays.length === 0) {
    return { error: "Schedule must have at least one weekday" };
  }
  if (!isValidStartTime(input.startTime)) {
    return {
      error: `Schedule startTime must be HH:MM (24h), got: ${input.startTime}`,
    };
  }
  if (!Number.isInteger(input.durationMin) || input.durationMin <= 0) {
    return {
      error: "Schedule durationMin must be a positive whole number of minutes",
    };
  }
  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    return {
      error: `Schedule timezone must be an IANA identifier like "America/Sao_Paulo", got: ${input.timezone}`,
    };
  }
  return {
    weekdays,
    startTime: input.startTime,
    durationMin: input.durationMin,
    ...(input.timezone ? { timezone: input.timezone } : {}),
  };
}

/**
 * Resolves the anchor zone for an incoming schedule against the stored one.
 *
 * A schedule rewrite carries the weekday slot and the clock time; the anchor
 * is a separate fact about that commitment and must survive a caller that
 * cannot express it — an older tool schema, the UI, an agent just moving the
 * hour. Omitting `timezone` therefore inherits the stored one; only an
 * explicit null unanchors.
 */
export function withResolvedTimezone(
  incoming: ScheduleInput,
  stored: Schedule | undefined,
): Schedule {
  const timezone =
    incoming.timezone === undefined
      ? stored?.timezone
      : (incoming.timezone ?? undefined);
  return {
    weekdays: incoming.weekdays,
    startTime: incoming.startTime,
    durationMin: incoming.durationMin,
    ...(timezone ? { timezone } : {}),
  };
}

/** One occurrence per scheduled weekday. */
export function deriveRhythmFromSchedule(schedule: Schedule): Rhythm {
  return { period: "weekly", count: schedule.weekdays.length };
}

/**
 * Only *weekly* rhythms are constrained by the weekday list — there, count and
 * weekdays.length are two spellings of the same fact. Longer periods treat
 * weekdays as candidate days ("every other Monday" = biweekly ×1 on [MON]).
 */
export function scheduleRhythmError(
  schedule: Schedule,
  rhythm: Rhythm | undefined,
): string | null {
  if (!rhythm || rhythm.period !== "weekly") {
    return null;
  }
  if (rhythm.count !== schedule.weekdays.length) {
    return `Weekly rhythm count (${rhythm.count}) must equal the number of scheduled weekdays (${schedule.weekdays.length})`;
  }
  return null;
}

function isHourInPhase(hour: number, config: PhaseConfig): boolean {
  const { startHour, endHour } = config;
  if (endHour <= startHour) {
    return hour >= startHour || hour < endHour;
  }
  return hour >= startHour && hour < endHour;
}

/**
 * The phase band a clock time falls into. Visibility is ignored — 03:00 is
 * NIGHT whether or not NIGHT is shown. Null when no band covers the hour.
 */
export function phaseForStartTime(
  startTime: string,
  phaseConfigs: readonly PhaseConfig[],
): Phase | null {
  const hour = startTimeHour(startTime);
  const ordered = [...phaseConfigs].sort((a, b) => a.order - b.order);
  for (const config of ordered) {
    if (isHourInPhase(hour, config)) {
      return config.phase;
    }
  }
  return null;
}

export function schedulePhaseError(
  schedule: Schedule,
  phase: Phase | null | undefined,
  phaseConfigs: readonly PhaseConfig[],
): string | null {
  if (!phase) {
    return null;
  }
  const derived = phaseForStartTime(schedule.startTime, phaseConfigs);
  if (derived === null || derived === phase) {
    return null;
  }
  return `Phase ${phase} contradicts startTime ${schedule.startTime}, which falls in ${derived}`;
}

/** Timing a moment inherits when spawned from a scheduled habit. */
export function timingFromSchedule(schedule: Schedule): {
  startTime: string;
  durationMin: number;
} {
  return { startTime: schedule.startTime, durationMin: schedule.durationMin };
}

export function validateMomentTiming(
  startTime: string | undefined,
  durationMin: number | undefined,
): string | null {
  if (startTime !== undefined && !isValidStartTime(startTime)) {
    return `Moment startTime must be HH:MM (24h), got: ${startTime}`;
  }
  if (
    durationMin !== undefined &&
    (!Number.isInteger(durationMin) || durationMin <= 0)
  ) {
    return "Moment durationMin must be a positive whole number of minutes";
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Referential integrity
// ────────────────────────────────────────────────────────────────────────

export function findArea(areas: Record<string, Area>, id: string): Area | null {
  return areas[id] ?? null;
}

export function findAreaByIdOrName(
  areas: Record<string, Area>,
  ref: string,
): Area | null {
  if (areas[ref]) return areas[ref];
  const matches = Object.values(areas).filter(
    (a) => a.name.toLowerCase() === ref.toLowerCase(),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function findHabitByIdOrName(
  habits: Record<string, Habit>,
  ref: string,
): Habit | null {
  if (habits[ref]) return habits[ref];
  const matches = Object.values(habits).filter(
    (h) => !h.isArchived && h.name.toLowerCase() === ref.toLowerCase(),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function findCycleByIdOrName(
  cycles: Record<string, Cycle>,
  ref: string,
): Cycle | null {
  if (cycles[ref]) return cycles[ref];
  const matches = Object.values(cycles).filter(
    (c) => c.name.toLowerCase() === ref.toLowerCase(),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function requireActiveArea(
  areas: Record<string, Area>,
  areaId: string,
): string | Area {
  const area = findArea(areas, areaId);
  if (!area) return `Area not found: ${areaId}`;
  return area;
}

export function requireActiveHabit(
  habits: Record<string, Habit>,
  habitId: string,
): string | Habit {
  const habit = habits[habitId] ?? null;
  if (!habit) return `Habit not found: ${habitId}`;
  if (habit.isArchived) return `Habit is archived: ${habit.name}`;
  return habit;
}

export function requireCycle(
  cycles: Record<string, Cycle>,
  cycleId: string,
): string | Cycle {
  const cycle = cycles[cycleId] ?? null;
  if (!cycle) return `Cycle not found: ${cycleId}`;
  return cycle;
}

// ────────────────────────────────────────────────────────────────────────
// CyclePlan uniqueness (one plan per (cycleId, habitId))
// ────────────────────────────────────────────────────────────────────────

export function findCyclePlan(
  plans: Record<string, CyclePlan>,
  cycleId: string,
  habitId: string,
): CyclePlan | null {
  for (const plan of Object.values(plans)) {
    if (plan.cycleId === cycleId && plan.habitId === habitId) {
      return plan;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Cascade computations
// ────────────────────────────────────────────────────────────────────────

export interface HabitCascade {
  momentIdsToDelete: string[];
  planIdsToDelete: string[];
}

/**
 * Archive-habit cascade: delete unallocated moments belonging to this habit,
 * plus all cycle plans pointing to it. Allocated moments are kept (they're
 * historical record).
 */
export function computeHabitCascade(
  habitId: string,
  moments: Record<string, Moment>,
  plans: Record<string, CyclePlan>,
): HabitCascade {
  const momentIdsToDelete: string[] = [];
  for (const m of Object.values(moments)) {
    if (m.habitId === habitId && m.day === null) {
      momentIdsToDelete.push(m.id);
    }
  }
  const planIdsToDelete: string[] = [];
  for (const p of Object.values(plans)) {
    if (p.habitId === habitId) {
      planIdsToDelete.push(p.id);
    }
  }
  return { momentIdsToDelete, planIdsToDelete };
}

export interface CycleCascade {
  momentIdsToDelete: string[];
  planIdsToDelete: string[];
}

/**
 * Delete-cycle cascade: all moments and plans scoped to the cycle.
 */
export function computeCycleCascade(
  cycleId: string,
  moments: Record<string, Moment>,
  plans: Record<string, CyclePlan>,
): CycleCascade {
  const momentIdsToDelete: string[] = [];
  for (const m of Object.values(moments)) {
    if (m.cycleId === cycleId) {
      momentIdsToDelete.push(m.id);
    }
  }
  const planIdsToDelete: string[] = [];
  for (const p of Object.values(plans)) {
    if (p.cycleId === cycleId) {
      planIdsToDelete.push(p.id);
    }
  }
  return { momentIdsToDelete, planIdsToDelete };
}

// ────────────────────────────────────────────────────────────────────────
// Moment filter predicates (mirror isAllocated / isInDeck / etc.)
// ────────────────────────────────────────────────────────────────────────

export function isAllocated(m: Moment): boolean {
  return m.day !== null && m.phase !== null;
}

export function isInDeck(m: Moment): boolean {
  return !isAllocated(m) && m.cyclePlanId !== null;
}

export function isBudgeted(m: Moment): boolean {
  return m.cyclePlanId !== null;
}

export function isSpontaneous(m: Moment): boolean {
  return m.cyclePlanId === null;
}

export function isUnallocated(m: Moment): boolean {
  // "Drawing board": not allocated AND not in a cycle deck
  return m.day === null && m.cyclePlanId === null;
}

// ────────────────────────────────────────────────────────────────────────
// Area deletion precondition
// ────────────────────────────────────────────────────────────────────────

export function areaHasMoments(
  areaId: string,
  moments: Record<string, Moment>,
): boolean {
  for (const m of Object.values(moments)) {
    if (m.areaId === areaId) return true;
  }
  return false;
}
