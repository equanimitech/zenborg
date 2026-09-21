import { createCycle, isDateInCycle } from "@/domain/entities/Cycle";
import { getDefaultPhaseConfigs } from "@/domain/value-objects/Phase";
import { seedVaultFromCacheIfNeeded } from "../vault/synced-vault.ts";
import { configurePersistence } from "./persistence.ts";
import { selectionState$ } from "./selection.ts";
import {
  activeCycleId$,
  areas$,
  cyclePlans$,
  cycles$,
  habits$,
  metricLogs$,
  moments$,
  phaseConfigs$,
  runBootReconciler,
  storeHydrated$,
} from "./store";

/**
 * Initializes the application state on first run
 *
 * Process:
 * 1. Configure IndexedDB persistence (client-side only)
 * 2. Wait for persistence to load existing data
 * 3. Check if data exists (not first run)
 * 4. If empty (first run):
 *    - Create 4 default phase configurations
 *    - Create first cycle ("First Cycle", starting today)
 * 5. Persist all to IndexedDB (automatically via syncObservable)
 *
 * This function is idempotent - safe to call multiple times.
 * On subsequent runs, it will skip initialization since data exists.
 */
export async function initializeStore(): Promise<void> {
  // Configure IndexedDB persistence (only runs once, only in browser)
  configurePersistence();

  // Small delay to allow IndexedDB to load existing data
  await new Promise((resolve) => setTimeout(resolve, 200));

  // If running in Tauri and vault files are missing but IDB has data
  // (e.g. after an upgrade that introduced the vault), copy cache → vault
  // so the next synced.get() finds a file instead of treating it as empty.
  await seedVaultFromCacheIfNeeded([
    ["moments", moments$ as never],
    ["areas", areas$ as never],
    ["habits", habits$ as never],
    ["cycles", cycles$ as never],
    ["cyclePlans", cyclePlans$ as never],
    ["phaseConfigs", phaseConfigs$ as never],
    ["metricLogs", metricLogs$ as never],
  ]);

  // Check if data already exists (not first run)
  // NOTE: We don't check areas since they're not seeded anymore
  const hasCycles = Object.keys(cycles$.get()).length > 0;
  const hasPhaseConfigs = Object.keys(phaseConfigs$.get()).length > 0;

  // If data exists, run migrations then skip initialization
  if (hasCycles && hasPhaseConfigs) {
    migrateActiveCycleId();
    migrateCycleIntentionReflection();
    storeHydrated$.set(true);
    await runBootReconciler();
    return;
  }

  // First run: seed default data
  console.log("[Zenborg] First run detected - initializing default data");

  // Areas and habits are not seeded, and there is no code path here that could
  // seed them. That absence is the guarantee, not a value someone remembered to
  // clear: a plot is the one input the system cannot derive, infer or defer, so
  // a first run leaves the board empty and the peer names their own. What ships
  // is scaffolding only: four phase bands and one cycle to hang a day on.

  // Create 4 default phase configurations
  if (!hasPhaseConfigs) {
    const defaultPhases = getDefaultPhaseConfigs();
    const phasesRecord = defaultPhases.reduce(
      (acc, phase) => {
        acc[phase.id] = phase;
        return acc;
      },
      {} as Record<string, (typeof defaultPhases)[0]>,
    );

    phaseConfigs$.set(phasesRecord);
    console.log("[Zenborg] Created 4 default phase configurations");
  }

  // Create first cycle
  if (!hasCycles) {
    const today = new Date().toISOString().split("T")[0];
    const firstCycle = createCycle({
      name: "First Season",
      startDate: today,
      endDate: null,
    });

    if ("error" in firstCycle) {
      console.error(
        "[Zenborg] Failed to create first cycle:",
        firstCycle.error,
      );
      return;
    }

    cycles$[firstCycle.id].set(firstCycle);
    activeCycleId$.set(firstCycle.id);
    console.log("[Zenborg] Created first cycle:", firstCycle.name);
  }

  storeHydrated$.set(true);
  await runBootReconciler();
  console.log("[Zenborg] Initialization complete");
}

/**
 * Migration: backfill intention + reflection fields on legacy cycles.
 * Cycles created before these fields existed persist without them;
 * we set both to null so the rest of the app can rely on the schema shape.
 */
function migrateCycleIntentionReflection(): void {
  const all = cycles$.get();
  for (const id of Object.keys(all)) {
    const cycle = all[id] as {
      intention?: string | null;
      reflection?: string | null;
    };
    if (cycle.intention === undefined) {
      cycles$[id].intention.set(null);
    }
    if (cycle.reflection === undefined) {
      cycles$[id].reflection.set(null);
    }
  }
}

/**
 * Migration: If activeCycleId$ is null but cycles exist,
 * find a cycle containing today and set it as active.
 *
 * Handles the transition from the old isActive flag on Cycle entities
 * to the new activeCycleId$ observable.
 */
function migrateActiveCycleId(): void {
  if (activeCycleId$.get() !== null) return;

  const allCycles = Object.values(cycles$.get());
  if (allCycles.length === 0) return;

  const today = new Date().toISOString().split("T")[0];
  const currentCycle = allCycles.find((c) => isDateInCycle(c, today));

  if (currentCycle) {
    activeCycleId$.set(currentCycle.id);
    console.log(`[Zenborg] Migration: activated cycle "${currentCycle.name}"`);
  }
}

/**
 * Clears all data from the store and IndexedDB
 * Use with caution - this is irreversible!
 *
 * Useful for:
 * - Testing
 * - Resetting the app to factory defaults
 * - Debugging
 */
export function clearStore(): void {
  moments$.set({});
  areas$.set({});
  cycles$.set({});
  activeCycleId$.set(null);
  phaseConfigs$.set({});
  selectionState$.set({
    editingMomentId: null,
    selectedMomentIds: [],
    lastSelectedId: null,
  });
  console.log("[Zenborg] Store cleared - all data removed");
}

/**
 * Resets the entire store to factory defaults
 * This clears all data and re-initializes with the phase bands and first cycle
 *
 * Process:
 * 1. Clear all existing data
 * 2. Reinitialize the scaffolding (phase configurations, first cycle)
 */
export async function resetStore(): Promise<void> {
  console.log("[Zenborg] Resetting store to factory defaults...");
  clearStore();

  // Small delay to allow persistence to clear
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Reinitialize with default data
  await initializeStore();
  console.log("[Zenborg] Store reset complete");
}
