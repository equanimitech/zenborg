/**
 * The active moment — the intention pointer.
 *
 * `$ZENBORG_HOME/activeMoment.json` names the one moment that is "what I'm
 * doing now":
 *
 *   { "momentId": "80d0f15a-…", "at": "2026-08-07T13:40:12.222Z" }
 *
 * Zenborg writes it (here, and from the MCP server's `set_active_moment`);
 * **keel reads it** and surfaces it in every Claude Code session.
 *
 * Deliberately NOT in `DomainModelRegistry`: it is a singleton pointer, not a
 * `Record<uuid, Entity>`, so it would have to lie about its shape to join the
 * synced collection stores. It rides the generic vault commands instead — the
 * Rust side moves opaque JSON — and this module owns the shape.
 *
 * Desktop only. The pointer lives in the vault, and the web build has no
 * vault; callers guard with `isTauri()` and the UI hides the affordance.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type Pointer, resolvePointer } from "@/domain/attention/ActiveMoment";
import { isTauri } from "./is-tauri.ts";

const FILE = "activeMoment";

/** `until` + `returnTo` mark a timed switch; see `resolvePointer`. */
export type ActiveMomentPointer = Pointer;

function isPointer(value: unknown): value is ActiveMomentPointer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.momentId === "string" && v.momentId.length > 0;
}

/**
 * Read the pointer in force — a timed switch past its `until` reads as the
 * moment it returns to. `null` means no intention — which is also what a missing or
 * malformed file means. Fail-soft is the vault's rule, and a pointer nobody can
 * parse must never be worse than none.
 */
export async function readActiveMoment(): Promise<ActiveMomentPointer | null> {
  if (!isTauri()) return null;
  const raw = await invoke<string | null>("vault_read_collection", {
    collection: FILE,
  });
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPointer(parsed) ? resolvePointer(parsed, Date.now()) : null;
  } catch {
    return null;
  }
}

/** Point the intention at a moment. */
export async function writeActiveMoment(momentId: string): Promise<void> {
  if (!isTauri()) return;
  const pointer: ActiveMomentPointer = {
    momentId,
    at: new Date().toISOString(),
  };
  await invoke<void>("vault_write_collection", {
    collection: FILE,
    json: `${JSON.stringify(pointer, null, 2)}\n`,
  });
}

/**
 * Release the intention. Writing an empty object rather than deleting the file:
 * the Rust commands only read and write, and every reader already treats an
 * unparseable pointer as "nothing active", so the two are the same state.
 */
export async function clearActiveMoment(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("vault_write_collection", {
    collection: FILE,
    json: "{}\n",
  });
}

/** Subscribe to external edits — the MCP server setting it, or another device. */
export async function subscribeToActiveMoment(
  onChange: () => void,
): Promise<UnlistenFn | null> {
  if (!isTauri()) return null;
  return listen<{ collection: string }>("vault:collection-changed", (event) => {
    if (event.payload.collection === FILE) onChange();
  });
}
