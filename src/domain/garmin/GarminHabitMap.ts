/**
 * GarminHabitMap — Garmin activity type → zenborg habit.
 *
 * The sibling of area surfaces (paths/hosts/apps → area). Same spirit,
 * different owner: the surface index is the garden's business. The consumer
 * of THIS map is whatever plants moments from Garmin, and zenborg is the
 * writer for `moments`. So it is zenborg's business, and stays local to
 * the vault.
 *
 * Why this exists: zenborg's wilting signal measures *logging*, not *living*.
 * Habits flagged 50–96 days dark are happening several times a week; the
 * garden simply never hears about it. Garmin already holds the ground truth.
 *
 * ## Shape, and why it differs from area surfaces
 *
 * Area surfaces are `string[]` on each area — they can afford opaque
 * UUIDs because the surface index resolves names live from `areas.json`.
 * This map cannot. An activity type and its habit need not share a name
 * (`soccer → footy`), and a bare UUID gives a future reader — human or
 * agent — nothing to check it against. The name travels inline so each
 * mapping can be audited by eye.
 *
 * Everything here is pure. Nothing reads the filesystem or the network.
 */

/** A single Garmin activity, narrowed to the fields the map reasons about.
 * Mirrors `mcp__garmin__get_activities_by_date`; extra fields are ignored. */
export interface GarminActivity {
  readonly id: number | string;
  readonly type: string;
  readonly name?: string;
  readonly start_time?: string;
  readonly distance_meters?: number;
  readonly duration_seconds?: number;
  readonly calories?: number;
  readonly avg_hr_bpm?: number;
  readonly max_hr_bpm?: number;
}

/** One confirmed edge: a Garmin activity type resolves to exactly one habit. */
export interface HabitMapping {
  readonly habitId: string;
  /** Carried for human audit. Never trusted over `habitId`. */
  readonly habitName: string;
  readonly note?: string;
}

/** A type whose destination is genuinely undecided. Never silently resolved.
 *
 * `reason` says why it is open; `recommendation` is this repo's opinion.
 * Both are surfaced to the user rather than acted on. */
export interface PendingMapping {
  readonly reason: string;
  readonly recommendation: string;
  /** Candidate habits, when the ambiguity is "which of these". */
  readonly candidates?: readonly HabitMapping[];
}

export interface GarminHabitMap {
  readonly version: 1;
  readonly mappings: Readonly<Record<string, HabitMapping>>;
  readonly pending: Readonly<Record<string, PendingMapping>>;
}

/** The outcome of asking the map about one activity. Total — every activity
 * lands in exactly one of these three, and `unknown` is not an error. */
export type Resolution =
  | {
      readonly kind: "mapped";
      readonly activity: GarminActivity;
      readonly mapping: HabitMapping;
    }
  | {
      readonly kind: "pending";
      readonly activity: GarminActivity;
      readonly pending: PendingMapping;
    }
  | { readonly kind: "unknown"; readonly activity: GarminActivity };

const EMPTY_MAP: GarminHabitMap = { version: 1, mappings: {}, pending: {} };

/**
 * Parse an untrusted value into a map.
 *
 * Fails soft to an empty map, per the vault's "a missing or malformed
 * collection means *empty*, never an error" rule. A map that fails to parse
 * must degrade to "nothing is mapped" — which produces zero writes — rather
 * than to a partially-understood map, which produces wrong ones.
 */
