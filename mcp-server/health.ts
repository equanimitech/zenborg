import type { CyclePlan as DomainCyclePlan } from "../src/domain/entities/CyclePlan.ts";
import type { Habit as DomainHabit } from "../src/domain/entities/Habit.ts";
import type { Moment as DomainMoment } from "../src/domain/entities/Moment.ts";
import { habitHealthService } from "../src/domain/services/HabitHealthService.ts";
import type { Health } from "../src/domain/value-objects/Health.ts";
import type { CyclePlan, Habit, Moment, Rhythm } from "./vault.js";

export type { Health };

/**
 * Mirrors src/domain/entities/Moment.ts countsAsAllocation (spec D5).
 * The single predicate every aggregating filter composes with, so the
 * call sites cannot drift apart on what counts.
 */
export function countsAsAllocation(moment: Moment): boolean {
  return moment.status !== "tentative";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a YYYY-MM-DD vault date string as local midnight.
 * Using bare `new Date(dayString)` would parse as UTC midnight, which drifts
 * by a day in negative UTC offsets at day boundaries. Matches the domain
 * side's `fromISODate` behavior from `src/lib/dates.ts`.
 */
export function parseVaultDay(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

export function resolveRhythm(
  habit: Habit,
  plan: CyclePlan | null,
): Rhythm | null {
  return plan?.rhythmOverride ?? habit.rhythm ?? null;
}

/**
 * Health is the domain's (`HabitHealthService`), so the app, the MCP server
 * and the week readback cannot disagree. The vault types differ from the
 * domain's only in enum-vs-literal spelling, hence the casts at this edge.
 */
export function computeHealth(
  habit: Habit,
  plan: CyclePlan | null,
  moments: Moment[],
  now: Date,
): Health {
  return habitHealthService.computeHealth(
    habit as unknown as DomainHabit,
    plan as unknown as DomainCyclePlan | null,
    moments as unknown as DomainMoment[],
    now,
  );
}

/** Like the domain's: a moment planted after `now` has not happened yet. */
function latestAllocationDate(moments: Moment[], now: Date): Date | null {
  let latest: Date | null = null;
  for (const m of moments) {
    if (!countsAsAllocation(m)) continue;
    if (m.day === null) continue;
    const d = parseVaultDay(m.day);
    if (d > now) continue;
    if (latest === null || d > latest) latest = d;
  }
  return latest;
}

export function daysSinceLast(
  habitId: string,
  moments: Moment[],
  now: Date,
): number | null {
  // Same widening as `computeHealth` — these two are emitted side by side in
  // get_habit_health / list_wilting_habits, so a narrower filter here would
  // report "90 days" next to a "blooming" derived from the very same moments.
  const habitMoments = moments.filter(
    (m) =>
      countsAsAllocation(m) &&
      (m.habitId === habitId || (m.personIds?.includes(habitId) ?? false)),
  );
  const last = latestAllocationDate(habitMoments, now);
  if (last === null) return null;
  return Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY);
}
