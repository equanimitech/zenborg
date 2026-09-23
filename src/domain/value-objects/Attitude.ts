/**
 * Attitude - Optional relationship mode for moments that need progression support
 *
 * Philosophy: Most moments exist in pure presence (allocation = realization).
 * Some moments benefit from tracking appropriate to how you're currently
 * relating to that practice. Attitudes make this relationship explicit and
 * provide minimal, appropriate feedback.
 *
 * Core Principle: You choose your attitude. The system reflects it.
 * No prescription, no judgment, no optimization pressure.
 */

/**
 * The six attitudes representing different relationships to a practice
 */
export enum Attitude {
  /** First encounters, exploration - shows count of times allocated */
  BEGINNING = "BEGINNING",
  /** Re-engagement after a lapse - prior identity acknowledged, friction expected */
  RETURNING = "RETURNING",
  /** Sporadic engagement, maintaining connection - shows days since last */
  KEEPING = "KEEPING",
  /** Regular practice, developing capacity - shows frequency patterns */
  BUILDING = "BUILDING",
  /** Focused progression, specific goals - shows custom metrics */
  PUSHING = "PUSHING",
  /** Deliberately tapering — the inverse of BUILDING */
  PRUNING = "PRUNING",
  /** Integrated, automatic, part of identity - crystallized off-timeline */
  BEING = "BEING",
}

/**
 * Custom metric definition for PUSHING attitude
 * User-defined performance tracking
 */
export interface CustomMetric {
  /** Name of the metric (e.g., "distance", "weight", "tempo") */
  name: string;
  /** Unit of measurement (e.g., "km", "kg", "bpm") */
  unit: string;
  /** Optional target value */
  target?: number;
}

/**
 * Attitude metadata and descriptions for UI
 */
export const ATTITUDE_METADATA: Record<
  Attitude,
  {
    label: string;
    description: string;
    shows: string;
    icon: string;
    hotkey: string;
    className?: string;
  }
> = {
  [Attitude.BEGINNING]: {
    label: "Beginning",
    description: "First encounters, exploration",
    shows: "Count of times tended",
    icon: "◇",
    hotkey: "1",
    className: "font-mono text-stone-700 dark:text-stone-300",
  },
  [Attitude.RETURNING]: {
    label: "Returning",
    description: "Re-engaging after a lapse",
    shows: "Days since last allocation (forgiving threshold)",
    icon: "↻",
    hotkey: "r",
    className: "font-mono text-stone-700 dark:text-stone-300",
  },
  [Attitude.KEEPING]: {
    label: "Keeping",
    description: "Sporadic engagement, maintaining connection",
    shows: "Days since last allocation",
    icon: "◌",
    hotkey: "2",

    className: "font-mono text-stone-700 dark:text-stone-300",
  },
  [Attitude.BUILDING]: {
    label: "Building",
    description: "Regular practice, developing capacity",
    shows: "Frequency patterns over time",
    icon: "△",
    hotkey: "3",
    className: "font-mono text-stone-700 dark:text-stone-300",
  },
  [Attitude.PUSHING]: {
    label: "Pushing",
    description: "Focused progression, specific goals",
    shows: "Custom performance metrics",
    icon: "↑",
    hotkey: "4",
    className: "font-mono text-stone-700 dark:text-stone-300",
  },
  [Attitude.PRUNING]: {
    label: "Pruning",
    description: "Deliberately tapering, winding down",
    shows: "Days since last — ceiling not floor",
    icon: "▽",
    hotkey: "6",
    className: "font-mono text-stone-700 dark:text-stone-300",
  },
  [Attitude.BEING]: {
    label: "Being",
    description: "Integrated, automatic, part of identity",
    shows: "Crystallized — lives off the timeline",
    icon: "◉",
    hotkey: "7",
    className: "font-mono text-stone-700 dark:text-stone-300",
  },
};

export const ATTITUDE_METADATA_ARRAY = Object.values(ATTITUDE_METADATA);

/**
 * Get human-readable label for an attitude
 */
export function getAttitudeLabel(attitude: Attitude): string {
  return ATTITUDE_METADATA[attitude].label;
}

/**
 * Get description for an attitude
 */
export function getAttitudeDescription(attitude: Attitude): string {
  return ATTITUDE_METADATA[attitude].description;
}

/**
 * Get what the system shows for an attitude
 */
export function getAttitudeShows(attitude: Attitude): string {
  return ATTITUDE_METADATA[attitude].shows;
}

/**
 * Get icon for an attitude
 */
export function getAttitudeIcon(attitude: Attitude): string {
  return ATTITUDE_METADATA[attitude].icon;
}
