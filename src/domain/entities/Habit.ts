import { normalizeTag } from "@/domain/services/TagService";
import type { Attitude } from "../value-objects/Attitude";
import type { Phase, PhaseConfig } from "../value-objects/Phase";
import type { Rhythm } from "../value-objects/Rhythm";
import {
  createSchedule,
  deriveRhythmFromSchedule,
  isScheduleError,
  phaseForStartTime,
  type Schedule,
  schedulePhaseError,
  scheduleRhythmError,
} from "../value-objects/Schedule";

/**
 * Habit - Recurring moment template
 *
 * Habits represent patterns that emerge from repeated moments.
 * Users create habits from patterns or proactively in Planning phase.
 * Habits provide structure while preserving organic moment creation.
 */
export interface Habit {
  readonly id: string;
  name: string; // 1-3 words
  areaId: string; // FK to Area (required parent)
  attitude: Attitude | null; // Override Area's attitude if set. BEING = crystallized (off-timeline).
  phase: Phase | null; // Default phase preference for this habit
  tags: string[]; // Attributes for filtering (e.g., "cardio", "outdoor")
  aliases?: string[]; // Alternate names (nicknames, full names) — participate in search
  emoji: string | null; // Optional override of Area emoji
  isArchived: boolean; // Soft delete
  order: number; // Display order within attitude section
  description?: string; // Free-form prose describing the habit (capped at HABIT_DESCRIPTION_MAX_CHARS)
  guidance?: string; // Practitioner-facing guidance for the habit
  rhythm?: Rhythm; // Optional declared cadence (count per period)
  schedule?: Schedule; // Optional clock-time commitment (weekdays + HH:MM + minutes)
  /**
   * Where this practice can actually be done, as registry entity keys.
   *
   * `dead hang` needs a pull-up bar and the bar is in one city. A practice
   * bound to no place is offered everywhere, which is most of the roster;
   * binding is the exception and says so by being present.
   *
   * Supersedes the `place-<key>` tag, which was the same reference written
   * smaller because there was no field to hold it. `placesOf` still falls
   * back to those tags until the migration moves them here.
   */
  placeIds?: string[];
  link?: string;
  parentHabitId?: string;
  durationMin?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Normalizes an aliases list: trims each entry, filters empty strings,
 * drops any alias case-insensitively equal to the habit name, and
 * de-duplicates case-insensitively while preserving the original casing
 * of the first occurrence.
 */
export function normalizeAliases(
  aliases: string[] | undefined,
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

/**
 * Result type for operations that may fail
 */
export type HabitResult = Habit | { error: string };

/**
 * Props for creating a habit
 */
export interface CreateHabitProps {
  name: string;
  areaId: string;
  order: number;
  attitude?: Attitude | null;
  phase?: Phase | null;
  tags?: string[];
  aliases?: string[];
  emoji?: string | null;
  description?: string;
  guidance?: string;
  parentHabitId?: string;
  durationMin?: number;
  rhythm?: Rhythm;
  schedule?: Schedule;
  link?: string;
  /**
   * Phase bands, needed only when a schedule is declared: they let the factory
   * derive `phase` from `schedule.startTime` (or reject a phase that
   * contradicts it). Omit to leave `phase` exactly as given.
   */
  phaseConfigs?: readonly PhaseConfig[];
}

/**
 * Reconciles the three fields a schedule touches.
 *
 * `rhythm` and `phase` stay *stored* rather than derived — every existing
 * consumer (health, cycle budgets, the (day, phase) allocation grid) reads them
 * directly, and phase bands are user-mutable, so deriving at read time would
 * make allocations shift under the user's feet. Instead the schedule *fills*
 * them when absent and *rejects* them when they contradict it.
 */
function reconcileSchedule(
  schedule: Schedule,
  rhythm: Rhythm | undefined,
  phase: Phase | null | undefined,
  phaseConfigs: readonly PhaseConfig[] | undefined,
): { rhythm: Rhythm; phase: Phase | null } | { error: string } {
  const rhythmError = scheduleRhythmError(schedule, rhythm);
  if (rhythmError) {
    return { error: rhythmError };
  }

  if (!phaseConfigs) {
    return {
      rhythm: rhythm ?? deriveRhythmFromSchedule(schedule),
      phase: phase ?? null,
    };
  }

  const phaseError = schedulePhaseError(schedule, phase, phaseConfigs);
  if (phaseError) {
    return { error: phaseError };
  }

  return {
    rhythm: rhythm ?? deriveRhythmFromSchedule(schedule),
    phase: phase ?? phaseForStartTime(schedule.startTime, phaseConfigs),
  };
}

/**
 * Maximum character length for Habit.description.
 * The 3-word `name` constraint is the core invariant; description is prose
 * context. Cap prevents description from eroding name's role.
 */
export const HABIT_DESCRIPTION_MAX_CHARS = 2000;

/**
 * Props for updating a habit
 */
export type UpdateHabitProps = Partial<
  Omit<Habit, "id" | "isArchived" | "createdAt" | "updatedAt">
>;

/**
 * Validates habit name (1-3 words)
 */
function validateHabitName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "Habit name cannot be empty" };
  }

  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);

  if (words.length < 1) {
    return { valid: false, error: "Habit name must contain at least 1 word" };
  }

  if (words.length > 3) {
    return {
      valid: false,
      error: "Habit name cannot exceed 3 words",
    };
  }

  return { valid: true };
}

/**
 * Creates a new habit
 */
