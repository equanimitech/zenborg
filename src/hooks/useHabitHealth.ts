"use client";

import { use$ } from "@legendapp/state/react";
import { habitHealthService } from "@/domain/services/HabitHealthService";
import type { Health } from "@/domain/value-objects/Health";
import {
  activeCycleId$,
  cyclePlans$,
  habits$,
  moments$,
} from "@/infrastructure/state/store";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface HabitHealthSnapshot {
  health: Health;
  daysSinceLast: number | null;
}

/**
 * Returns the current computed health for a habit, plus days since its last
 * allocation. Recomputes whenever habits, moments, active cycle, or plans change.
 */
export function useHabitHealth(habitId: string): HabitHealthSnapshot {
  const habit = use$(habits$[habitId]);
  const allMoments = use$(moments$);
  const allPlans = use$(cyclePlans$);
  const activeCycleId = use$(activeCycleId$);

  if (!habit) return { health: "unstated", daysSinceLast: null };

  const plan = activeCycleId
    ? (Object.values(allPlans).find(
        (p) => p.cycleId === activeCycleId && p.habitId === habitId
      ) ?? null)
    : null;

  const momentsList = Object.values(allMoments);
  const now = new Date();

  const health = habitHealthService.computeHealth(habit, plan, momentsList, now);

  const habitMoments = momentsList.filter((m) => m.habitId === habitId);
  const latest = habitHealthService.latestAllocationDate(habitMoments, now);
  const daysSinceLast =
    latest === null
      ? null
      : Math.floor((now.getTime() - latest.getTime()) / MS_PER_DAY);

  return { health, daysSinceLast };
}