export function parseHabitMap(raw: unknown): GarminHabitMap {
  if (typeof raw !== "object" || raw === null) return EMPTY_MAP;
  const obj = raw as Record<string, unknown>;

  const mappings: Record<string, HabitMapping> = {};
  const rawMappings = obj.mappings;
  if (typeof rawMappings === "object" && rawMappings !== null) {
    for (const [type, value] of Object.entries(rawMappings)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.habitId !== "string" || entry.habitId.length === 0)
        continue;
      mappings[type] = {
        habitId: entry.habitId,
        habitName: typeof entry.habitName === "string" ? entry.habitName : "",
        ...(typeof entry.note === "string" ? { note: entry.note } : {}),
      };
    }
  }

  const pending: Record<string, PendingMapping> = {};
  const rawPending = obj.pending;
  if (typeof rawPending === "object" && rawPending !== null) {
    for (const [type, value] of Object.entries(rawPending)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      pending[type] = {
        reason: typeof entry.reason === "string" ? entry.reason : "",
        recommendation:
          typeof entry.recommendation === "string" ? entry.recommendation : "",
        ...(Array.isArray(entry.candidates)
          ? {
              candidates: entry.candidates
                .filter(
                  (c): c is Record<string, unknown> =>
                    typeof c === "object" && c !== null,
                )
                .filter((c) => typeof c.habitId === "string")
                .map((c) => ({
                  habitId: c.habitId as string,
                  habitName: typeof c.habitName === "string" ? c.habitName : "",
                  ...(typeof c.note === "string" ? { note: c.note } : {}),
                })),
            }
          : {}),
      };
    }
  }

  return { version: 1, mappings, pending };
}

/** Resolve one activity. A type listed in `pending` NEVER resolves to a habit,
 * even if it also appears in `mappings` — undecided outranks decided, so a
 * half-finished edit cannot start writing moments. */
export function resolveActivity(
  map: GarminHabitMap,
  activity: GarminActivity,
): Resolution {
  const pending = map.pending[activity.type];
  if (pending !== undefined) return { kind: "pending", activity, pending };

  const mapping = map.mappings[activity.type];
  if (mapping !== undefined) return { kind: "mapped", activity, mapping };

  return { kind: "unknown", activity };
}

export function resolveActivities(
  map: GarminHabitMap,
  activities: readonly GarminActivity[],
): readonly Resolution[] {
  return activities.map((a) => resolveActivity(map, a));
}

/** A problem found by checking the map against the live garden. */
export interface MapIntegrityIssue {
  readonly type: string;
  readonly habitId: string;
  readonly detail: string;
}

/** Cross-check every `habitId` against the habits that actually exist.
 *
 * Habits are archived and renamed in zenborg; a map is a set of foreign keys
 * into a collection this tool does not own. Verifying beats trusting, and a
 * dangling id must be reported rather than written.
 *
 * `habits` is the vault's `habits.json` value-set, or any subset carrying
 * `id` / `name` / `isArchived`.
 */
export function checkMapIntegrity(
  map: GarminHabitMap,
  habits: readonly { id: string; name?: string; isArchived?: boolean }[],
): readonly MapIntegrityIssue[] {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const issues: MapIntegrityIssue[] = [];

  for (const [type, mapping] of Object.entries(map.mappings)) {
    const habit = byId.get(mapping.habitId);
    if (habit === undefined) {
      issues.push({
        type,
        habitId: mapping.habitId,
        detail: `no habit with this id exists in the vault`,
      });
      continue;
    }
    if (habit.isArchived === true) {
      issues.push({
        type,
        habitId: mapping.habitId,
        detail: `habit "${habit.name ?? "?"}" is archived`,
      });
    }
    if (
      mapping.habitName.length > 0 &&
      habit.name !== undefined &&
      habit.name !== mapping.habitName
    ) {
      issues.push({
        type,
        habitId: mapping.habitId,
        detail: `map says "${mapping.habitName}", vault says "${habit.name}" — habit was renamed`,
      });
    }
  }

  return issues;
}

/** Per-type tallies over a resolved batch, for the report. */
export interface CoverageRow {
  readonly type: string;
  readonly count: number;
  readonly status: Resolution["kind"];
  readonly habitName?: string;
}

export function coverage(
  resolutions: readonly Resolution[],
): readonly CoverageRow[] {
  const rows = new Map<string, { count: number; r: Resolution }>();
  for (const r of resolutions) {
    const existing = rows.get(r.activity.type);
    if (existing === undefined) rows.set(r.activity.type, { count: 1, r });
    else existing.count += 1;
  }
  return [...rows.entries()]
    .map(([type, { count, r }]) => ({
      type,
      count,
      status: r.kind,
      ...(r.kind === "mapped" ? { habitName: r.mapping.habitName } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
