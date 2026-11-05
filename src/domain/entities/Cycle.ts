import {
  type Allocation,
  allocationErrors,
  DEFAULT_CAPACITY_DAYS,
} from "./Allocation";

/**
 * Cycle - Time container for moments
 *
 * Cycles represent named periods (e.g., "Barcelona Summer", "Q1 2025")
 * Only one cycle can be active at a time (enforced at application level)
 */
export interface Cycle {
  readonly id: string;
  name: string;
  startDate: string; // ISO date: "2025-01-15"
  endDate: string | null; // null for ongoing cycles
  intention: string | null; // Why this chapter — set at creation, editable later
  reflection: string | null; // Populated in harvest when the cycle closes
  reflectionSource?: ReflectionSource | null; // Who wrote it. Absent = unknown
  /**
   * Where this season is lived, as registry entity keys.
   *
   * A cycle is a stretch of time *somewhere*. Half a year in one city, half
   * in another, is two seasons, and the season is the smallest container
   * that already knows which. Reading place off the cycle is what lets the
   * roster stop offering a practice whose object is in another country, and
   * what lets the outreach queue say who is far.
   *
   * A list, not one key, for the same reason a moment carries a list: a
   * season spent between two cities names both. Absent means unstated, and
   * nothing is filtered out by a constraint that cannot be checked.
   */
  placeIds?: string[];
  /**
   * What each area means this season, in the gardener's words (1 to 12 each).
   * Declared at /season, expires with the cycle. Absent = none declared.
   */
  areaIntentions?: Record<string, string>;
  /**
   * People on this season's roster, keyed by person key
   * (the key moments carry in `personIds`). Text is 1 to 12 words,
   * or "" for "on the roster, nothing to say yet".
   */
  people?: Record<string, string>;
  /** Days this cycle can spend. Absent = DEFAULT_CAPACITY_DAYS (12). */
  capacityDays?: number;
  /** The betting table: bets and lanes drawing on `capacityDays`. */
  allocations?: Allocation[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Who wrote the reflection.
 *
 * Absent means *unknown*, not machine — but harvest reads unknown as a draft.
 * The failure that matters is a machine draft passing as your own words; the
 * reverse costs nothing. See `isHumanWritten`.
 */
export type ReflectionSource = "human" | "machine";

/**
 * Props for creating a new cycle
 */
export interface CreateCycleProps {
  name: string;
  startDate: string;
  endDate?: string | null;
  intention?: string | null;
}

/**
 * Props for updating an existing cycle
 */
export interface UpdateCycleProps {
  name?: string;
  startDate?: string;
  endDate?: string | null;
  intention?: string | null;
  reflection?: string | null;
  reflectionSource?: ReflectionSource | null;
}

/**
 * Result type for operations that may fail
 */
export type CycleResult = Cycle | { error: string };

/**
 * Creates a new cycle
 *
 * @param props - Cycle creation properties
 * @returns New cycle or error
 */
export function createCycle(props: CreateCycleProps): CycleResult {
  const trimmedName = props.name.trim();

  if (!trimmedName) {
    return { error: "Cycle name cannot be empty" };
  }

  if (!props.startDate) {
    return { error: "Cycle must have a start date" };
  }

  // Validate ISO date format
  const startDateObj = new Date(props.startDate);
  if (Number.isNaN(startDateObj.getTime())) {
    return { error: "Start date must be a valid ISO date string" };
  }

  const endDate = props.endDate ?? null;

  if (endDate !== null) {
    const endDateObj = new Date(endDate);
    if (Number.isNaN(endDateObj.getTime())) {
      return { error: "End date must be a valid ISO date string" };
    }

    // Ensure end date is after start date
    if (endDateObj <= startDateObj) {
      return { error: "End date must be after start date" };
    }
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: trimmedName,
    startDate: props.startDate,
    endDate,
    intention: props.intention ?? null,
    reflection: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Updates a cycle's properties
 *
 * @param cycle - Cycle to update
 * @param props - Update properties
 * @returns Updated cycle or error
 */
export function updateCycle(
  cycle: Cycle,
  props: UpdateCycleProps,
): CycleResult {
  if (props.name !== undefined) {
    const trimmedName = props.name.trim();
    if (!trimmedName) {
      return { error: "Cycle name cannot be empty" };
    }
  }

  const newStartDate = props.startDate ?? cycle.startDate;
  const newEndDate =
    props.endDate !== undefined ? props.endDate : cycle.endDate;

  // Validate start date
  const startDateObj = new Date(newStartDate);
  if (Number.isNaN(startDateObj.getTime())) {
    return { error: "Start date must be a valid ISO date string" };
  }

  // Validate end date if provided
  if (newEndDate !== null) {
    const endDateObj = new Date(newEndDate);
    if (Number.isNaN(endDateObj.getTime())) {
      return { error: "End date must be a valid ISO date string" };
    }

    if (endDateObj <= startDateObj) {
      return { error: "End date must be after start date" };
    }
  }

  return {
    ...cycle,
    ...props,
    name: props.name ? props.name.trim() : cycle.name,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Completes a cycle by setting its end date to today
 *
 * @param cycle - Cycle to complete
 * @returns Updated cycle
 */
export function completeCycle(cycle: Cycle): Cycle {
  const today = new Date().toISOString().split("T")[0];

  return {
    ...cycle,
    endDate: today,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Checks if a date falls within a cycle's time range
 *
 * @param cycle - Cycle to check
 * @param date - ISO date string to check
 * @returns True if date is within cycle range
 */
export function isDateInCycle(cycle: Cycle, date: string): boolean {
  const dateObj = new Date(date);
  const startObj = new Date(cycle.startDate);

  if (dateObj < startObj) {
    return false;
  }

  if (cycle.endDate === null) {
    return true; // Ongoing cycle
  }

  const endObj = new Date(cycle.endDate);
  return dateObj <= endObj;
}

/**
 * Type guard to check if result is an error
 */
export function isCycleError(result: CycleResult): result is { error: string } {
  return "error" in result;
}

// ============================================================================
// Reflection provenance
// ============================================================================

/**
 * Did the person whose season this is write the reflection themselves?
 *
 * Only an explicit `"human"` stamp counts. Unknown provenance — every
 * reflection written before this field existed — reads as NOT human, so a
 * draft is never presented as your own words. The asymmetry is deliberate:
 * mislabelling your words as drafted is a small insult, mislabelling a
 * draft as yours is a lie about the record.
 *
 * @param cycle - The season to check
 */
export function isHumanWritten(cycle: Cycle): boolean {
  return cycle.reflectionSource === "human";
}

/**
 * May a machine draft be written over what is already here?
 *
 * Never over a person's own words. A re-run may replace an earlier draft or
 * fill an empty season, and stops at anything you wrote yourself.
 *
 * @param cycle - The season a draft would be written into
 */
export function acceptsMachineDraft(cycle: Cycle): boolean {
  return !isHumanWritten(cycle);
}

/**
 * Writes a reflection and records who wrote it.
 *
 * Clearing the reflection clears the stamp with it: no reflection, no author.
 *
 * @param cycle - The season being written into
 * @param reflection - The prose, or null to clear it
 * @param source - Who is writing
 */
export function writeReflection(
  cycle: Cycle,
  reflection: string | null,
  source: ReflectionSource,
): Cycle {
  return {
    ...cycle,
    reflection,
    reflectionSource: reflection === null ? null : source,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Cycle Helpers
// ============================================================================

/**
 * Calculates the total bandwidth (available moment slots) for a cycle
 * Bandwidth = days × 3 phases × moments per day
 *
 * @param cycle - The cycle to calculate bandwidth for
 * @param momentsPerDay - User preference for moments per day (1-3)
 * @returns Total number of moment slots available
 */
export function calculateCycleBandwidth(
  cycle: Cycle,
  momentsPerDay: 1 | 2 | 3,
): number {
  const startDate = new Date(cycle.startDate);
  const endDate = cycle.endDate ? new Date(cycle.endDate) : new Date();
  const days =
    Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;
  return days * 3 * momentsPerDay; // 3 phases per day
}

// ============================================================================
// Betting table
// ============================================================================

/**
 * Sets a cycle's capacity and allocations, refusing a table that breaks an
 * invariant (see `allocationErrors`). Replaces the whole table.
 */
export function setAllocations<
  C extends Pick<Cycle, "capacityDays" | "allocations" | "updatedAt">,
>(
  cycle: C,
  allocations: readonly Allocation[],
  capacityDays: number = cycle.capacityDays ?? DEFAULT_CAPACITY_DAYS,
): C | { error: string } {
  const errors = allocationErrors(allocations, capacityDays);
  if (errors.length > 0) return { error: errors.join("; ") };
  return {
    ...cycle,
    capacityDays,
    allocations: [...allocations],
    updatedAt: new Date().toISOString(),
  };
}
