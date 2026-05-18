import type { Area } from "@/domain/entities/Area";
import {
  type Cycle,
  type CycleResult,
  createCycle,
  isDateInCycle,
} from "@/domain/entities/Cycle";
import {
  type CyclePlan,
  type CyclePlanResult,
  createCyclePlan,
  updateCyclePlanBudget,
} from "@/domain/entities/CyclePlan";
import {
  allocateMoment,
  createMoment,
  type Moment,
  type MomentResult,
} from "@/domain/entities/Moment";
import {
  activeCycle$,
  activeCycleId$,
  areas$,
  cyclePlans$,
  cycles$,
  habits$,
  moments$,
} from "@/infrastructure/state/store";
import {
  calculateDefaultEndDate,
  calculateDefaultStartDate,
  calculateTemplateDates,
  findOverlappingCycle,
  generateCycleName,
  getDayBefore,
  type TemplateDuration,
} from "@/domain/services/CycleDateService";
import {
  rhythmToCycleBudget,
  type Rhythm,
} from "@/domain/value-objects/Rhythm";
import { Attitude } from "@/domain/value-objects/Attitude";
import type { Phase } from "@/domain/value-objects/Phase";
import { habitHealthService } from "@/domain/services/HabitHealthService";
import type { Health } from "@/domain/value-objects/Health";
import { formatCycleDateRange, fromISODate, toISODate } from "@/lib/dates";
import { differenceInCalendarDays } from "date-fns";

// Re-export TemplateDuration for backward compatibility
export type { TemplateDuration };

export type CyclePlanningProposalReason =
  | "wilting"
  | "on-rhythm"
  | "beginning";

export interface CyclePlanningProposal {
  habitId: string;
  habitName: string;
  areaId: string;
  attitude: Attitude | null;
  suggestedRhythm: Rhythm | null;
  suggestedCount: number;
  reason: CyclePlanningProposalReason;
  currentHealth: Health;
  daysSinceLast: number | null;
}

export interface CycleReviewHabit {
  habitId: string;
  habitName: string;
  areaId: string;
  attitude: Attitude | null;
  rhythmSnapshot: Rhythm | null;
  budgetedCount: number | null;
  actualCount: number;
  startHealth: Health;
  endHealth: Health;
  firstAllocation: string | null;
  lastAllocation: string | null;
  longestGapDays: number | null;
}

export interface CycleReview {
  cycleId: string;
  cycleName: string;
  startDate: string;
  endDate: string | null;
  habits: CycleReviewHabit[];
  unplannedMoments: Moment[];
  totalMoments: number;
}

/**
 * Application Service for Cycle Management
 *
 * Orchestrates cycle planning, activation, and budget management with
 * Legend State store integration.
 *
 * Business Rules:
 * 1. Only one cycle can be active at a time
 * 2. Cycles must not overlap (validate date ranges)
 * 3. Cycles can start on the same day previous cycle ended
 * 4. Template durations align to calendar boundaries
 * 5. Cycle plans materialize as budgeted moments
 */
export class CycleService {
  /**
   * Gets the default start date for a new cycle
   *
   * Business Rule: New cycles start on the same day the last cycle ended,
   * or tomorrow if no cycles exist
   *
   * @returns ISO date string for default start date
   */
  getDefaultStartDate(): string {
    const allCycles = Object.values(cycles$.get());
    return calculateDefaultStartDate(allCycles);
  }

  /**
   * Quick-creates a cycle from a template: calculates dates, generates name,
   * plans the cycle, and activates it in one step.
   *
   * @param template - Template duration (week, 2-week, month, quarter)
   * @returns Created and activated cycle, or error
   */
  quickCreateCycle(template: TemplateDuration): CycleResult {
    const allCycles = Object.values(cycles$.get());
    const { startDate, endDate } = calculateTemplateDates(template, allCycles);
    const name = generateCycleName(template, fromISODate(startDate));

    const result = this.planCycle(name, undefined, startDate, endDate);
    if ("error" in result) return result;

    return this.activateCycle(result.id);
  }

