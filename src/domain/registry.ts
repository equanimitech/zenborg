/**
 * Domain Model Registry
 *
 * Central registry of all domain models that need to be persisted and exported.
 * This serves as a single source of truth for all exportable collections.
 *
 * IMPORTANT: When adding a new domain model:
 * 1. Add the model type to this file
 * 2. The export/import system will automatically detect missing models
 * 3. TypeScript will enforce that all models are handled in export/import
 *
 * This pattern ensures we never forget to export a model in the future.
 */

import type { Area } from "./entities/Area";
import type { Cycle } from "./entities/Cycle";
import type { CyclePlan } from "./entities/CyclePlan";
import type { DayNote } from "./entities/DayNote";
import type { Habit } from "./entities/Habit";
import type { MetricLog } from "./entities/MetricLog";
import type { Moment } from "./entities/Moment";
import type { PhaseConfig } from "./value-objects/Phase";

/**
 * All domain models that should be persisted and exportable
 *
 * This is a type-level registry that enforces completeness at compile time.
 * If you add a new collection here, TypeScript will require you to update:
 * - ZenborgExportData interface
 * - exportData() function
 * - importDataWithStrategy() function
 * - Infrastructure store observables
 */
export interface DomainModelRegistry {
  moments: Record<string, Moment>;
  areas: Record<string, Area>;
  habits: Record<string, Habit>;
  cycles: Record<string, Cycle>;
  cyclePlans: Record<string, CyclePlan>;
  phaseConfigs: Record<string, PhaseConfig>;
  metricLogs: Record<string, MetricLog>;
  dayNotes: Record<string, DayNote>;
}

/**
 * Names of all exportable collections
 * Useful for iteration and validation
 */
export const EXPORTABLE_MODELS = [
  "moments",
  "areas",
  "habits",
  "cycles",
  "cyclePlans",
  "phaseConfigs",
  "metricLogs",
  "dayNotes",
] as const;

/**
 * Type-safe collection name
 */
export type CollectionName = keyof DomainModelRegistry;

/**
 * Helper to check if a key is a valid collection name
 */
export function isCollectionName(key: string): key is CollectionName {
  return EXPORTABLE_MODELS.includes(key as CollectionName);
}

/**
 * Metadata for each collection
 * Useful for UI display, logging, and documentation
 */
export const COLLECTION_METADATA: Record<
  CollectionName,
  {
    displayName: string;
    singularName: string;
    description: string;
  }
> = {
  moments: {
    displayName: "Moments",
    singularName: "Moment",
    description: "Conscious attention allocations",
  },
  areas: {
    displayName: "Areas",
    singularName: "Area",
    description: "Life domains for organizing moments",
  },
  habits: {
    displayName: "Habits",
    singularName: "Habit",
    description: "Recurring moment templates",
  },
  cycles: {
    displayName: "Cycles",
    singularName: "Cycle",
    description: "Time containers for moments",
  },
  cyclePlans: {
    displayName: "Cycle Plans",
    singularName: "Cycle Plan",
    description: "Budget allocations linking habits to cycles",
  },
  phaseConfigs: {
    displayName: "Phase Configurations",
    singularName: "Phase Config",
    description: "Time-of-day phase settings",
  },
  metricLogs: {
    displayName: "Metric Logs",
    singularName: "Metric Log",
    description: "Performance tracking entries",
  },
  dayNotes: {
    displayName: "Day Notes",
    singularName: "Day Note",
    description:
      "Per-day metadata keyed by ISO date (currently a 1-3 word title)",
  },
};
