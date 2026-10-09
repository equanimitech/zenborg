/**
 * Vault access for the MCP server.
 *
 * The Tauri desktop app writes canonical JSON collection files at
 * `{vaultRoot}/{collection}.json` (keyed by camelCase collection name). The
 * MCP server reads and writes the same files directly — the Rust watcher
 * picks up our edits and refreshes the desktop observables.
 *
 * Resolution order (mirrors `vault_root()` in `src-tauri/src/vault/fs.rs` — the two
 * must agree or the app and the MCP server end up on different vaults):
 *   1. `--vault /path/to/vault` CLI arg
 *   2. `$ZENBORG_HOME` env var
 *   3. `$KAIROS_HOME` env var (legacy, honoured after ZENBORG_HOME)
 *   4. `$HOME/.zenborg/` (release default)
 *
 * Writes are atomic: temp file in the same directory, then rename. This
 * matches the Tauri adapter's semantics so concurrent readers never see a
 * half-written file.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { Cadence } from "./cadence.js";

// ────────────────────────────────────────────────────────────────────────
// Types — mirror src/domain (standalone; no cross-workspace imports)
// ────────────────────────────────────────────────────────────────────────

export const ATTITUDES = [
  "BEGINNING",
  "RETURNING",
  "KEEPING",
  "BUILDING",
  "PUSHING",
  "PRUNING",
  "BEING",
] as const;
export const AttitudeSchema = z.enum(ATTITUDES);
export type Attitude = z.infer<typeof AttitudeSchema>;

export const PHASES = ["MORNING", "AFTERNOON", "EVENING", "NIGHT"] as const;
export const PhaseSchema = z.enum(PHASES);
export type Phase = z.infer<typeof PhaseSchema>;

export const CustomMetricSchema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1),
  target: z.number().optional(),
});
export type CustomMetric = z.infer<typeof CustomMetricSchema>;

export const RHYTHM_PERIODS = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annually",
] as const;
export const RhythmPeriodSchema = z.enum(RHYTHM_PERIODS);
export type RhythmPeriod = z.infer<typeof RhythmPeriodSchema>;

export const RhythmSchema = z.object({
  period: RhythmPeriodSchema,
  count: z.number().positive(),
});
export type Rhythm = z.infer<typeof RhythmSchema>;

/**
 * Schedule — a habit's clock-time commitment. Optional: most habits are
 * ambient. `rhythm` says how often; `schedule` says when.
 * Mirrors `src/domain/value-objects/Schedule.ts`.
 */
export const WEEKDAYS = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** Zero-padded 24h clock time. */
export const START_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const StartTimeSchema = z
  .string()
  .regex(START_TIME_PATTERN, "startTime must be HH:MM (24h)");

/**
 * IANA identifier shape — mirrors `src/domain/value-objects/Schedule.ts`,
 * which this workspace cannot import from.
 *
 * Stricter than `Intl` on purpose: `Intl` also accepts fixed offsets like
 * "+05:00", but the Swift calendar sidecar resolves the stored string through
 * `TimeZone(identifier:)`, which rejects an offset and returns nil — falling
 * back to the device zone and firing the event at the wrong hour with nothing
 * logged. Refusing it at the write boundary is what keeps the readers agreeing.
 */
