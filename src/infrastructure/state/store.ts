import { observable } from "@legendapp/state";
import type { Area } from "@/domain/entities/Area";
import type { Cycle } from "@/domain/entities/Cycle";
import type { CyclePlan } from "@/domain/entities/CyclePlan";
import type { DayNote } from "@/domain/entities/DayNote";
import type { Habit } from "@/domain/entities/Habit";
import type { MetricLog } from "@/domain/entities/MetricLog";
import type { Moment } from "@/domain/entities/Moment";
import {
  type PhaseConfig,
  getCurrentPhase,
} from "@/domain/value-objects/Phase";
import { getCurrentHour } from "@/lib/dates";
import { readMeta, writeMeta } from "@/infrastructure/vault/meta-repository";
import { cycleDeckSelectedCycleId$ } from "./ui-store";

/**
 * Core application state stored as observables
 *
 * Design decisions:
 * - Stored as Record<string, Entity> (objects keyed by UUID) for:
 *   - Fine-grained reactivity (moments$[id].name.set())
 *   - Direct access via ID (areas$[moment.areaId])
 *   - PostgreSQL-ready structure
 *   - Future Supabase sync compatibility
 *
 * - IndexedDB persistence with:
 *   - Auto-save (500ms debounce built-in)
 *   - Asynchronous I/O (non-blocking)
 *   - Large storage capacity
 *   - Indexed queries support
 */

// ============================================================================
// Core State Observables
// ============================================================================

/**
 * Moments collection - keyed by moment ID
 */
export const moments$ = observable<Record<string, Moment>>({});

/**
 * Areas collection - keyed by area ID
 */
export const areas$ = observable<Record<string, Area>>({});

/**
 * Habits collection - keyed by habit ID
 * Emergent patterns from repeated moments
 */
export const habits$ = observable<Record<string, Habit>>({});

/**
 * Cycles collection - keyed by cycle ID
 */
export const cycles$ = observable<Record<string, Cycle>>({});

/**
 * Active cycle ID - single source of truth for which cycle is active
 * Replaces the previous isActive flag on individual Cycle entities.
 * Only one cycle can be active at a time (enforced by being a single value).
 */
export const activeCycleId$ = observable<string | null>(null);

/**
 * Whether the store has been hydrated from IndexedDB.
 * Used to avoid rendering stale/empty state before persistence loads.
 */
export const storeHydrated$ = observable(false);

/**
 * Cycle plans collection - keyed by cycle plan ID
 * Links habits to cycles with budget counts
 */
export const cyclePlans$ = observable<Record<string, CyclePlan>>({});

/**
 * Phase configurations collection - keyed by config ID
 */
export const phaseConfigs$ = observable<Record<string, PhaseConfig>>({});

/**
 * Metric logs collection - keyed by log ID
 * Performance tracking entries for PUSHING attitude moments
 */
export const metricLogs$ = observable<Record<string, MetricLog>>({});

/**
 * Day notes - keyed by ISO date (YYYY-MM-DD).
 * Optional per-day metadata (title now, room for intention/mood later).
 */
export const dayNotes$ = observable<Record<string, DayNote>>({});

// ============================================================================
// History State
// ============================================================================

/**
 * History state and utilities - undo/redo functionality
 * Imported and re-exported from history.ts
 */
export {
  canRedo,
  canUndo,
  clearHistory,
  endBatch,
  getHistoryStats,
  history$,
  recordOperation,
  redo,
  startBatch,
  undo,
  withBatch,
} from "./history";

/**
 * History middleware - functions to apply operations with history tracking
 * Imported and re-exported from history-middleware.ts
 */
export {
  allocateMomentWithHistory,
  applyInverseOperation,
  applyOperation,
  bulkDeleteMomentsWithHistory,
  clearSelectionWithHistory,
  createMomentWithHistory,
  deleteMomentWithHistory,
  deselectMomentsWithHistory,
  duplicateMomentWithHistory,
  moveMomentWithHistory,
  reorderMomentsWithHistory,
  selectAllWithHistory,
  selectMomentsWithHistory,
  unallocateMomentWithHistory,
  updateMomentWithHistory,
} from "./history-middleware";

// ============================================================================
// Computed Observables
// ============================================================================

/**
 * Time tick counter - incremented on window focus + 60s interval.
 * Forces time-dependent computations to re-evaluate.
 */
export const timeTick$ = observable(0);

/**
 * Current phase derived from timeTick$ + phaseConfigs$.
 * Re-evaluates whenever the tick increments, giving reactive phase transitions.
 */
export const currentPhase$ = observable(() => {
  timeTick$.get(); // Subscribe to tick changes
  const configs = phaseConfigs$.get();
  const hour = getCurrentHour();
  return getCurrentPhase(hour, Object.values(configs));
});

