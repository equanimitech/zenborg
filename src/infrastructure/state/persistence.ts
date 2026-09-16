/**
 * Client-side persistence configuration.
 *
 * Two modes, chosen at runtime:
 *
 *   Tauri desktop →  vault-synced: each domain collection lives at
 *                    $HOME/.zenborg/{collection}.json. IndexedDB is a hot
 *                    runtime cache. Vault is source of truth across sessions
 *                    and devices.
 *
 *   Web browser   →  IDB-only: same layout as before the vault migration.
 *                    No vault. IndexedDB is both cache and truth.
 *
 * UI preferences (activeCycleId, lastUsedAreaId) always go
 * to localStorage regardless of runtime — they're per-device, not per-vault.
 */

import { observablePersistIndexedDB } from "@legendapp/state/persist-plugins/indexeddb";
import { ObservablePersistLocalStorage } from "@legendapp/state/persist-plugins/local-storage";
import { configureSynced, syncObservable } from "@legendapp/state/sync";
import type { Area } from "@/domain/entities/Area";
import type { Cycle } from "@/domain/entities/Cycle";
import type { CyclePlan } from "@/domain/entities/CyclePlan";
import type { DayNote } from "@/domain/entities/DayNote";
import type { Habit } from "@/domain/entities/Habit";
import type { MetricLog } from "@/domain/entities/MetricLog";
import type { Moment } from "@/domain/entities/Moment";
import type { Person } from "@/domain/entities/Person";
import type { Place } from "@/domain/entities/Place";
import type { Relationship } from "@/domain/entities/Relationship";
import type { Routine } from "@/domain/entities/Routine";
import type { PhaseConfig } from "@/domain/value-objects/Phase";
import { isTauri } from "../vault/is-tauri.ts";
import { syncedVaultCollection } from "../vault/synced-vault.ts";
import {
  activeCycleId$,
  areas$,
  cyclePlans$,
  cycles$,
  dayNotes$,
  habits$,
  metricLogs$,
  moments$,
  people$,
  phaseConfigs$,
  places$,
  relationships$,
  routines$,
} from "./store";
import { lastUsedAreaId$ } from "./ui-store.ts";

let persistenceConfigured = false;

export function configurePersistence(): void {
  if (persistenceConfigured) {
    return;
  }

  if (typeof window === "undefined") {
    console.warn("[Zenborg] Persistence skipped (not in browser)");
    return;
  }

  try {
    if (isTauri()) {
      configureVaultSync();
    } else {
      configureIdbOnly();
    }
    configureUiPreferences();

    persistenceConfigured = true;
    console.log(
      `[Zenborg] Persistence configured (${isTauri() ? "vault" : "idb-only"})`,
    );
  } catch (error) {
    console.error("[Zenborg] Failed to configure persistence:", error);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Vault mode (Tauri)
// ────────────────────────────────────────────────────────────────────────

function configureVaultSync(): void {
  syncObservable(moments$, syncedVaultCollection<Moment>("moments"));
  syncObservable(areas$, syncedVaultCollection<Area>("areas"));
  syncObservable(habits$, syncedVaultCollection<Habit>("habits"));
  syncObservable(cycles$, syncedVaultCollection<Cycle>("cycles"));
  syncObservable(cyclePlans$, syncedVaultCollection<CyclePlan>("cyclePlans"));
  syncObservable(
    phaseConfigs$,
    syncedVaultCollection<PhaseConfig>("phaseConfigs"),
  );
  syncObservable(metricLogs$, syncedVaultCollection<MetricLog>("metricLogs"));
  syncObservable(dayNotes$, syncedVaultCollection<DayNote>("dayNotes"));
  syncObservable(people$, syncedVaultCollection<Person>("people"));
  syncObservable(places$, syncedVaultCollection<Place>("places"));
  syncObservable(
    relationships$,
    syncedVaultCollection<Relationship>("relationships"),
  );
  syncObservable(routines$, syncedVaultCollection<Routine>("routines"));
}

// ────────────────────────────────────────────────────────────────────────
// IDB-only mode (Web)
// ────────────────────────────────────────────────────────────────────────

function configureIdbOnly(): void {
  const persistIndexedDBOptions = configureSynced({
    persist: {
      plugin: observablePersistIndexedDB({
        databaseName: "zenborg",
        version: 10,
        tableNames: [
          "moments",
          "areas",
          "habits",
          "cycles",
          "cyclePlans",
          "phaseConfigs",
          "metricLogs",
          "dayNotes",
          "people",
          "places",
          "relationships",
          "routines",
        ],
      }),
    },
  });

  syncObservable(
    moments$,
    persistIndexedDBOptions({ persist: { name: "moments" } }),
  );
  syncObservable(
    areas$,
    persistIndexedDBOptions({ persist: { name: "areas" } }),
  );
  syncObservable(
    habits$,
    persistIndexedDBOptions({ persist: { name: "habits" } }),
  );
  syncObservable(
    cycles$,
    persistIndexedDBOptions({ persist: { name: "cycles" } }),
  );
  syncObservable(
    cyclePlans$,
    persistIndexedDBOptions({ persist: { name: "cyclePlans" } }),
  );
  syncObservable(
    phaseConfigs$,
    persistIndexedDBOptions({ persist: { name: "phaseConfigs" } }),
  );
  syncObservable(
    metricLogs$,
    persistIndexedDBOptions({ persist: { name: "metricLogs" } }),
  );
  syncObservable(
    dayNotes$,
    persistIndexedDBOptions({ persist: { name: "dayNotes" } }),
  );
  syncObservable(
    people$,
    persistIndexedDBOptions({ persist: { name: "people" } }),
  );
  syncObservable(
    places$,
    persistIndexedDBOptions({ persist: { name: "places" } }),
  );
  syncObservable(
    relationships$,
    persistIndexedDBOptions({ persist: { name: "relationships" } }),
  );
  syncObservable(
    routines$,
    persistIndexedDBOptions({ persist: { name: "routines" } }),
  );
}

// ────────────────────────────────────────────────────────────────────────
// UI preferences — always localStorage (per-device)
// ────────────────────────────────────────────────────────────────────────

function configureUiPreferences(): void {
  const persistLocalStorageOptions = configureSynced({
    persist: {
      plugin: ObservablePersistLocalStorage,
    },
  });

  syncObservable(
    activeCycleId$,
    persistLocalStorageOptions({
      persist: { name: "zenborg_activeCycleId" },
    }),
  );
  syncObservable(
    lastUsedAreaId$,
    persistLocalStorageOptions({
      persist: { name: "zenborg_lastUsedAreaId" },
    }),
  );
}