export const IANA_TIMEZONE_PATTERN =
  /^(UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/;

export function isValidTimezone(value: string): boolean {
  if (!IANA_TIMEZONE_PATTERN.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimezoneSchema = z
  .string()
  .refine(
    isValidTimezone,
    'timezone must be an IANA identifier like "America/Sao_Paulo"; a fixed offset such as "+05:00" is rejected because the calendar sidecar cannot resolve it',
  );

/**
 * The stored shape. `timezone` absent means the clock time floats with
 * wherever you are; present anchors it to a fixed zone.
 */
export const ScheduleSchema = z.object({
  weekdays: z.array(WeekdaySchema).min(1),
  startTime: StartTimeSchema,
  durationMin: z.number().int().positive(),
  timezone: TimezoneSchema.optional(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

/**
 * The tool-input spelling, where `timezone` gains a third state.
 *
 * Omitted keeps whatever the habit already had — a caller rewriting the
 * weekday slot must not silently unanchor the habit as a side effect. An
 * explicit null drops the anchor and returns the schedule to floating.
 */
export const ScheduleInputSchema = ScheduleSchema.extend({
  timezone: TimezoneSchema.nullable().optional(),
});
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>;

export const PERIOD_DAYS: Record<RhythmPeriod, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  annually: 365,
};

export function rhythmToCycleBudget(r: Rhythm, cycleDays: number): number {
  return Math.round((r.count * cycleDays) / PERIOD_DAYS[r.period]);
}

export function rhythmSilenceThresholdDays(r: Rhythm): number {
  return PERIOD_DAYS[r.period] / r.count;
}

export interface Area {
  id: string;
  name: string;
  attitude?: Attitude | null;
  tags?: string[];
  color: string;
  emoji: string;
  isDefault: boolean;
  order: number;
  /** Paths, hosts and apps that resolve footprints here. Mirrors src/domain/entities/Area.ts. */
  surfaces?: { paths?: string[]; hosts?: string[]; apps?: string[] };
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  name: string;
  areaId: string;
  attitude: Attitude | null;
  phase: Phase | null;
  tags: string[];
  aliases?: string[];
  emoji: string | null;
  isArchived: boolean;
  order: number;
  description?: string;
  guidance?: string;
  rhythm?: Rhythm;
  schedule?: Schedule;
  /** Where this practice can be done. Mirrors src/domain/entities/Habit.ts. */
  placeIds?: string[];
  link?: string;
  durationMin?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Who wrote a cycle's reflection. Mirrors `ReflectionSource` in
 * `src/domain/entities/Cycle.ts` — this is the second vault implementation,
 * and the two must agree on the field's spelling and its values.
 *
 * Absent means unknown, and every reader must treat unknown as NOT human.
 */
export type ReflectionSource = "human" | "machine";

export interface Cycle {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  intention?: string;
  /** Where this season is lived. Mirrors src/domain/entities/Cycle.ts. */
  placeIds?: string[];
  reflection?: string;
  reflectionSource?: ReflectionSource | null;
  createdAt: string;
  updatedAt: string;
}

export interface CyclePlan {
  id: string;
  cycleId: string;
  habitId: string;
  budgetedCount: number;
  rhythmOverride?: Rhythm;
  createdAt: string;
  updatedAt: string;
}

export interface Moment {
  id: string;
  name: string;
  areaId: string;
  habitId: string | null;
  cycleId: string | null;
  cyclePlanId: string | null;
  phase: Phase | null;
  day: string | null; // YYYY-MM-DD
  order: number;
  startTime?: string; // "HH:MM" — inherited from the habit's schedule, overridable
  durationMin?: number; // positive whole minutes
  emoji?: string | null;
  customMetric?: CustomMetric;
  tags: string[] | null;
  /**
   * URLs this moment refers to — the Linear issue, the PR, the doc. A pointer
   * and nothing else. Absent when the moment refers to nothing.
   */
  refs?: readonly string[];
  personIds?: string[]; // People present. Mirrors src/domain/entities/Moment.ts
  /**
   * Where this moment happened, as registry entity keys at whatever grain
   * it knows. Absent means unknown, which is honest; a wrong place is not.
   * Mirrors src/domain/entities/Moment.ts.
   */
  placeIds?: string[];
  /** The pasted map link, kept verbatim as minting evidence for wake. */
  placeUrl?: string;
  /**
   * Whether this moment is a proposal or a committed intention.
   * Optional; absence means accepted. Only calendar ingestion ever
   * writes "tentative". Mirrors src/domain/entities/Moment.ts.
   */
  status?: "tentative" | "accepted";
  /**
   * Provenance for a moment that mirrors an external calendar event.
   * Absent on moments with no calendar counterpart. Owned by the
   * calendar sidecar; not writable through MCP.
   */
  externalRef?: {
    source: "eventkit";
    eventId: string;
    calendarId: string;
    lastWrittenHash: string;
    lastWrittenTitle: string;
    lastSyncedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  name: string;
  key: string;
  aliases?: string[];
  cadence: Cadence | null;
  tags: string[];
  basePlace: string | null;
  emoji: string | null;
  isArchived: boolean;
  isSelf?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  name: string;
  key: string;
  parentKey: string | null;
  tags: string[];
  aliases?: string[];
  address: string | null;
  coordinates: Coordinates | null;
  emoji: string | null;
  url: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ENTITY_TYPES = ["person", "place", "habit", "area"] as const;
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const RELATIONSHIP_DIRECTIONS = ["directed", "mutual"] as const;
export const RelationshipDirectionSchema = z.enum(RELATIONSHIP_DIRECTIONS);

export interface Relationship {
  id: string;
  fromType: EntityType;
  fromId: string;
  toType: EntityType;
  toId: string;
  label: string;
  direction: "directed" | "mutual";
  createdAt: string;
  updatedAt: string;
}

export interface PhaseConfig {
  id: string;
  phase: Phase;
  label: string;
  emoji: string;
  color: string;
  startHour: number;
  endHour: number;
  isVisible: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface MetricLog {
  id: string;
  momentId: string;
  date: string;
  value: number;
  createdAt: string;
  updatedAt: string;
}

export interface DayNote {
  date: string;
  title: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineEntry {
  habitId: string;
  order: number;
}

export interface Routine {
  id: string;
  name: string;
  from: Phase;
  to: Phase;
  entries: RoutineEntry[];
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Collection registry (mirrors src/domain/registry.ts)
// ────────────────────────────────────────────────────────────────────────

export const COLLECTION_NAMES = [
  "moments",
  "areas",
  "habits",
  "cycles",
  "cyclePlans",
  "phaseConfigs",
  "metricLogs",
  "dayNotes",
  "people",
  "places",
  "relationships",
  "routines",
] as const;
export type CollectionName = (typeof COLLECTION_NAMES)[number];

export interface CollectionTypeMap {
  moments: Moment;
  areas: Area;
  habits: Habit;
  cycles: Cycle;
  cyclePlans: CyclePlan;
  phaseConfigs: PhaseConfig;
  metricLogs: MetricLog;
  dayNotes: DayNote;
  people: Person;
  places: Place;
  relationships: Relationship;
  routines: Routine;
}

// ────────────────────────────────────────────────────────────────────────
// Vault path resolution
// ────────────────────────────────────────────────────────────────────────

export const ZENBORG_HOME_ENV = "ZENBORG_HOME";
export const KAIROS_HOME_ENV = "KAIROS_HOME";
export const DEFAULT_VAULT_FOLDER = ".zenborg";
export const DEV_VAULT_FOLDER = ".zenborg-dev";

export interface ResolvedVault {
  root: string;
  source: "cli" | "env" | "default";
}

/**
 * Resolve the vault root.
 * Priority: --vault CLI > $ZENBORG_HOME > $KAIROS_HOME > ~/.zenborg
 *
 * Keep in lockstep with `vault_root()` in `src-tauri/src/vault/fs.rs`.
 */
export function resolveVault(
  argv: readonly string[] = process.argv,
): ResolvedVault {
  const vaultArg = argv.find((_, i, a) => a[i - 1] === "--vault");
  if (vaultArg) {
    return { root: path.resolve(vaultArg), source: "cli" };
  }

  for (const envVar of [ZENBORG_HOME_ENV, KAIROS_HOME_ENV]) {
    const envPath = process.env[envVar];
    if (envPath && envPath.trim().length > 0) {
      return { root: path.resolve(envPath), source: "env" };
    }
  }

  return {
    root: path.join(os.homedir(), DEFAULT_VAULT_FOLDER),
    source: "default",
  };
}

/**
 * Log resolved vault + warn if a dev vault exists but isn't what we targeted.
 * Log lines go to stderr so they don't pollute the MCP stdio transport.
 */
export function logVaultBanner(resolved: ResolvedVault): void {
  const exists = fs.existsSync(resolved.root);
  process.stderr.write(
    `[zenborg-mcp] vault=${resolved.root} source=${resolved.source} exists=${exists}\n`,
  );

  const devRoot = path.join(os.homedir(), DEV_VAULT_FOLDER);
  if (resolved.root !== devRoot && fs.existsSync(devRoot)) {
    process.stderr.write(
      `[zenborg-mcp] WARNING: dev vault exists at ${devRoot} but MCP is not targeting it. ` +
        `If you're running the debug desktop app, point MCP there with --vault ${devRoot}.\n`,
    );
  }
}

/**
 * Absolute path to a collection's JSON file.
 */
export function collectionPath(
  root: string,
  collection: CollectionName,
): string {
  return path.join(root, `${collection}.json`);
}

// ────────────────────────────────────────────────────────────────────────
// Atomic I/O
// ────────────────────────────────────────────────────────────────────────

/**
 * Read a collection. Returns an empty record if the file doesn't exist
 * (first boot / collection never written).
 */
export function readCollection<K extends CollectionName>(
  root: string,
  collection: K,
): Record<string, CollectionTypeMap[K]> {
  const file = collectionPath(root, collection);
  if (!fs.existsSync(file)) {
    return {};
  }
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, CollectionTypeMap[K]>;
  } catch (error) {
    throw new Error(
      `Malformed JSON in ${collection}.json at ${file}: ${(error as Error).message}`,
    );
  }
}

/**
 * Atomic write: temp file in the same directory, then rename.
 * Matches the Tauri adapter so external watchers see a single event.
 */
export function writeCollection<K extends CollectionName>(
  root: string,
  collection: K,
  value: Record<string, CollectionTypeMap[K]>,
): void {
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const file = collectionPath(root, collection);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// ────────────────────────────────────────────────────────────────────────
// Active moment — the intention pointer
// ────────────────────────────────────────────────────────────────────────

/**
 * `activeMoment.json` — which moment IS the current intention.
 *
 *   { "momentId": "80d0f15a-…", "at": "2026-08-07T13:40:12.222Z" }
 *
 * Deliberately NOT a collection: it is a singleton pointer, not a record keyed
 * by UUID, so it stays out of `COLLECTION_NAMES` and out of the registry.
 *
 * Zenborg is the writer (this server + the desktop app); **keel is a reader**
 * and resolves the pointer against `moments.json` to surface the intention in
 * its session hooks. Keel honours it only while the moment it names sits on the
 * current waking-day, so a stale pointer costs nothing — see keel's
 * `docs/superpowers/specs/2026-08-07-active-moment-intention-design.md`.
 */
export const ACTIVE_MOMENT_FILE = "activeMoment.json";

export const ActiveMomentPointerSchema = z.object({
  momentId: z.string().min(1),
  at: z.string().min(1),
});
export type ActiveMomentPointer = z.infer<typeof ActiveMomentPointerSchema>;

export function activeMomentPath(root: string): string {
  return path.join(root, ACTIVE_MOMENT_FILE);
}

/**
 * Read the pointer. Fails soft to `null` — a missing or malformed file means
 * "no intention", never an error, matching the vault's fail-soft rule.
 * Unknown fields are preserved so an older build cannot delete a newer one's.
 */
export function readActiveMoment(
  root: string,
): (ActiveMomentPointer & Record<string, unknown>) | null {
  const file = activeMomentPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const parsed = ActiveMomentPointerSchema.safeParse(raw);
    if (!parsed.success) return null;
    return { ...(raw as Record<string, unknown>), ...parsed.data };
  } catch {
    return null;
  }
}

/** Point the intention at a moment. Atomic, and preserves unknown fields. */
export function writeActiveMoment(
  root: string,
  momentId: string,
  at: string,
): ActiveMomentPointer {
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const existing = readActiveMoment(root) ?? {};
  const next = { ...existing, momentId, at };
  const file = activeMomentPath(root);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return { momentId, at };
}

/** Release the intention. Removing the file IS the empty state — an absent
 * pointer and a pointer to nothing are the same thing to every reader. */
export function clearActiveMoment(root: string): void {
  const file = activeMomentPath(root);
  if (fs.existsSync(file)) fs.rmSync(file);
}