/**
 * All moments that are unallocated (not assigned to any day)
 * Computed from moments$ - automatically updates when moments change
 */
export const unallocatedMoments$ = observable(() => {
  const moments = moments$.get();
  return Object.values(moments).filter((m) => m.day === null);
});

/**
 * All moments that are allocated to a specific day
 * Computed from moments$ - automatically updates when moments change
 */
export const allocatedMoments$ = observable(() => {
  const moments = moments$.get();
  return Object.values(moments).filter((m) => m.day !== null);
});

/**
 * The currently active cycle — purely derived from cycle dates.
 *
 * Rule: pick the cycle whose date range contains today. When several
 * overlap (e.g. Vipassana ongoing + London started later), the latest
 * startDate wins. When no cycle contains today, return null.
 *
 * There is no manual override. To make a cycle active, move its dates
 * to cover today (via the calendar creator or the end-date action).
 */
export const activeCycle$ = observable(() => {
  const cycles = cycles$.get();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  let best: (typeof cycles)[string] | null = null;
  let bestStartMs = -Infinity;

  for (const cycle of Object.values(cycles)) {
    const start = new Date(cycle.startDate);
    start.setHours(0, 0, 0, 0);
    if (start.getTime() > todayMs) continue;

    if (cycle.endDate !== null) {
      const end = new Date(cycle.endDate);
      end.setHours(0, 0, 0, 0);
      if (end.getTime() < todayMs) continue;
    }

    if (start.getTime() > bestStartMs) {
      best = cycle;
      bestStartMs = start.getTime();
    }
  }

  return best;
});

/**
 * The effective cycle for the deck view.
 * Uses the user-selected cycle (via arrow navigation) if set,
 * otherwise falls back to the active cycle.
 */
export const effectiveDeckCycle$ = observable(() => {
  const selectedId = cycleDeckSelectedCycleId$.get();
  if (selectedId) {
    return cycles$[selectedId]?.get() ?? null;
  }
  return activeCycle$.get();
});

/**
 * The current cycle (the one containing today's date)
 * This is the cycle that's actually happening right now
 * Computed from cycles$ - automatically updates when cycles change or date changes
 */
export const currentCycle$ = observable(() => {
  const cycles = cycles$.get();
  const today = new Date().toISOString().split("T")[0];

  return (
    Object.values(cycles).find((cycle) => {
      const startDate = new Date(cycle.startDate);
      startDate.setHours(0, 0, 0, 0);

      if (new Date(today) < startDate) {
        return false;
      }

      if (cycle.endDate === null) {
        return true; // Ongoing cycle
      }

      const endDate = new Date(cycle.endDate);
      endDate.setHours(0, 0, 0, 0);
      return new Date(today) <= endDate;
    }) || null
  );
});

/**
 * All visible phase configurations, sorted by order
 * Computed from phaseConfigs$ - automatically updates when configs change
 */
export const visiblePhases$ = observable(() => {
  const configs = phaseConfigs$.get();
  return Object.values(configs)
    .filter((config) => config.isVisible)
    .sort((a, b) => a.order - b.order);
});

/**
 * All active (non-archived) areas, sorted by order
 * Computed from areas$ - automatically updates when areas change
 * Archived areas are filtered out to keep the UI clean
 */
export const activeAreas$ = observable(() => {
  const allAreas = areas$.get();
  return Object.values(allAreas)
    .filter((area) => !area.isArchived)
    .sort((a, b) => a.order - b.order);
});

/**
 * All archived areas, sorted by updatedAt (most recently archived first)
 * Computed from areas$ - automatically updates when areas change
 */
export const archivedAreas$ = observable(() => {
  const allAreas = areas$.get();
  return Object.values(allAreas)
    .filter((area) => area.isArchived)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
});

/**
 * All active (non-archived) habits, sorted by order
 * Computed from habits$ - automatically updates when habits change
 * Archived habits are filtered out to keep the UI clean
 */
export const activeHabits$ = observable(() => {
  const allHabits = habits$.get();
  return Object.values(allHabits)
    .filter((habit) => !habit.isArchived)
    .sort((a, b) => a.order - b.order);
});

/**
 * All archived habits, sorted by updatedAt (most recently archived first)
 * Computed from habits$ - automatically updates when habits change
 */
export const archivedHabits$ = observable(() => {
  const allHabits = habits$.get();
  return Object.values(allHabits)
    .filter((habit) => habit.isArchived)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
});

/**
 * Moments grouped by day
 * Useful for timeline rendering
 */
