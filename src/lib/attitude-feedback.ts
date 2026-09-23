/**
 * Attitude Feedback - Computed values for attitude displays
 *
 * Philosophy: Neutral information, not judgment.
 * Shows patterns and rhythms without optimization pressure.
 */

import { differenceInDays, subDays } from "date-fns";
import type { Area } from "@/domain/entities/Area";
import type { Habit } from "@/domain/entities/Habit";
import type { MetricLog } from "@/domain/entities/MetricLog";
import type { Moment } from "@/domain/entities/Moment";
import { attitudeService } from "@/domain/services/AttitudeService";
import { Attitude } from "@/domain/value-objects/Attitude";

/**
 * BEGINNING attitude feedback
 * Shows: Count of times allocated
 */
export function getBeginningFeedback(
  moments: Moment[],
  momentName: string,
): string {
  const count = moments.filter((m) => m.name === momentName).length;

  if (count === 0) return "Not yet tended";
  if (count === 1) return "1st time";
  if (count === 2) return "2nd time";
  if (count === 3) return "3rd time";
  return `${count}th time`;
}

/**
 * KEEPING attitude feedback
 * Shows: Days since last allocation (neutral, not guilt)
 */
export function getKeepingFeedback(
  moments: Moment[],
  momentName: string,
): string {
  // Find all allocated instances of this moment (has a day)
  const allocatedMoments = moments
    .filter((m) => m.name === momentName && m.day !== null)
    .sort((a, b) => {
      if (!a.day || !b.day) return 0;
      return new Date(b.day).getTime() - new Date(a.day).getTime();
    });

  if (allocatedMoments.length === 0) {
    return "Not yet tended";
  }

  const lastAllocation = allocatedMoments[0];
  if (!lastAllocation.day) {
    return "Not yet tended";
  }

  const daysSince = differenceInDays(new Date(), new Date(lastAllocation.day));

  if (daysSince === 0) return "Today";
  if (daysSince === 1) return "Yesterday";
  return `${daysSince} days ago`;
}

/**
 * BUILDING attitude feedback
 * Shows: Frequency patterns over time
 */
export function getBuildingFeedback(
  moments: Moment[],
  momentName: string,
): {
  thisWeek: number;
  thisMonth: number;
  display: string;
} {
  const now = new Date();
  const weekAgo = subDays(now, 7);
  const monthAgo = subDays(now, 30);

  // Only count allocated moments (has a day)
  const allocatedMoments = moments.filter(
    (m) => m.name === momentName && m.day !== null,
  );

  const thisWeek = allocatedMoments.filter((m) => {
    if (!m.day) return false;
    const momentDate = new Date(m.day);
    return momentDate >= weekAgo && momentDate <= now;
  }).length;

  const thisMonth = allocatedMoments.filter((m) => {
    if (!m.day) return false;
    const momentDate = new Date(m.day);
    return momentDate >= monthAgo && momentDate <= now;
  }).length;

  // Format display
  let display = "";
  if (thisWeek > 0) {
    display += `${thisWeek}× this week`;
  }
  if (thisMonth > 0) {
    if (display) display += ", ";
    display += `${thisMonth}× this month`;
  }

  if (!display) {
    display = "Not yet tended";
  }

  return { thisWeek, thisMonth, display };
}

/**
 * PUSHING attitude feedback
 * Shows: Custom performance metrics (user-defined)
 */
export function getPushingFeedback(
  moment: Moment,
  logs: MetricLog[],
): {
  latest: MetricLog | null;
  display: string;
} {
  if (!moment.customMetric) {
    return {
      latest: null,
      display: "No metric defined",
    };
  }

  // Get recent logs for this moment, sorted by date (newest first)
  const recentLogs = logs
    .filter((log) => log.momentId === moment.id)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (recentLogs.length === 0) {
    return {
      latest: null,
      display: `No ${moment.customMetric.name} logged yet`,
    };
  }

  const latest = recentLogs[0];
  let display = `Last: ${latest.value}${moment.customMetric.unit}`;

  if (moment.customMetric.target) {
    display += ` (target: ${moment.customMetric.target}${moment.customMetric.unit})`;
  }

  return { latest, display };
}

/**
 * Get attitude feedback for a moment
 * Returns the appropriate feedback based on the moment's attitude
 *
 * Attitudes are computed from: habit?.attitude ?? area?.attitude ?? null
 */
export function getAttitudeFeedback(
  moment: Moment,
  allMoments: Moment[],
  metricLogs: MetricLog[],
  habits: Record<string, Habit>,
  areas: Record<string, Area>,
): string | null {
  const attitude = attitudeService.getMomentAttitude(moment, habits, areas);

  if (!attitude) {
    return null; // Pure presence - no feedback
  }

  switch (attitude) {
    case Attitude.BEGINNING:
      return getBeginningFeedback(allMoments, moment.name);

    case Attitude.RETURNING:
      // RETURNING shares KEEPING's "days since last" framing (presence-based);
      // the difference is in health tolerance, not in surfaced feedback.
      return getKeepingFeedback(allMoments, moment.name);

    case Attitude.KEEPING:
      return getKeepingFeedback(allMoments, moment.name);

    case Attitude.BUILDING: {
      const { display } = getBuildingFeedback(allMoments, moment.name);
      return display;
    }

    case Attitude.PUSHING: {
      const { display } = getPushingFeedback(moment, metricLogs);
      return display;
    }

    case Attitude.BEING:
      return "Integrated practice";

    default:
      return null;
  }
}

/**
 * Check if a moment should show attitude feedback
 *
 * Attitudes are computed from: habit?.attitude ?? area?.attitude ?? null
 */
export function shouldShowAttitudeFeedback(
  moment: Moment,
  habits: Record<string, Habit>,
  areas: Record<string, Area>,
): boolean {
  const attitude = attitudeService.getMomentAttitude(moment, habits, areas);
  return attitude !== null;
}

/**
 * Get count of allocations for a moment (used by BEGINNING attitude)
 */
export function getAllocationCount(
  moments: Moment[],
  momentName: string,
): number {
  return moments.filter((m) => m.name === momentName).length;
}