  /**
   * Plans a new cycle with template duration or manual dates
   *
   * @param name - Cycle name
   * @param templateDuration - Optional template (week, 2-week, month, quarter)
   * @param startDate - Optional manual start date (overrides template)
   * @param endDate - Optional manual end date (overrides template)
   * @returns Created cycle or error if validation fails
   */
  planCycle(
    name: string,
    templateDuration?: TemplateDuration,
    startDate?: string,
    endDate?: string,
    intention?: string | null
  ): CycleResult {
    let calculatedStartDate: string;
    let calculatedEndDate: string | null;

    const allCycles = Object.values(cycles$.get());

    // Calculate dates from template if provided and no manual override
    if (templateDuration && !startDate) {
      const dates = calculateTemplateDates(templateDuration, allCycles);
      calculatedStartDate = dates.startDate;
      calculatedEndDate = dates.endDate;
    } else if (startDate) {
      // Use manual dates
      calculatedStartDate = startDate;
      calculatedEndDate = endDate || null;
    } else {
      return { error: "Either templateDuration or startDate must be provided" };
    }

    // Validate non-overlapping with existing cycles
    const updatedCycles = Object.values(cycles$.get());
    const overlapping = findOverlappingCycle(
      updatedCycles,
      calculatedStartDate,
      calculatedEndDate
    );

    if (overlapping) {
      const range = formatCycleDateRange(
        overlapping.startDate,
        overlapping.endDate
      );
      return {
        error: `Cycle dates overlap with "${overlapping.name}" (${range})`,
      };
    }

    // Create cycle (not active yet — activation is done via activeCycleId$)
    const result = createCycle({
      name,
      startDate: calculatedStartDate,
      endDate: calculatedEndDate,
      intention: intention ?? null,
    });

    if ("error" in result) {
      return result;
    }

    // Add to store
    cycles$[result.id].set(result);

    return result;
  }


  /**
   * Updates a cycle's name and/or dates
   *
   * @param cycleId - ID of cycle to update
   * @param updates - Partial cycle updates (name, startDate, endDate)
   * @returns Updated cycle or error
   */
  updateCycle(
    cycleId: string,
    updates: {
      name?: string;
      startDate?: string;
      endDate?: string | null;
      intention?: string | null;
      reflection?: string | null;
    }
  ): CycleResult {
    const cycle = cycles$[cycleId].get();
    if (!cycle) {
      return { error: `Cycle with ID ${cycleId} not found` };
    }

    // Apply updates
    const updatedCycle: Cycle = {
      ...cycle,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.startDate !== undefined && { startDate: updates.startDate }),
      ...(updates.endDate !== undefined && { endDate: updates.endDate }),
      ...(updates.intention !== undefined && { intention: updates.intention }),
      ...(updates.reflection !== undefined && { reflection: updates.reflection }),
      updatedAt: new Date().toISOString(),
    };

    // If dates changed, validate non-overlapping with other cycles
    if (updates.startDate || updates.endDate !== undefined) {
      const allCycles = Object.values(cycles$.get()).filter(
        (c) => c.id !== cycleId
      );
      const overlapping = findOverlappingCycle(
        allCycles,
        updatedCycle.startDate,
        updatedCycle.endDate
      );

      if (overlapping) {
        const range = formatCycleDateRange(
          overlapping.startDate,
          overlapping.endDate
        );
        return {
          error: `Cycle dates overlap with "${overlapping.name}" (${range})`,
        };
      }
    }

    // Update store
    cycles$[cycleId].set(updatedCycle);

