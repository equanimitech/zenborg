/**
 * Legend State synced() factory for the zenborg vault.
 *
 * Produces a SyncedOptions config that:
 *   - Reads from $HOME/.zenborg/{collection}.json on boot
 *   - Writes on mutation (debounced 2s)
 *   - Subscribes to external edits via the Tauri watcher
 *   - Uses IndexedDB as a hot cache
 *
 * Usage:
 *   syncObservable(moments$, syncedVaultCollection("moments"));
 */

import { type Observable, syncState } from "@legendapp/state";
import { observablePersistIndexedDB } from "@legendapp/state/persist-plugins/indexeddb";
import { synced } from "@legendapp/state/sync";
import type { CollectionName } from "@/domain/registry";
import {
  readCollection,
  subscribeToCollection,
  writeCollection,
} from "./adapter";
import { isTauri } from "./is-tauri";

/**
 * IndexedDB plugin config — shared across collections.
 * Must match the tableNames registered in persistence.ts.
 */
const IDB_CONFIG = {
  databaseName: "zenborg",
  version: 8,
  tableNames: [
    "moments",
    "areas",
    "habits",
    "cycles",
    "cyclePlans",
    "phaseConfigs",
    "metricLogs",
    "dayNotes",
  ],
};

const DEBOUNCE_MS = 2000;

/**
 * Build a synced() config for a single vault collection.
 *
 * The returned config can be passed to syncObservable(obs$, config).
 */
export function syncedVaultCollection<T>(collection: CollectionName) {
  return synced<Record<string, T>>({
    // Initial + on-demand load from vault
    get: async ({ updateLastSync }) => {
      const value = await readCollection<T>(collection);
      if (value === null) {
        // Vault file doesn't exist yet. Returning {} here would overwrite
        // the IDB-cached observable (e.g. data from before the vault was
        // introduced) and the subsequent debounced set would then write {}
        // back to both IDB and the vault — destroying the data.
        //
        // Returning undefined signals "source has no value" so Legend State
        // keeps whatever the persist cache loaded. The next mutation triggers
        // a set(), which creates the vault file from the observable's value.
        return undefined as unknown as Record<string, T>;
      }
      updateLastSync(Date.now());
      return value;
    },

    // Debounced write on mutation. Legend State batches rapid changes.
    set: async ({ value, value$ }) => {
      await writeCollection(collection, value);
      // Advance lastSync. The Rust watcher suppresses our own writes, so
      // subscribe.refresh never re-runs get() after an internal mutation —
      // without this stamp, the Settings "Synced" label freezes at boot time.
      syncState(value$).lastSync.set(Date.now());
    },

    // External-edit subscription. When the watcher fires, we return a no-op
    // to force Legend State to re-run `get()` and refresh the observable.
    subscribe: ({ refresh }) => {
      let unlisten: (() => void) | undefined;
      subscribeToCollection(collection, refresh).then((fn) => {
        unlisten = fn;
      });
      return () => {
        if (unlisten) unlisten();
      };
    },

    // Hot cache in IndexedDB — survives app restarts, provides instant boot.
    persist: {
      plugin: observablePersistIndexedDB(IDB_CONFIG),
      name: collection,
    },

    // Coalesce rapid mutations (e.g. typing a habit name) into one write.
    debounceSet: DEBOUNCE_MS,

    // Retry with exponential backoff on write failures (e.g. disk full).
    retry: {
      infinite: true,
      backoff: "exponential",
    },
  });
}

/**
 * Seed the vault from IDB-cached observables for any collection whose
 * vault file is missing. This is the one-way door for users who had data
 * in IndexedDB before the vault existed: without this, their observable
 * has data but the vault file is absent, so the first mutation would be
 * the only chance to persist to disk.
 *
 * Safe to call multiple times — only writes when the file is truly absent.
 * No-op on web (non-Tauri).
 */
export async function seedVaultFromCacheIfNeeded(
  observables: ReadonlyArray<
    [CollectionName, Observable<Record<string, unknown>>]
  >,
): Promise<void> {
  if (!isTauri()) return;

  for (const [name, obs$] of observables) {
    try {
      const vaultValue = await readCollection(name);
      if (vaultValue !== null) continue;

      const current = obs$.peek();
      if (!current || Object.keys(current).length === 0) continue;

      console.log(
        `[Zenborg] Seeding vault from cache: ${name} (${Object.keys(current).length} entries)`,
      );
      await writeCollection(name, current);
    } catch (error) {
      console.error(`[Zenborg] Vault seed failed for ${name}:`, error);
    }
  }
}