export const momentsByDay$ = observable(() => {
  const moments = allocatedMoments$.get();
  return moments.reduce(
    (acc, moment) => {
      if (!moment.day) return acc;
      if (!acc[moment.day]) {
        acc[moment.day] = [];
      }
      acc[moment.day].push(moment);
      return acc;
    },
    {} as Record<string, Moment[]>,
  );
});

/**
 * Moments grouped by (day, phase) for grid rendering
 * Returns structure: { "2025-01-15": { "MORNING": [...], "AFTERNOON": [...] } }
 */
export const momentsByDayAndPhase$ = observable(() => {
  const moments = allocatedMoments$.get();
  return moments.reduce(
    (acc, moment) => {
      if (!moment.day || !moment.phase) return acc;

      if (!acc[moment.day]) {
        acc[moment.day] = {};
      }

      if (!acc[moment.day][moment.phase]) {
        acc[moment.day][moment.phase] = [];
      }

      acc[moment.day][moment.phase].push(moment);
      return acc;
    },
    {} as Record<string, Record<string, Moment[]>>,
  );
});

/**
 * All unique tags across all moments, sorted alphabetically
 * Computed from moments$ - automatically updates when moments change
 */
export const allTags$ = observable(() => {
  const moments = moments$.get();
  const tagsSet = new Set<string>();

  for (const moment of Object.values(moments)) {
    if (!moment.tags) continue;

    for (const tag of moment.tags) {
      tagsSet.add(tag);
    }
  }

  return Array.from(tagsSet).sort();
});

/**
 * Tag usage count - how many moments have each tag
 * Returns structure: { "running": 8, "creative": 5, ... }
 */
