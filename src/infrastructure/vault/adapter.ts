/**
 * Vault adapter — thin wrappers around Tauri commands.
 *
 * These are the only functions that talk to the Rust side. Everything
 * above (the synced() factory, the UI) treats the vault as an abstract
 * key-value store keyed by collection name.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CollectionName } from "@/domain/registry";

// ────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────

/**
 * Read a collection from the vault. Returns null if the file doesn't exist
 * (e.g. first boot, collection never written).
 */
export async function readCollection<T>(
  collection: CollectionName,
): Promise<Record<string, T> | null> {
  const raw = await invoke<string | null>("vault_read_collection", {
    collection,
  });
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, T>;
  } catch (error) {
    console.error(`[vault] Failed to parse ${collection}:`, error);
    throw new Error(`Malformed JSON in ${collection}.json`);
  }
}

/**
 * Write a collection to the vault. Always a full replace — Legend State's
 * `set` handler passes us the complete value, so we don't need to merge.
 * Atomic on the Rust side (temp file + rename).
 */
export async function writeCollection<T>(
  collection: CollectionName,
  value: Record<string, T>,
): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  await invoke<void>("vault_write_collection", {
    collection,
    json,
  });
}

/**
 * Resolve the vault root path (for display in the sync drawer).
 */
export async function vaultRootPath(): Promise<string> {
  return invoke<string>("vault_root_path");
}

/**
 * Force the Rust watcher to re-emit change events for every collection.
 * Returns the number of collections nudged.
 */
export async function nudgeVault(): Promise<number> {
  return invoke<number>("vault_nudge");
}

// ────────────────────────────────────────────────────────────────────────
// External-change subscription
// ────────────────────────────────────────────────────────────────────────

interface VaultChangeEvent {
  collection: string;
  change_type: "added" | "modified" | "deleted";
}

/**
 * Subscribe to external vault changes for a specific collection.
 * Returns an unsubscribe function.
 *
 * The watcher on the Rust side already suppresses our own writes, so
 * callbacks here represent genuine external edits (git pull, manual edit,
 * another device's sync).
 */
export async function subscribeToCollection(
  collection: CollectionName,
  onChange: () => void,
): Promise<UnlistenFn> {
  return listen<VaultChangeEvent>("vault:collection-changed", (event) => {
    if (event.payload.collection === collection) {
      onChange();
    }
  });
}
