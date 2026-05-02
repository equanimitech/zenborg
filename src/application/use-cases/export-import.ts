/**
 * Export/Import Use Case
 *
 * IMPORTANT: When adding a new domain model:
 * 1. Add it to src/domain/registry.ts (DomainModelRegistry interface)
 * 2. TypeScript will automatically require you to update this file:
 *    - Add import statement above
 *    - Update exportData() parameters
 *    - Update validateImportData() validation checks
 *    - Update metadata field in ZenborgExportData
 *    - Update merge logic in importDataWithStrategy()
 * 3. Update infrastructure/state/export-import.ts to include the new observable
 * 4. Update infrastructure/state/store.ts to export the new observable
 *
 * The DomainModelRegistry type acts as the source of truth for all exportable models.
 */

import type { Area } from "@/domain/entities/Area";
import type { Cycle } from "@/domain/entities/Cycle";
import type { CyclePlan } from "@/domain/entities/CyclePlan";
import type { DayNote } from "@/domain/entities/DayNote";
import type { Habit } from "@/domain/entities/Habit";
import type { MetricLog } from "@/domain/entities/MetricLog";
import type { Moment } from "@/domain/entities/Moment";
import type { DomainModelRegistry } from "@/domain/registry";
import type { PhaseConfig } from "@/domain/value-objects/Phase";

/**
 * Export/Import Data Format
 *
 * A complete snapshot of the user's garden data.
 * Includes all entities with timestamps for data integrity.
 *
 * Uses DomainModelRegistry to ensure all models are included.
 * TypeScript will enforce that all collections in the registry are present.
 */
export interface ZenborgExportData {
  version: string; // Schema version for future migrations
  exportedAt: string; // ISO timestamp
  data: DomainModelRegistry; // All collections from the registry
  metadata: {
    totalMoments: number;
    totalAreas: number;
    totalHabits: number;
    totalCycles: number;
    totalCyclePlans: number;
    totalPhaseConfigs: number;
    totalMetricLogs: number;
    totalDayNotes: number;
  };
}

/**
 * Current schema version
 * Increment when making breaking changes to the export format
 */
export const EXPORT_SCHEMA_VERSION = "1.1.0";

/**
 * Export all data to JSON format
 *
 * @param moments - All moments
 * @param areas - All areas
 * @param habits - All habits
 * @param cycles - All cycles
 * @param cyclePlans - All cycle plans
 * @param phaseConfigs - All phase configurations
 * @param metricLogs - All metric logs
 * @returns Exportable data structure
 */
export function exportData(
  moments: Record<string, Moment>,
  areas: Record<string, Area>,
  habits: Record<string, Habit>,
  cycles: Record<string, Cycle>,
  cyclePlans: Record<string, CyclePlan>,
  phaseConfigs: Record<string, PhaseConfig>,
  metricLogs: Record<string, MetricLog>,
  dayNotes: Record<string, DayNote>,
): ZenborgExportData {
  return {
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      moments,
      areas,
      habits,
      cycles,
      cyclePlans,
      phaseConfigs,
      metricLogs,
      dayNotes,
    },
    metadata: {
      totalMoments: Object.keys(moments).length,
      totalAreas: Object.keys(areas).length,
      totalHabits: Object.keys(habits).length,
      totalCycles: Object.keys(cycles).length,
      totalCyclePlans: Object.keys(cyclePlans).length,
      totalPhaseConfigs: Object.keys(phaseConfigs).length,
      totalMetricLogs: Object.keys(metricLogs).length,
      totalDayNotes: Object.keys(dayNotes).length,
    },
  };
}

/**
 * Validation result for import data
 */
export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate imported data structure
 *
 * @param data - Data to validate
 * @returns Validation result with errors and warnings
 */
