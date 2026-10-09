import { fromISODate } from "../../lib/dates";
import type { CyclePlan } from "../entities/CyclePlan";
import type { Habit } from "../entities/Habit";
import {
  countsAsAllocation,
  type Moment,
  momentInvolvesHabit,
} from "../entities/Moment";
import { Attitude } from "../value-objects/Attitude";
import type { Health } from "../value-objects/Health";
import {
  PERIOD_DAYS,
  type Rhythm,
  rhythmSilenceThresholdDays,
} from "../value-objects/Rhythm";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BUDDING_PERIOD_COUNT = 3;
/**
 * RETURNING extends the KEEPING silence threshold to acknowledge re-engagement
 * friction. A returning practitioner has prior identity work; their tolerance
 * for gaps should sit between BEGINNING (no wilt) and KEEPING (strict threshold).
 */
const RETURNING_THRESHOLD_MULTIPLIER = 1.5;
const RETURNING_REENTRY_PERIODS = 3;
const RETURNING_REENTRY_COUNT = 3;

/**
 * HabitHealthService — pure derivation of per-habit health from
 * attitude, effective rhythm, and allocation history.
 *
 * Health is NEVER stored. Recomputed on every read.
 * Effective rhythm = cyclePlan.rhythmOverride ?? habit.rhythm ?? null.
 */
export class HabitHealthService {
  resolveRhythm(habit: Habit, cyclePlan: CyclePlan | null): Rhythm | null {
    return cyclePlan?.rhythmOverride ?? habit.rhythm ?? null;
  }

  computeHealth(
    habit: Habit,
    cyclePlan: CyclePlan | null,
    moments: Moment[],
    now: Date,
  ): Health {
    const attitude = habit.attitude;
    if (attitude === null) return "unstated";
    if (attitude === Attitude.BEING) return "evergreen";

    const rhythm = this.resolveRhythm(habit, cyclePlan);
    // A moment belongs to this habit when it was planted against it OR when it
    // names it among the people present — see `momentInvolvesHabit`. Every read
    // that derives history from the moment log shares that one predicate, so
    // health and the `daysSinceLast` emitted beside it cannot disagree.
    // The attitude gate above is untouched: person health still lives in
    // PersonService, standalone and attitude-free.
    const habitMoments = moments.filter(
      (m) => countsAsAllocation(m) && momentInvolvesHabit(m, habit.id),
    );

    switch (attitude) {
      case Attitude.BEGINNING:
        return this.computeBeginning(habitMoments);
      case Attitude.RETURNING:
        return this.computeReturning(rhythm, habitMoments, now);
      case Attitude.KEEPING:
        return this.computeKeeping(rhythm, habitMoments, now);
      case Attitude.PRUNING:
        return this.computePruning(rhythm);
      case Attitude.BUILDING:
        return this.computePaced(habit, rhythm, habitMoments, now, 0.2);
      case Attitude.PUSHING:
        return this.computePaced(habit, rhythm, habitMoments, now, 0);
      default:
        return "unstated";
    }
  }

  private computeBeginning(habitMoments: Moment[]): Health {
    return habitMoments.length >= 5 ? "budding" : "seedling";
  }

  private computeKeeping(
    rhythm: Rhythm | null,
    habitMoments: Moment[],
    now: Date,
  ): Health {
    if (!rhythm) return "unstated";
    const threshold = rhythmSilenceThresholdDays(rhythm);

    const lastAllocation = this.latestAllocationDate(habitMoments, now);
    if (lastAllocation === null) return "wilting";

    const daysSince = (now.getTime() - lastAllocation.getTime()) / MS_PER_DAY;
    return daysSince <= threshold ? "blooming" : "wilting";
  }

  private computePruning(rhythm: Rhythm | null): Health {
    if (!rhythm) return "unstated";
    return "dormant";
  }

  /**
   * RETURNING — silence threshold × 1.5, plus a re-entry budding grace.
   * After a lapse, the first few allocations show "budding" (on-ramp)
   * before rhythm compliance is expected. This means a 6-month break
   * gets a gentler re-entry than a 1-week gap — you need to show up
   * consistently before the system expects rhythm.
   */
  private computeReturning(
    rhythm: Rhythm | null,
    habitMoments: Moment[],
    now: Date,
  ): Health {
    if (!rhythm) return "unstated";
    const baseThreshold = rhythmSilenceThresholdDays(rhythm);
    const extendedThreshold = baseThreshold * RETURNING_THRESHOLD_MULTIPLIER;

    const lastAllocation = this.latestAllocationDate(habitMoments, now);
    if (lastAllocation === null) return "wilting";

    const daysSinceLast =
      (now.getTime() - lastAllocation.getTime()) / MS_PER_DAY;
    if (daysSinceLast > extendedThreshold) return "wilting";

    const reEntryWindowDays = extendedThreshold * RETURNING_REENTRY_PERIODS;
    const reEntryWindowStart = new Date(
      now.getTime() - reEntryWindowDays * MS_PER_DAY,
    );
    const recentCount = habitMoments.filter((m) => {
      if (m.day === null) return false;
      const d = fromISODate(m.day);
      return d >= reEntryWindowStart && d <= now;
    }).length;

    if (recentCount < RETURNING_REENTRY_COUNT) return "budding";
    return "blooming";
  }

  private computePaced(
    habit: Habit,
    rhythm: Rhythm | null,
    habitMoments: Moment[],
    now: Date,
    toleranceFraction: number,
  ): Health {
    if (!rhythm) return "unstated";

    const periodDays = PERIOD_DAYS[rhythm.period];
    const buddingWindowDays = periodDays * BUDDING_PERIOD_COUNT;
    const habitUpdatedAt = new Date(habit.updatedAt);
    const daysSinceHabitUpdate =
      (now.getTime() - habitUpdatedAt.getTime()) / MS_PER_DAY;
    if (daysSinceHabitUpdate < buddingWindowDays) return "budding";

    const periodStart = new Date(now.getTime() - periodDays * MS_PER_DAY);
    const countInPeriod = habitMoments.filter((m) => {
      if (m.day === null) return false;
      const dayDate = new Date(m.day);
      return (
        dayDate.getTime() >= periodStart.getTime() &&
        dayDate.getTime() <= now.getTime()
      );
    }).length;

    const daysElapsed = Math.min(periodDays, daysSinceHabitUpdate);
    const expectedByNow = rhythm.count * (daysElapsed / periodDays);
    const tolerance =
      toleranceFraction > 0
        ? Math.max(1, Math.floor(rhythm.count * toleranceFraction))
        : 0;

    return countInPeriod + tolerance >= expectedByNow ? "blooming" : "wilting";
  }

  public latestAllocationDate(
    habitMoments: Moment[],
    now: Date | null = null,
  ): Date | null {
    let latest: Date | null = null;
    for (const m of habitMoments) {
      if (!countsAsAllocation(m)) continue;
      if (m.day === null) continue;
      const d = fromISODate(m.day);
      if (now !== null && d > now) continue;
      if (latest === null || d > latest) latest = d;
    }
    return latest;
  }
}

export const habitHealthService = new HabitHealthService();