    return updatedCycle;
  }

  /**
   * Ends an ongoing cycle by setting its end date.
   *
   * If endDate is omitted, uses a smart default: the earlier of today and
   * the day before the next cycle's start date (prevents accidental overlap).
   *
   * @param cycleId - ID of cycle to end
   * @param endDate - Optional explicit end date (ISO string)
   * @returns Updated cycle or error
   */
  endCycle(cycleId: string, endDate?: string): CycleResult {
    const cycle = cycles$[cycleId].get();
    if (!cycle) {
      return { error: `Cycle with ID ${cycleId} not found` };
    }

    const resolvedEndDate =
      endDate ?? calculateDefaultEndDate(cycle, Object.values(cycles$.get()));

    return this.updateCycle(cycleId, { endDate: resolvedEndDate });
  }

  /**
   * Deletes a cycle and all its associated data
   *
   * @param cycleId - ID of cycle to delete
   * @returns Success true or error
   */
  deleteCycle(cycleId: string): { success: true } | { error: string } {
    const cycle = cycles$[cycleId].get();
    if (!cycle) {
      return { error: `Cycle with ID ${cycleId} not found` };
    }

    // Delete all cycle plans for this cycle
    const allCyclePlans = Object.values(cyclePlans$.get());
    const cyclePlansToDelete = allCyclePlans.filter(
      (cp) => cp.cycleId === cycleId
    );

    for (const plan of cyclePlansToDelete) {
      cyclePlans$[plan.id].delete();
    }

    // Delete all moments for this cycle
    const allMoments = Object.values(moments$.get());
    const momentsToDelete = allMoments.filter((m) => m.cycleId === cycleId);

    for (const moment of momentsToDelete) {
      moments$[moment.id].delete();
    }

    // Delete the cycle itself
    cycles$[cycleId].delete();

    return { success: true };
  }

  /**
   * Gets a single cycle by ID
   *
   * @param cycleId - ID of cycle to retrieve
   * @returns Cycle if found, null otherwise
   */
  getCycle(cycleId: string): Cycle | null {
    return cycles$[cycleId].get() || null;
  }

  /**
   * Gets all cycles
   *
   * @returns Array of all cycles
   */
  getAllCycles(): Cycle[] {
    return Object.values(cycles$.get());
  }

  /**
   * Gets the currently active cycle (via activeCycleId$)
   *
   * @returns Active cycle or null
   */
  getActiveCycle(): Cycle | null {
    return activeCycle$.get();
  }

  /**
   * Gets the cycle that contains today's date
   *
   * Business rule: Current cycle is the one whose date range contains today
   *
   * @returns Current cycle or null if no cycle contains today
   */
  getCurrentCycle(): Cycle | null {
    const today = new Date().toISOString().split("T")[0];
    const allCycles = Object.values(cycles$.get());

    return allCycles.find(cycle => isDateInCycle(cycle, today)) || null;
  }

  /**
   * Gets a single cycle plan by ID
   *
   * @param cyclePlanId - ID of cycle plan to retrieve
   * @returns Cycle plan if found, null otherwise
   */
  getCyclePlan(cyclePlanId: string): CyclePlan | null {
    return cyclePlans$[cyclePlanId].get() || null;
  }

  /**
   * Count moments allocated (day + phase set) for a cycle plan.
   * Unallocated rows are ignored — deck size is derived, not stored.
   */
  countAllocatedForPlan(cyclePlanId: string): number {
    const moments = Object.values(moments$.get());
    return moments.filter(
      (m) =>
        m.cyclePlanId === cyclePlanId &&
        m.day !== null &&
        m.phase !== null,
    ).length;
  }

  /**
   * Allocate a virtual deck card into a specific day/phase slot by
   * materializing a new Moment. Enforces plan existence, budget ceiling,
   * slot capacity (max 3 per phase), and cycle date range.
   */
  allocateFromPlan(props: {
    cycleId: string;
    habitId: string;
    day: string;
    phase: Phase;
  }): Moment | { error: string } {
    const { cycleId, habitId, day, phase } = props;

    const cycle = cycles$[cycleId].get();
    if (!cycle) return { error: `Cycle ${cycleId} not found` };

    const habit = habits$[habitId].get();
    if (!habit) return { error: `Habit ${habitId} not found` };
    if (habit.isArchived) {
      return { error: `Habit ${habitId} is archived` };
    }

    const plan = this.findCyclePlan(cycleId, habitId);
    if (!plan) {
      return { error: "No budget: habit not planned for cycle" };
    }

    const allocatedCount = this.countAllocatedForPlan(plan.id);
    if (allocatedCount >= plan.budgetedCount) {
      return {
        error: `Over budget: ${allocatedCount}/${plan.budgetedCount} already allocated`,
      };
    }

    if (cycle.endDate) {
      if (day < cycle.startDate || day > cycle.endDate) {
        return {
          error: `Day ${day} outside cycle range ${cycle.startDate}..${cycle.endDate}`,
        };
      }
    } else if (day < cycle.startDate) {
      return { error: `Day ${day} before cycle start ${cycle.startDate}` };
    }

    const slotMoments = Object.values(moments$.get()).filter(
      (m) => m.day === day && m.phase === phase,
    );
    if (slotMoments.length >= 3) {
      return { error: `Slot ${day} ${phase} full (3/3)` };
    }

    const created = createMoment({
      name: habit.name,
      areaId: habit.areaId,
      emoji: habit.emoji,
      habitId: habit.id,
      cycleId,
      cyclePlanId: plan.id,
      tags: habit.tags || [],
      phase,
    });
    if ("error" in created) return created;

    const allocated = allocateMoment(created, {
      day,
      phase,
      order: slotMoments.length,
    });

    moments$[allocated.id].set(allocated);
    return allocated;
  }

  /**
   * Unallocate a plan-linked moment by deleting its row.
   * In the derive paradigm, a moment only exists because it was allocated;
   * unallocation removes the row and the virtual ghost in the deck auto-
   * reappears as a consequence of `allocatedCount` dropping.
   *
   * Rejects spontaneous / standalone moments — those use `delete_moment`.
   */
  unallocateMoment(momentId: string): { ok: true } | { error: string } {
    const moment = moments$[momentId].get();
    if (!moment) return { error: `Moment ${momentId} not found` };
    if (moment.cyclePlanId === null) {
      return {
        error:
          "Cannot unallocate spontaneous moment; use delete_moment instead",
      };
    }
    moments$[momentId].delete();
    return { ok: true };
  }

  /**
   * One-shot migration: delete leftover unallocated plan-linked moments
   * from the old materialize-on-budget paradigm. Safe to call repeatedly —
   * on a clean vault, deletes zero.
   *
   * Safety: only deletes moments with cyclePlanId !== null
   *         AND day === null AND phase === null.
   */
  reconcileLegacyDeckMoments(): { deleted: number } {
    const all = Object.entries(moments$.get());
    let deleted = 0;
    for (const [id, m] of all) {
      if (m.cyclePlanId !== null && m.day === null && m.phase === null) {
        moments$[id].delete();
        deleted++;
      }
    }
    return { deleted };
  }

  /**
   * Gets all cycle plans
   *
   * @returns Array of all cycle plans
   */
  getAllCyclePlans(): CyclePlan[] {
    return Object.values(cyclePlans$.get());
  }

  /**
   * Gets all cycle plans for a specific cycle
   *
   * @param cycleId - ID of cycle to get plans for
   * @returns Array of cycle plans for the specified cycle
   */
  getCyclePlansForCycle(cycleId: string): CyclePlan[] {
    const allPlans = Object.values(cyclePlans$.get());
    return allPlans.filter((plan) => plan.cycleId === cycleId);
  }

  /**
   * Gets all current and future cycles (excludes past cycles)
   * Sorted chronologically from oldest to newest
   *
   * Domain rule: A cycle is "past" if its end date is before today.
   * Ongoing cycles (no end date) are always included.
   *
   * @returns Array of cycles sorted by start date (ascending)
   */
  getCurrentAndFutureCycles(): Cycle[] {
    const allCycles = Object.values(cycles$.get());
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return allCycles
      .filter((cycle) => {
        // Include cycles with no end date (ongoing)
        if (!cycle.endDate) return true;

        // Include cycles where end date is today or in the future
        const endDate = new Date(cycle.endDate);
        endDate.setHours(0, 0, 0, 0);
        return endDate >= today;
      })
      .sort((a, b) => {
        // Sort chronologically: oldest first
        return (
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
        );
      });
  }

  /**
   * Gets budgeted moments for a specific cycle (unallocated deck moments)
   *
   * @param cycleId - ID of cycle
   * @returns Array of budgeted moments for this cycle, sorted by creation time
   */
  getCycleDeckMoments(cycleId: string): Moment[] {
    const allMoments = Object.values(moments$.get());

    return allMoments
      .filter(
        (m) =>
          m.cycleId === cycleId &&
          m.cyclePlanId !== null &&
          m.day === null &&
          m.phase === null
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }

  /**
   * Budgets a habit to a cycle (or updates existing budget count)
   *
   * @param cycleId - ID of cycle to budget to
   * @param habitId - ID of habit to budget
   * @param count - Number of moments to budget
   * @returns Created or updated cycle plan or error
   */
  budgetHabitToCycle(
    cycleId: string,
    habitId: string,
    count: number
  ): CyclePlanResult {
    // Validate cycle exists
    const cycle = cycles$[cycleId].get();
    if (!cycle) {
      return { error: `Cycle with ID ${cycleId} not found` };
    }

    // Find existing cycle plan or create new
    const existingPlan = this.findCyclePlan(cycleId, habitId);

    let plan: CyclePlan;

    if (existingPlan) {
      // Update existing plan
      const result = updateCyclePlanBudget(existingPlan, {
        budgetedCount: count,
      });
      if ("error" in result) {
        return result;
      }
      plan = result;
      cyclePlans$[plan.id].set(plan);
    } else {
      // Create new plan
      const result = createCyclePlan({
        cycleId,
        habitId,
        budgetedCount: count,
      });
      if ("error" in result) {
        return result;
      }
      plan = result;
      cyclePlans$[plan.id].set(plan);
    }

    return plan;
  }

  /**
   * Budget a habit into a cycle with optional rhythm override.
   *
   * Precedence for budget count:
   *   1. `options.count` (explicit override) — always wins
   *   2. `options.rhythmOverride` with derived count (cycle-specific rhythm)
   *   3. `habit.rhythm` with derived count
   *   4. Otherwise: error (no count information)
   *
   * `rhythmOverride` is stored on the CyclePlan regardless of whether count is
   * also explicit, because rhythmOverride independently drives health and
   * whispers for that cycle.
   */
  budgetHabitToCycleWithOptions(
    cycleId: string,
    habitId: string,
    options: { count?: number; rhythmOverride?: Rhythm }
  ): CyclePlanResult {
    const cycle = cycles$[cycleId].get();
    if (!cycle) {
      return { error: `Cycle with ID ${cycleId} not found` };
    }

    const habit = habits$[habitId].get();
    if (!habit) {
      return { error: `Habit with ID ${habitId} not found` };
    }

    const effectiveRhythm: Rhythm | null =
      options.rhythmOverride ?? habit.rhythm ?? null;

    let count = options.count;
    if (count === undefined) {
      if (effectiveRhythm === null) {
        return {
          error:
            "Cannot derive budget: no explicit count and no rhythm on habit or override",
        };
      }
      const cycleDays = this.computeCycleDays(cycle);
      count = rhythmToCycleBudget(effectiveRhythm, cycleDays);
    }

    const result = this.budgetHabitToCycle(cycleId, habitId, count);
    if ("error" in result) {
      return result;
    }

    if (options.rhythmOverride !== undefined) {
      const updated: CyclePlan = {
        ...result,
        rhythmOverride: options.rhythmOverride,
        updatedAt: new Date().toISOString(),
      };
      cyclePlans$[updated.id].set(updated);
      return updated;
    }

    return result;
  }

  /**
   * Compute cycle planning proposals — which habits the system suggests
   * budgeting into this cycle, based on attitude + rhythm + current health.
   *
   * Read-only; does NOT commit anything. Caller (UI or MCP agent) decides
   * which proposals to accept.
   */
  getCyclePlanningProposals(cycleId: string): CyclePlanningProposal[] {
    const cycle = cycles$[cycleId].get();
    if (!cycle) return [];

    const allHabits = Object.values(habits$.get()).filter((h) => !h.isArchived);
    const allMoments = Object.values(moments$.get());
    const allPlans = Object.values(cyclePlans$.get());
    const cycleDays = this.computeCycleDays(cycle);
    const now = new Date();

    const proposals: CyclePlanningProposal[] = [];

    for (const habit of allHabits) {
      if (habit.attitude === null) continue;
      if (habit.attitude === Attitude.BEING) continue;

      const plan =
        allPlans.find(
          (p) => p.cycleId === cycleId && p.habitId === habit.id
        ) ?? null;

      const effectiveRhythm = habitHealthService.resolveRhythm(habit, plan);
      const currentHealth = habitHealthService.computeHealth(
        habit,
        plan,
        allMoments,
        now
      );

      const daysSinceLast = this.computeDaysSinceLastAllocation(
        habit.id,
        allMoments,
        now
      );

      if (habit.attitude === Attitude.BEGINNING) {
        const count = allMoments.filter((m) => m.habitId === habit.id).length;
        if (count >= 5) continue;
        proposals.push({
          habitId: habit.id,
          habitName: habit.name,
          areaId: habit.areaId,
          attitude: habit.attitude,
          suggestedRhythm: effectiveRhythm,
          suggestedCount: 0,
          reason: "beginning",
          currentHealth,
          daysSinceLast,
        });
        continue;
      }

      if (effectiveRhythm === null) continue;

      const suggestedCount = rhythmToCycleBudget(effectiveRhythm, cycleDays);
      const reason: CyclePlanningProposalReason =
        currentHealth === "wilting" ? "wilting" : "on-rhythm";

      proposals.push({
        habitId: habit.id,
        habitName: habit.name,
        areaId: habit.areaId,
        attitude: habit.attitude,
        suggestedRhythm: effectiveRhythm,
        suggestedCount,
        reason,
        currentHealth,
        daysSinceLast,
      });
    }

    return proposals;
  }

  /**
   * Review of a cycle — descriptive, no scores, no aggregate grades.
   * Observational mirror for reflection. Plan and review are separate acts.
   */
  getCycleReview(cycleId: string): CycleReview | null {
    const cycle = cycles$[cycleId].get();
    if (!cycle) return null;

    const allMoments = Object.values(moments$.get());
    const allPlans = Object.values(cyclePlans$.get());
    const cyclePlansForCycle = allPlans.filter((p) => p.cycleId === cycleId);
    const cycleMoments = allMoments.filter((m) => m.cycleId === cycleId);
    const unplannedMoments = cycleMoments.filter(
      (m) => m.cyclePlanId === null
    );
    const startDate = fromISODate(cycle.startDate);
    const endDate = cycle.endDate ? fromISODate(cycle.endDate) : new Date();

    const habits: CycleReviewHabit[] = [];
    for (const plan of cyclePlansForCycle) {
      const habit = habits$[plan.habitId].get();
      if (!habit) continue;

      const momentsForHabit = cycleMoments.filter(
        (m) => m.habitId === habit.id
      );
      const allocatedMoments = momentsForHabit.filter((m) => m.day !== null);
      const dates = allocatedMoments
        .map((m) => (m.day ? fromISODate(m.day) : null))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime());

      const first = dates[0] ?? null;
      const last = dates[dates.length - 1] ?? null;

      let longestGap: number | null = null;
      for (let i = 1; i < dates.length; i++) {
        const gap = differenceInCalendarDays(dates[i], dates[i - 1]);
        if (longestGap === null || gap > longestGap) longestGap = gap;
      }

      const priorMoments = allMoments.filter(
        (m) => m.day !== null && fromISODate(m.day) < startDate
      );
      const startHealth = habitHealthService.computeHealth(
        habit,
        plan,
        priorMoments,
        startDate
      );
      const endHealth = habitHealthService.computeHealth(
        habit,
        plan,
        allMoments,
        endDate
      );

      habits.push({
        habitId: habit.id,
        habitName: habit.name,
        areaId: habit.areaId,
        attitude: habit.attitude,
        rhythmSnapshot: habitHealthService.resolveRhythm(habit, plan),
        budgetedCount: plan.budgetedCount,
        actualCount: allocatedMoments.length,
        startHealth,
        endHealth,
        firstAllocation: first ? toISODate(first) : null,
        lastAllocation: last ? toISODate(last) : null,
        longestGapDays: longestGap,
      });
    }

    return {
      cycleId: cycle.id,
      cycleName: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      habits,
      unplannedMoments,
      totalMoments: cycleMoments.length,
    };
  }

  private computeDaysSinceLastAllocation(
    habitId: string,
    moments: Moment[],
    now: Date
  ): number | null {
    const habitMoments = moments.filter((m) => m.habitId === habitId);
    const latest = habitHealthService.latestAllocationDate(habitMoments, now);
    if (latest === null) return null;
    const ms = now.getTime() - latest.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  private computeCycleDays(cycle: Cycle): number {
    const start = fromISODate(cycle.startDate);
    const end = cycle.endDate ? fromISODate(cycle.endDate) : new Date();
    return Math.max(1, differenceInCalendarDays(end, start) + 1);
  }

  /**
   * Increments the budget for a habit in a cycle by 1.
   * Creates a new cycle plan if none exists.
   *
   * Encapsulates the domain knowledge of "current total" so callers
   * don't need to query allocated vs. deck moments themselves.
   */
  incrementHabitBudget(cycleId: string, habitId: string): CyclePlanResult {
    // Increment the plan's current budget. Deck ghosts are virtual
    // (budgetedCount minus allocated), so `countMomentsForHabitInCycle`
    // undercounts by the number of ghosts and would leave the budget stuck.
    const plan = this.findCyclePlan(cycleId, habitId);
    const currentBudget = plan?.budgetedCount ?? 0;
    return this.budgetHabitToCycle(cycleId, habitId, currentBudget + 1);
  }

  /**
   * Decrements the budget by 1, floored at the number of already-allocated
   * moments. No-op (returns the current plan unchanged) when the floor is
   * already reached — allocated work is sunk cost and survives.
   */
  decrementHabitBudget(cycleId: string, habitId: string): CyclePlanResult {
    const plan = this.findCyclePlan(cycleId, habitId);
    if (!plan) {
      return { error: `No plan for cycle ${cycleId}, habit ${habitId}` };
    }
    const allocated = this.countAllocatedForPlan(plan.id);
    if (plan.budgetedCount - 1 < allocated) {
      return plan; // floor reached; no-op
    }
    return this.budgetHabitToCycle(cycleId, habitId, plan.budgetedCount - 1);
  }

  /**
   * Removes all unallocated (deck) moments for a habit in a cycle.
   * Allocated moments on the timeline survive.
   */
  removeHabitFromDeck(cycleId: string, habitId: string): CyclePlanResult {
    const allocatedCount = this.countAllocatedMomentsForHabitInCycle(cycleId, habitId);
    return this.budgetHabitToCycle(cycleId, habitId, allocatedCount);
  }

  /**
   * Counts all moments (allocated + deck) for a habit in a cycle.
   */
  private countMomentsForHabitInCycle(cycleId: string, habitId: string): number {
    return Object.values(moments$.get()).filter(
      (m) => m.cycleId === cycleId && m.habitId === habitId
    ).length;
  }

  /**
   * Counts only allocated (on timeline) moments for a habit in a cycle.
   */
  private countAllocatedMomentsForHabitInCycle(cycleId: string, habitId: string): number {
    return Object.values(moments$.get()).filter(
      (m) =>
        m.cycleId === cycleId &&
        m.habitId === habitId &&
        m.day !== null &&
        m.phase !== null
    ).length;
  }

  /**
   * Counts only deck (unallocated) moments for a habit in a cycle.
   */
  private countDeckMomentsForHabitInCycle(cycleId: string, habitId: string): number {
    return Object.values(moments$.get()).filter(
      (m) =>
        m.cycleId === cycleId &&
        m.habitId === habitId &&
        m.cyclePlanId !== null &&
        m.day === null &&
        m.phase === null
    ).length;
  }

  /**
   * Finds a cycle plan by cycle and habit IDs
   *
   * @param cycleId - Cycle ID
   * @param habitId - Habit ID
   * @returns Cycle plan or undefined
   */
  private findCyclePlan(
    cycleId: string,
    habitId: string
  ): CyclePlan | undefined {
    const allPlans = Object.values(cyclePlans$.get());
    return allPlans.find(
      (plan) => plan.cycleId === cycleId && plan.habitId === habitId
    );
  }

  /**
   * Activates a cycle (starts it)
   * Deactivates the current active cycle and materializes all cycle plans
   *
   * @param cycleId - ID of cycle to activate
   * @returns Activated cycle or error
   */
  activateCycle(cycleId: string): CycleResult {
    const cycle = cycles$[cycleId].get();
    if (!cycle) {
      return { error: `Cycle with ID ${cycleId} not found` };
    }

    // Set the active cycle ID (replaces any previously active cycle)
    activeCycleId$.set(cycleId);

    return cycle;
  }

  /**
   * Allocates a budgeted moment from the deck to a timeline slot
   *
   * @param momentId - ID of moment to allocate
   * @param day - ISO date string
   * @param phase - Phase to allocate to
   * @param order - Order within phase (0-2)
   * @returns Updated moment or error
   */
  allocateMomentFromDeck(
    momentId: string,
    day: string,
    phase: string,
    order: number
  ): MomentResult {
    const moment = moments$[momentId].get();
    if (!moment) {
      return { error: `Moment with ID ${momentId} not found` };
    }

    // Validate moment is in deck (unallocated but budgeted)
    if (moment.cyclePlanId === null) {
      return { error: "Moment is not budgeted (not from a cycle plan)" };
    }

    if (moment.day !== null || moment.phase !== null) {
      return { error: "Moment is already allocated" };
    }

    // Use domain function to allocate
    const allocated = allocateMoment(moment, {
      day,
      phase: phase as any,
      order,
    });

    // Update store
    moments$[momentId].set(allocated);

    return allocated;
  }

  /**
   * Spawns a spontaneous moment from a habit (ad-hoc, not from budget)
   *
   * @param habitId - ID of habit to spawn from
   * @param day - ISO date string
   * @param phase - Phase to allocate to
   * @param order - Order within phase (0-2)
   * @returns Created moment or error
   */
  spawnSpontaneousFromHabit(
    habitId: string,
    day: string,
    phase: string,
    order: number
  ): MomentResult {
    const habit = habits$[habitId].get();
    if (!habit) {
      return { error: `Habit with ID ${habitId} not found` };
    }

    const activeCycle = activeCycle$.get();

    // Create spontaneous moment (cyclePlanId = null)
    const result = createMoment({
      name: habit.name,
      areaId: habit.areaId,
      emoji: habit.emoji,
      habitId: habit.id,
      cycleId: activeCycle?.id || null,
      cyclePlanId: null, // Spontaneous
      phase: null,
      tags: habit.tags || [],
    });

    if ("error" in result) {
      return result;
    }

    // Allocate immediately (spawns directly to timeline)
    const allocated = allocateMoment(result, {
      day,
      phase: phase as any,
      order,
    });

    // Add to store
    moments$[allocated.id].set(allocated);

    return allocated;
  }

  /**
   * Creates a standalone moment (not from habit, ad-hoc)
   *
   * @param name - Moment name
   * @param areaId - Area ID
   * @param day - Optional ISO date string (null = unallocated)
   * @param phase - Optional phase (null = unallocated)
   * @param order - Order within phase (0-2)
   * @returns Created moment or error
   */
  createStandaloneMoment(
    name: string,
    areaId: string,
    day: string | null,
    phase: string | null,
    order: number
  ): MomentResult {
    const activeCycle = activeCycle$.get();

    // Create standalone moment (habitId = null, cyclePlanId = null)
    const result = createMoment({
      name,
      areaId,
      habitId: null, // Standalone
      cycleId: activeCycle?.id || null,
      cyclePlanId: null, // Spontaneous
      phase: null,
      tags: [],
    });

    if ("error" in result) {
      return result;
    }

    let finalMoment = result;

    // Allocate if day/phase provided
    if (day && phase) {
      finalMoment = allocateMoment(result, { day, phase: phase as any, order });
    }

    // Add to store
    moments$[finalMoment.id].set(finalMoment);

    return finalMoment;
  }

  /**
   * Gets areas with their grouped deck moments for the active cycle
   *
   * Returns areas that have budgeted moments in the cycle deck,
   * grouped by area and then by habit. Only includes areas with
   * at least one deck moment.
   *
   * @param deckMomentsByAreaAndHabit - Grouped moments from store selector
   * @returns Array of areas with their habit-grouped moments, sorted by area order
   */
  getAreasWithDeckMoments(
    deckMomentsByAreaAndHabit: Record<string, Record<string, Moment[]>>
  ): Array<{ area: Area; habits: Record<string, Moment[]> }> {
    const allAreas = areas$.get();
    const areasMap: Record<string, Area> = allAreas;

    return Object.keys(deckMomentsByAreaAndHabit)
      .map((areaId) => ({
        area: areasMap[areaId],
        habits: deckMomentsByAreaAndHabit[areaId],
      }))
      .filter(({ area }) => Boolean(area))
      .sort((a, b) => a.area.order - b.area.order);
  }
}