export function validateImportData(data: unknown): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if data is an object
  if (!data || typeof data !== "object") {
    errors.push("Invalid data format: must be a JSON object");
    return { valid: false, errors, warnings };
  }

  const exportData = data as Partial<ZenborgExportData>;

  // Check required fields
  if (!exportData.version) {
    errors.push("Missing version field");
  }

  if (!exportData.exportedAt) {
    errors.push("Missing exportedAt field");
  }

  if (!exportData.data) {
    errors.push("Missing data field");
    return { valid: false, errors, warnings };
  }

  // Check data structure
  const {
    moments,
    areas,
    habits,
    cycles,
    cyclePlans,
    phaseConfigs,
    metricLogs,
  } = exportData.data;

  // Core collections (required)
  if (!moments || typeof moments !== "object") {
    errors.push("Invalid or missing moments data");
  }

  if (!areas || typeof areas !== "object") {
    errors.push("Invalid or missing areas data");
  }

  if (!cycles || typeof cycles !== "object") {
    errors.push("Invalid or missing cycles data");
  }

  if (!phaseConfigs || typeof phaseConfigs !== "object") {
    errors.push("Invalid or missing phaseConfigs data");
  }

  // Optional collections (newer features - warn but don't fail)
  if (!habits || typeof habits !== "object") {
    warnings.push("Missing habits data - will import as empty");
  }

  if (!cyclePlans || typeof cyclePlans !== "object") {
    warnings.push("Missing cyclePlans data - will import as empty");
  }

  if (!metricLogs || typeof metricLogs !== "object") {
    warnings.push("Missing metricLogs data - will import as empty");
  }

  if (
    !exportData.data.dayNotes ||
    typeof exportData.data.dayNotes !== "object"
  ) {
    warnings.push("Missing dayNotes data - will import as empty");
  }

  // Legacy fields — dropped silently at import, warned here for transparency.
  if (
    "crystallizedRoutines" in
    (exportData.data as unknown as Record<string, unknown>)
  ) {
    warnings.push(
      "Legacy field 'crystallizedRoutines' will be ignored (removed in schema 1.1.0)",
    );
  }

  // Check version compatibility
  if (exportData.version !== EXPORT_SCHEMA_VERSION) {
    warnings.push(
      `Schema version mismatch: expected ${EXPORT_SCHEMA_VERSION}, got ${exportData.version}`,
    );
  }

  // Validate referential integrity
  if (moments && areas) {
    for (const [id, moment] of Object.entries(moments)) {
      if (!moment.id || moment.id !== id) {
        errors.push(`Moment ${id} has mismatched ID`);
      }
      if (moment.areaId && !areas[moment.areaId]) {
        warnings.push(
          `Moment "${moment.name}" references non-existent area ${moment.areaId}`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Import strategy options
 */
export type ImportStrategy = "merge" | "replace";

/**
 * Import result
 */
export interface ImportResult {
  success: boolean;
  message: string;
  imported: {
    moments: number;
    areas: number;
    habits: number;
    cycles: number;
    cyclePlans: number;
    phaseConfigs: number;
    metricLogs: number;
    dayNotes: number;
  };
  conflicts?: {
    moments: string[];
    areas: string[];
    habits: string[];
    cycles: string[];
    cyclePlans: string[];
    phaseConfigs: string[];
    metricLogs: string[];
    dayNotes: string[];
  };
}

/**
 * Import data with specified strategy
 *
 * @param importData - Validated import data
 * @param strategy - "merge" (preserve existing) or "replace" (overwrite all)
 * @param currentData - Current state data
 * @returns Import result with statistics
 */
export function importDataWithStrategy(
  importData: ZenborgExportData,
  strategy: ImportStrategy,
  currentData: DomainModelRegistry,
): DomainModelRegistry & {
  result: ImportResult;
} {
  // Ensure all collections exist with defaults for optional ones
  const safeImportData = {
    moments: importData.data.moments || {},
    areas: importData.data.areas || {},
    habits: importData.data.habits || {},
    cycles: importData.data.cycles || {},
    cyclePlans: importData.data.cyclePlans || {},
    phaseConfigs: importData.data.phaseConfigs || {},
    metricLogs: importData.data.metricLogs || {},
    dayNotes: importData.data.dayNotes || {},
  };

  if (strategy === "replace") {
    // Replace strategy: use imported data as-is (with defaults)
    return {
      ...safeImportData,
      result: {
        success: true,
        message: "All data replaced successfully",
        imported: {
          moments: Object.keys(safeImportData.moments).length,
          areas: Object.keys(safeImportData.areas).length,
          habits: Object.keys(safeImportData.habits).length,
          cycles: Object.keys(safeImportData.cycles).length,
          cyclePlans: Object.keys(safeImportData.cyclePlans).length,
          phaseConfigs: Object.keys(safeImportData.phaseConfigs).length,
          metricLogs: Object.keys(safeImportData.metricLogs).length,
          dayNotes: Object.keys(safeImportData.dayNotes).length,
        },
      },
    };
  }

  // Merge strategy: combine existing and imported data
  const conflicts = {
    moments: [] as string[],
    areas: [] as string[],
    habits: [] as string[],
    cycles: [] as string[],
    cyclePlans: [] as string[],
    phaseConfigs: [] as string[],
    metricLogs: [] as string[],
    dayNotes: [] as string[],
  };

  // Merge moments (imported overwrites existing on ID conflict)
  const mergedMoments = { ...currentData.moments };
  for (const [id, moment] of Object.entries(safeImportData.moments)) {
    if (mergedMoments[id]) {
      conflicts.moments.push(id);
    }
    mergedMoments[id] = moment;
  }

  // Merge areas
  const mergedAreas = { ...currentData.areas };
  for (const [id, area] of Object.entries(safeImportData.areas)) {
    if (mergedAreas[id]) {
      conflicts.areas.push(id);
    }
    mergedAreas[id] = area;
  }

  // Merge habits
  const mergedHabits = { ...currentData.habits };
  for (const [id, habit] of Object.entries(safeImportData.habits)) {
    if (mergedHabits[id]) {
      conflicts.habits.push(id);
    }
    mergedHabits[id] = habit;
  }

  // Merge cycles
  const mergedCycles = { ...currentData.cycles };
  for (const [id, cycle] of Object.entries(safeImportData.cycles)) {
    if (mergedCycles[id]) {
      conflicts.cycles.push(id);
    }
    mergedCycles[id] = cycle;
  }

  // Merge cycle plans
  const mergedCyclePlans = { ...currentData.cyclePlans };
  for (const [id, cyclePlan] of Object.entries(safeImportData.cyclePlans)) {
    if (mergedCyclePlans[id]) {
      conflicts.cyclePlans.push(id);
    }
    mergedCyclePlans[id] = cyclePlan;
  }

  // Merge phase configs
  const mergedPhaseConfigs = { ...currentData.phaseConfigs };
  for (const [id, config] of Object.entries(safeImportData.phaseConfigs)) {
    if (mergedPhaseConfigs[id]) {
      conflicts.phaseConfigs.push(id);
    }
    mergedPhaseConfigs[id] = config;
  }

  // Merge metric logs
  const mergedMetricLogs = { ...currentData.metricLogs };
  for (const [id, log] of Object.entries(safeImportData.metricLogs)) {
    if (mergedMetricLogs[id]) {
      conflicts.metricLogs.push(id);
    }
    mergedMetricLogs[id] = log;
  }

  // Merge day notes (keyed by ISO date)
  const mergedDayNotes = { ...currentData.dayNotes };
  for (const [date, note] of Object.entries(safeImportData.dayNotes)) {
    if (mergedDayNotes[date]) {
      conflicts.dayNotes.push(date);
    }
    mergedDayNotes[date] = note;
  }

  const totalConflicts =
    conflicts.moments.length +
    conflicts.areas.length +
    conflicts.habits.length +
    conflicts.cycles.length +
    conflicts.cyclePlans.length +
    conflicts.phaseConfigs.length +
    conflicts.metricLogs.length +
    conflicts.dayNotes.length;

  return {
    moments: mergedMoments,
    areas: mergedAreas,
    habits: mergedHabits,
    cycles: mergedCycles,
    cyclePlans: mergedCyclePlans,
    phaseConfigs: mergedPhaseConfigs,
    metricLogs: mergedMetricLogs,
    dayNotes: mergedDayNotes,
    result: {
      success: true,
      message:
        totalConflicts > 0
          ? `Data merged successfully with ${totalConflicts} conflicts (imported data took precedence)`
          : "Data merged successfully with no conflicts",
      imported: {
        moments: Object.keys(safeImportData.moments).length,
        areas: Object.keys(safeImportData.areas).length,
        habits: Object.keys(safeImportData.habits).length,
        cycles: Object.keys(safeImportData.cycles).length,
        cyclePlans: Object.keys(safeImportData.cyclePlans).length,
        phaseConfigs: Object.keys(safeImportData.phaseConfigs).length,
        metricLogs: Object.keys(safeImportData.metricLogs).length,
        dayNotes: Object.keys(safeImportData.dayNotes).length,
      },
      conflicts: totalConflicts > 0 ? conflicts : undefined,
    },
  };
}

/**
 * Download data as JSON file
 *
 * @param data - Export data to download
 * @param filename - Optional filename (defaults to "zenborg-export-{date}.json")
 */
export function downloadExportFile(
  data: ZenborgExportData,
  filename?: string,
): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const defaultFilename = `zenborg-export-${
    new Date().toISOString().split("T")[0]
  }.json`;

  const link = document.createElement("a");
  link.href = url;
  link.download = filename || defaultFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read and parse import file
 *
 * @param file - File to read
 * @returns Promise with parsed data or error
 */
export async function readImportFile(
  file: File,
): Promise<ZenborgExportData | { error: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content) as ZenborgExportData;
        resolve(data);
      } catch (error) {
        resolve({
          error: `Failed to parse JSON: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        });
      }
    };

    reader.onerror = () => {
      resolve({ error: "Failed to read file" });
    };

    reader.readAsText(file);
  });
}