export function createHabit(props: CreateHabitProps): HabitResult {
  const {
    name,
    areaId,
    order,
    attitude = null,
    phase = null,
    tags = [],
    aliases,
    emoji = null,
    description,
    guidance,
    rhythm,
    schedule,
    phaseConfigs,
  } = props;

  const validation = validateHabitName(name);
  if (!validation.valid) {
    return { error: validation.error! };
  }

  if (!areaId || !areaId.trim()) {
    return { error: "Habit must have an areaId" };
  }

  if (order < 0) {
    return { error: "Order must be non-negative" };
  }

  const now = new Date().toISOString();

  const normalizedTags = (tags?.map(normalizeTag).filter(Boolean) ??
    []) as string[];

  const normalizedAliases = normalizeAliases(aliases, name);

  const trimmedDescription = description?.trim();
  if (
    trimmedDescription &&
    trimmedDescription.length > HABIT_DESCRIPTION_MAX_CHARS
  ) {
    return {
      error: `Habit description cannot exceed ${HABIT_DESCRIPTION_MAX_CHARS} characters`,
    };
  }
  const trimmedGuidance = guidance?.trim();

  let normalizedSchedule: Schedule | undefined;
  let effectiveRhythm = rhythm;
  let effectivePhase = phase;
  if (schedule) {
    const built = createSchedule(schedule);
    if (isScheduleError(built)) {
      return { error: built.error };
    }
    const reconciled = reconcileSchedule(built, rhythm, phase, phaseConfigs);
    if ("error" in reconciled) {
      return { error: reconciled.error };
    }
    normalizedSchedule = built;
    effectiveRhythm = reconciled.rhythm;
    effectivePhase = reconciled.phase;
  }

  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    areaId: areaId.trim(),
    attitude,
    phase: effectivePhase,
    tags: normalizedTags,
    emoji: emoji ? emoji.trim() : null,
    isArchived: false,
    order,
    ...(normalizedAliases.length > 0 ? { aliases: normalizedAliases } : {}),
    ...(props.parentHabitId ? { parentHabitId: props.parentHabitId } : {}),
    ...(props.durationMin && props.durationMin > 0
      ? { durationMin: props.durationMin }
      : {}),
    ...(trimmedDescription ? { description: trimmedDescription } : {}),
    ...(trimmedGuidance ? { guidance: trimmedGuidance } : {}),
    ...(effectiveRhythm ? { rhythm: effectiveRhythm } : {}),
    ...(normalizedSchedule ? { schedule: normalizedSchedule } : {}),
    ...(props.link?.trim() ? { link: props.link.trim() } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Updates habit properties (excluding immutable fields and those with dedicated methods)
 */
export function updateHabit(
  habit: Habit,
  updates: Partial<
    Omit<Habit, "id" | "isArchived" | "createdAt" | "updatedAt">
  >,
  phaseConfigs?: readonly PhaseConfig[],
): HabitResult {
  if (updates.name !== undefined) {
    const validation = validateHabitName(updates.name);
    if (!validation.valid) {
      return { error: validation.error! };
    }
  }

  if (updates.order !== undefined && updates.order < 0) {
    return { error: "Order must be non-negative" };
  }

  if (
    updates.description !== undefined &&
    updates.description.trim().length > HABIT_DESCRIPTION_MAX_CHARS
  ) {
    return {
      error: `Habit description cannot exceed ${HABIT_DESCRIPTION_MAX_CHARS} characters`,
    };
  }

  const emoji = updates.emoji?.trim() ?? habit.emoji;

  const normalizedTags = (updates.tags?.map(normalizeTag).filter(Boolean) ??
    habit.tags ??
    []) as string[];

  const nextName = updates.name ? updates.name.trim() : habit.name;

  const merged: Habit = {
    ...habit,
    ...updates,
    name: nextName,
    tags: normalizedTags,
    emoji,
    updatedAt: new Date().toISOString(),
  };
  if ("rhythm" in updates && updates.rhythm === undefined) {
    delete merged.rhythm;
  }
  if ("aliases" in updates) {
    const normalizedAliases = normalizeAliases(updates.aliases, nextName);
    if (normalizedAliases.length === 0) {
      delete merged.aliases;
    } else {
      merged.aliases = normalizedAliases;
    }
  } else if (habit.aliases && updates.name) {
    // Name changed but aliases untouched — re-normalize so alias matching
    // the new name gets dropped.
    const renormalized = normalizeAliases(habit.aliases, nextName);
    if (renormalized.length === 0) {
      delete merged.aliases;
    } else {
      merged.aliases = renormalized;
    }
  }
  if ("durationMin" in updates) {
    if (updates.durationMin && updates.durationMin > 0) {
      merged.durationMin = updates.durationMin;
    } else {
      delete merged.durationMin;
    }
  }
  if ("schedule" in updates && updates.schedule === undefined) {
    delete merged.schedule;
  }
  if ("link" in updates) {
    const trimmed = updates.link?.trim();
    if (trimmed) {
      merged.link = trimmed;
    } else {
      delete merged.link;
    }
  }

  if (merged.schedule) {
    const built = createSchedule(merged.schedule);
    if (isScheduleError(built)) {
      return { error: built.error };
    }
    const reconciled = reconcileSchedule(
      built,
      merged.rhythm,
      merged.phase,
      phaseConfigs,
    );
    if ("error" in reconciled) {
      return { error: reconciled.error };
    }
    merged.schedule = built;
    merged.rhythm = reconciled.rhythm;
    merged.phase = reconciled.phase;
  }
  return merged;
}

/**
 * Archives a habit (soft delete)
 */
export function archiveHabit(habit: Habit): Habit {
  return {
    ...habit,
    isArchived: true,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Unarchives a habit
 */
export function unarchiveHabit(habit: Habit): Habit {
  return {
    ...habit,
    isArchived: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Type guard to check if result is an error
 */
export function isHabitError(result: HabitResult): result is { error: string } {
  return "error" in result;
}
