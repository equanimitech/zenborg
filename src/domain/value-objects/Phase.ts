/**
 * Phase - Time-of-day categorization for moments
 *
 * Phases divide the day into 4 periods with configurable boundaries.
 * Users can customize labels, emoji, time boundaries, and visibility.
 *
 * Phase carries no color. Color in this system attributes an Area, which is
 * user-owned and universal across apps; a parallel phase palette would compete
 * with it. Phase is expressed structurally instead: by position in the grid,
 * by label, by glyph, and by tonal step. See ../../../DESIGN.md, "Colors".
 */
export enum Phase {
  MORNING = "MORNING",
  AFTERNOON = "AFTERNOON",
  EVENING = "EVENING",
  NIGHT = "NIGHT",
}

/**
 * Configuration for a single phase
 */
export interface PhaseConfig {
  readonly id: string;
  phase: Phase;
  label: string;
  /** User-owned. Empty (the default) renders the phase glyph instead. */
  emoji: string;
  startHour: number; // 0-23
  endHour: number; // 0-23 (can wrap for night: 22-6 means 22-23, 0-6)
  isVisible: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Default phase configurations
 */
export const DEFAULT_PHASE_CONFIGS: Omit<
  PhaseConfig,
  "id" | "createdAt" | "updatedAt"
>[] = [
  {
    phase: Phase.MORNING,
    label: "Morning",
    emoji: "",
    startHour: 6,
    endHour: 12,
    isVisible: true,
    order: 0,
  },
  {
    phase: Phase.AFTERNOON,
    label: "Afternoon",
    emoji: "",
    startHour: 12,
    endHour: 18,
    isVisible: true,
    order: 1,
  },
  {
    phase: Phase.EVENING,
    label: "Evening",
    emoji: "",
    startHour: 18,
    endHour: 22,
    isVisible: true,
    order: 2,
  },
  {
    phase: Phase.NIGHT,
    label: "Night",
    emoji: "",
    startHour: 22,
    endHour: 6,
    isVisible: false, // Hidden by default
    order: 3,
  },
];

/**
 * Creates default phase configurations with generated IDs and timestamps
 */
export function getDefaultPhaseConfigs(): PhaseConfig[] {
  const now = new Date().toISOString();

  return DEFAULT_PHASE_CONFIGS.map((config) => ({
    ...config,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Checks if an hour falls within a phase's time boundary
 * Handles wrap-around for phases that cross midnight (e.g., NIGHT: 22-6)
 *
 * @param hour - Hour to check (0-23)
 * @param config - Phase configuration
 * @returns True if hour falls within the phase
 */
export function isHourInPhase(hour: number, config: PhaseConfig): boolean {
  if (hour < 0 || hour > 23) {
    throw new Error("Hour must be between 0 and 23");
  }

  const { startHour, endHour } = config;

  // Handle wrap-around (e.g., 22-6 for night)
  if (endHour <= startHour) {
    // Phase crosses midnight
    return hour >= startHour || hour < endHour;
  }

  // Normal case: start < end
  return hour >= startHour && hour < endHour;
}

/**
 * Detects the current phase based on hour and phase settings
 * Respects phase visibility settings
 *
 * @param hour - Current hour (0-23)
 * @param phaseConfigs - Array of phase configurations
 * @returns The current phase, or null if no visible phase matches
 */
export function getCurrentPhase(
  hour: number,
  phaseConfigs: PhaseConfig[],
): Phase | null {
  if (hour < 0 || hour > 23) {
    throw new Error("Hour must be between 0 and 23");
  }

  // Filter visible phases and sort by order
  const visiblePhases = phaseConfigs
    .filter((config) => config.isVisible)
    .sort((a, b) => a.order - b.order);

  // Find first matching phase
  for (const config of visiblePhases) {
    if (isHourInPhase(hour, config)) {
      return config.phase;
    }
  }

  return null;
}

/**
 * Gets the configuration for a specific phase
 *
 * @param phase - Phase to get config for
 * @param phaseConfigs - Array of phase configurations
 * @returns Phase configuration or undefined
 */
export function getPhaseConfig(
  phase: Phase,
  phaseConfigs: PhaseConfig[],
): PhaseConfig | undefined {
  return phaseConfigs.find((config) => config.phase === phase);
}

/**
 * Gets all visible phases sorted by order
 *
 * @param phaseConfigs - Array of phase configurations
 * @returns Sorted array of visible phase configs
 */
export function getVisiblePhases(phaseConfigs: PhaseConfig[]): PhaseConfig[] {
  return phaseConfigs
    .filter((config) => config.isVisible)
    .sort((a, b) => a.order - b.order);
}
