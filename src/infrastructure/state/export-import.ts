import {
  exportData,
  importDataWithStrategy,
  validateImportData,
  downloadExportFile,
  readImportFile,
  type ImportStrategy,
} from "@/application/use-cases/export-import";
import { writeCollection } from "../vault/adapter";
import { isTauri } from "../vault/is-tauri";
import {
  moments$,
  areas$,
  habits$,
  cycles$,
  cyclePlans$,
  phaseConfigs$,
  metricLogs$,
  dayNotes$,
} from "./store";

/**
 * Export all garden data to JSON file
 *
 * Downloads a JSON file containing all moments, areas, habits, cycles, cycle plans,
 * phase configs, and metric logs.
 * File is named "zenborg-export-{date}.json" by default.
 *
 * @param filename - Optional custom filename
 */
export function exportGardenData(filename?: string): void {
  const moments = moments$.get();
  const areas = areas$.get();
  const habits = habits$.get();
  const cycles = cycles$.get();
  const cyclePlans = cyclePlans$.get();
  const phaseConfigs = phaseConfigs$.get();
  const metricLogs = metricLogs$.get();
  const dayNotes = dayNotes$.get();

  const exportedData = exportData(
    moments,
    areas,
    habits,
    cycles,
    cyclePlans,
    phaseConfigs,
    metricLogs,
    dayNotes,
  );

  downloadExportFile(exportedData, filename);

  console.log(
    "[exportGardenData] Exported:",
    exportedData.metadata.totalMoments,
    "moments,",
    exportedData.metadata.totalAreas,
    "areas,",
    exportedData.metadata.totalHabits,
    "habits,",
    exportedData.metadata.totalCycles,
    "cycles,",
    exportedData.metadata.totalCyclePlans,
    "cycle plans,",
    exportedData.metadata.totalPhaseConfigs,
    "phase configs,",
    exportedData.metadata.totalMetricLogs,
    "metric logs,",
    exportedData.metadata.totalDayNotes,
    "day notes",
  );
}

/**
 * Import garden data from JSON file
 *
 * @param file - File to import
 * @param strategy - "merge" (preserve existing) or "replace" (overwrite all)
 * @returns Promise with import result
 */
export async function importGardenData(
  file: File,
  strategy: ImportStrategy = "merge",
): Promise<{ success: boolean; message: string; errors?: string[] }> {
  // Read file
  const fileData = await readImportFile(file);

  if ("error" in fileData) {
    return {
      success: false,
      message: fileData.error,
      errors: [fileData.error],
    };
  }

  // Validate data
  const validation = validateImportData(fileData);

  if (!validation.valid) {
    return {
      success: false,
      message: "Invalid import file",
      errors: validation.errors,
    };
  }

  // Warn about version mismatch but continue
  if (validation.warnings.length > 0) {
    console.warn("[importGardenData] Warnings:", validation.warnings);
  }

  // Get current data
  const currentData = {
    moments: moments$.get(),
    areas: areas$.get(),
    habits: habits$.get(),
    cycles: cycles$.get(),
    cyclePlans: cyclePlans$.get(),
    phaseConfigs: phaseConfigs$.get(),
    metricLogs: metricLogs$.get(),
    dayNotes: dayNotes$.get(),
  };

  // Import with strategy
  const {
    moments,
    areas,
    habits,
    cycles,
    cyclePlans,
    phaseConfigs,
    metricLogs,
    dayNotes,
    result,
  } = importDataWithStrategy(fileData, strategy, currentData);

  // Tauri: bypass Legend State entirely. A pending synced.get() from boot
  // can resolve with an empty vault AFTER our observable.set() and wipe
  // the import. Writing directly to vault + reload sidesteps the race.
  if (isTauri()) {
    await writeCollection("moments", moments);
    await writeCollection("areas", areas);
    await writeCollection("habits", habits);
    await writeCollection("cycles", cycles);
    await writeCollection("cyclePlans", cyclePlans);
    await writeCollection("phaseConfigs", phaseConfigs);
    await writeCollection("metricLogs", metricLogs);
    await writeCollection("dayNotes", dayNotes);
    console.log("[importGardenData] Vault written, reloading to rehydrate");
    if (typeof window !== "undefined") {
      window.location.reload();
    }
    return { success: result.success, message: result.message };
  }

  // Web (IDB-only): direct observable updates are safe — no vault race.
  moments$.set(moments);
  areas$.set(areas);
  habits$.set(habits);
  cycles$.set(cycles);
  cyclePlans$.set(cyclePlans);
  phaseConfigs$.set(phaseConfigs);
  metricLogs$.set(metricLogs);
  dayNotes$.set(dayNotes);

  console.log("[importGardenData] Import complete:", result);

  return {
    success: result.success,
    message: result.message,
  };
}

/**
 * Trigger file input for import
 *
 * Opens a file picker dialog and imports the selected file.
 * Useful for Vim command integration.
 *
 * @param strategy - "merge" or "replace"
 * @param onComplete - Callback with result
 */
export function triggerImportDialog(
  strategy: ImportStrategy = "merge",
  onComplete?: (result: { success: boolean; message: string }) => void,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";

  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      onComplete?.({ success: false, message: "No file selected" });
      return;
    }

    const result = await importGardenData(file, strategy);
    onComplete?.(result);
  };

  input.click();
}
