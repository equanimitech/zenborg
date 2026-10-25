// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { observable } from "@legendapp/state";
import { syncObservable } from "@legendapp/state/sync";
import { expect, it, vi } from "vitest";

// A fake vault behind the Tauri bridge. `vault_nudge` emits a change event
// per collection, as src-tauri/src/vault/mod.rs does.
const { disk, listeners } = vi.hoisted(() => ({
  disk: {} as Record<string, string>,
  listeners: [] as Array<(e: { payload: { collection: string } }) => void>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: { collection: string; json?: string }) => {
    if (cmd === "vault_read_collection") return disk[args!.collection] ?? null;
    if (cmd === "vault_write_collection") disk[args!.collection] = args!.json!;
    if (cmd === "vault_nudge") {
      for (const collection of Object.keys(disk)) {
        for (const l of listeners) l({ payload: { collection } });
      }
      return Object.keys(disk).length;
    }
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (typeof listeners)[number]) => {
    listeners.push(cb);
    return () => {};
  }),
}));

import { syncedVaultCollection } from "@/infrastructure/vault/synced-vault";
import { viewCommands } from "../view-commands";

const settle = () => new Promise((r) => setTimeout(r, 200));

it("mod+r re-reads the vault when the watcher missed an external write (#208)", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  disk.moments = JSON.stringify({ m1: { id: "m1", status: "accepted" } });
  const moments$ = observable<Record<string, { id: string; status: string }>>({});
  syncObservable(moments$, syncedVaultCollection("moments"));
  moments$.get();
  await settle();
  expect(moments$.m1.status.peek()).toBe("accepted");

  // The MCP server writes; no watcher event reaches the app.
  disk.moments = JSON.stringify({ m1: { id: "m1", status: "tentative" } });
  await settle();
  expect(moments$.m1.status.peek()).toBe("accepted");

  const reload = viewCommands.find((c) => c.id === "view.reloadVault");
  expect(reload?.shortcut).toBe("mod+r");
  reload?.action();
  await settle();

  expect(moments$.m1.status.peek()).toBe("tentative");
});