export const tagUsageCount$ = observable(() => {
  const moments = moments$.get();
  const counts: Record<string, number> = {};

  for (const moment of Object.values(moments)) {
    if (!moment.tags) continue;

    for (const tag of moment.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  return counts;
});

/**
 * Moments grouped by tag
 * Returns structure: { "running": [...moments], "creative": [...moments] }
 */
export const momentsByTag$ = observable(() => {
  const moments = moments$.get();
  const byTag: Record<string, Moment[]> = {};

  for (const moment of Object.values(moments)) {
    if (!moment.tags) continue;
    for (const tag of moment.tags) {
      if (!byTag[tag]) {
        byTag[tag] = [];
      }
      byTag[tag].push(moment);
    }
  }

  return byTag;
});

// ============================================================================
// Unified Tag Observables (Moments + Areas + Habits)
// ============================================================================

/**
 * All unique tags across moments, areas, and habits, sorted alphabetically
 * Computed from moments$, areas$, habits$ - automatically updates when any change
 */
export const allUnifiedTags$ = observable(() => {
  const moments = moments$.get();
  const areas = areas$.get();
  const habits = habits$.get();
  const tagsSet = new Set<string>();

  // Collect tags from moments
  for (const moment of Object.values(moments)) {
    if (!moment.tags) continue;
    for (const tag of moment.tags) {
      tagsSet.add(tag);
    }
  }

  // Collect tags from areas
  for (const area of Object.values(areas)) {
    if (!area.tags) continue;
    for (const tag of area.tags) {
      tagsSet.add(tag);
    }
  }

  // Collect tags from habits
  for (const habit of Object.values(habits)) {
    if (!habit.tags) continue;
    for (const tag of habit.tags) {
      tagsSet.add(tag);
    }
  }

  return Array.from(tagsSet).sort();
});

/**
 * Unified tag usage count - how many entities (moments + areas + habits) have each tag
 * Returns structure: { "running": 12, "creative": 8, ... }
 */
export const unifiedTagUsageCount$ = observable(() => {
  const moments = moments$.get();
  const areas = areas$.get();
  const habits = habits$.get();
  const counts: Record<string, number> = {};

  // Count from moments
  for (const moment of Object.values(moments)) {
    if (!moment.tags) continue;
    for (const tag of moment.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  // Count from areas
  for (const area of Object.values(areas)) {
    if (!area.tags) continue;
    for (const tag of area.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  // Count from habits
  for (const habit of Object.values(habits)) {
    if (!habit.tags) continue;
    for (const tag of habit.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  return counts;
});

/**
 * Metric logs grouped by moment ID
 * Returns structure: { "moment-id": [...logs], ... }
 */
export const metricLogsByMoment$ = observable(() => {
  const logs = metricLogs$.get();
  const byMoment: Record<string, MetricLog[]> = {};

  for (const log of Object.values(logs)) {
    if (!byMoment[log.momentId]) {
      byMoment[log.momentId] = [];
    }
    byMoment[log.momentId].push(log);
  }

  // Sort logs by date (newest first) for each moment
  for (const momentId in byMoment) {
    byMoment[momentId].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }

  return byMoment;
});

// ============================================================================
// Cycle-Specific Computed Observables
// ============================================================================

/**
 * Moments in the cycle deck (unallocated but budgeted)
 * These are moments created from cycle plans that haven't been allocated yet
 * Filtered by the effective deck cycle (selected or active)
 */
export const deckMoments$ = observable(() => {
  const moments = moments$.get();
  const cycle = effectiveDeckCycle$.get();

  if (!cycle) return [];

  return Object.values(moments).filter(
    (m) =>
      m.cycleId === cycle.id &&
      m.cyclePlanId !== null &&
      m.day === null &&
      m.phase === null,
  );
});

/**
 * Allocated moments in the active cycle
 */
export const allocatedMomentsInCycle$ = observable(() => {
  const moments = moments$.get();
  const cycle = activeCycle$.get();

  if (!cycle) return [];

  return Object.values(moments).filter(
    (m) => m.cycleId === cycle.id && m.day !== null && m.phase !== null,
  );
});

/**
 * Spontaneous moments in the active cycle (not from budget)
 */
export const spontaneousMomentsInCycle$ = observable(() => {
  const moments = moments$.get();
  const cycle = activeCycle$.get();

  if (!cycle) return [];

  return Object.values(moments).filter(
    (m) =>
      m.cycleId === cycle.id &&
      m.cyclePlanId === null &&
      m.day !== null &&
      m.phase !== null,
  );
});

/**
 * Cycle plans for the active cycle
 */
export const activeCyclePlans$ = observable(() => {
  const plans = cyclePlans$.get();
  const activeCycle = activeCycle$.get();

  if (!activeCycle) return [];

  return Object.values(plans).filter((p) => p.cycleId === activeCycle.id);
});

/**
 * Deck moments grouped by area, then by habit
 * Returns structure: { "area-id": { "habit-id": [...moments] } }
 * Used for rendering the cycle deck with stacks
 * Habits are sorted by habit.order for stable visual ordering
 */
export const deckMomentsByAreaAndHabit$ = observable(() => {
  const deckMoments = deckMoments$.get();
  const allHabits = habits$.get();
  const byArea: Record<string, Record<string, Moment[]>> = {};

  for (const moment of deckMoments) {
    if (!byArea[moment.areaId]) {
      byArea[moment.areaId] = {};
    }

    const habitId = moment.habitId || "standalone";
    if (!byArea[moment.areaId][habitId]) {
      byArea[moment.areaId][habitId] = [];
    }

    byArea[moment.areaId][habitId].push(moment);
  }

  // Sort habit keys within each area by habit.order
  const sorted: Record<string, Record<string, Moment[]>> = {};
  for (const areaId of Object.keys(byArea)) {
    const habitIds = Object.keys(byArea[areaId]);
    habitIds.sort((a, b) => {
      const habitA = allHabits[a];
      const habitB = allHabits[b];
      return (habitA?.order ?? 999) - (habitB?.order ?? 999);
    });

    sorted[areaId] = {};
    for (const habitId of habitIds) {
      sorted[areaId][habitId] = byArea[areaId][habitId];
    }
  }

  return sorted;
});

// ============================================================================
// Database Management
// ============================================================================

/**
 * One-shot boot migration for the derive-deck paradigm.
 *
 * On first boot after the migration:
 *  - reads the `zenborg:meta` flag `migrations.derivedDeck`
 *  - if false, runs `CycleService.reconcileLegacyDeckMoments()` which deletes
 *    leftover unallocated plan-linked moments from the old
 *    materialize-on-budget paradigm
 *  - flips the flag so subsequent boots are no-ops
 *
 * Uses a dynamic import of `CycleService` to avoid the
 * store → CycleService → store circular import.
 */
export async function runBootReconciler(): Promise<void> {
  const meta = readMeta();
  if (meta.migrations.derivedDeck) return;

  const { CycleService } = await import("@/application/services/CycleService");
  const service = new CycleService();
  const { deleted } = service.reconcileLegacyDeckMoments();
  if (deleted > 0) {
    console.log(`[migration] reconciled ${deleted} legacy deck moment(s)`);
  }

  meta.migrations.derivedDeck = true;
  writeMeta(meta);
}

/**
 * Reset all data to initial state
 * WARNING: This permanently deletes all moments, areas, habits, cycles, metric logs, and settings
 */
export function resetDatabase() {
  console.log("[resetDatabase] Resetting all data...");

  // Clear all observables
  moments$.set({});
  areas$.set({});
  habits$.set({});
  cycles$.set({});
  activeCycleId$.set(null);
  cyclePlans$.set({});
  phaseConfigs$.set({});
  metricLogs$.set({});

  console.log("[resetDatabase] Database reset complete");

  // Note: IndexedDB will be cleared automatically by Legend State persistence
  // The initialize.ts will re-seed default data on next load
}
