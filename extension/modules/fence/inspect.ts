/**
 * The Playwright inspection surface for fence state.
 *
 * A snapshot of what is currently in force — fences —
 * written to `chrome.storage.local` on every change so `browser_evaluate` (or
 * any e2e harness) can read it without reaching into the store internals or
 * racing a watcher. `window.__kairos` (wired in `entrypoints/popup/main.tsx`)
 * is the dev-only convenience on top of this; the storage item is the real
 * surface and works from any extension page or a `chrome.storage.local.get`.
 */

import { storage } from "wxt/storage";
import { fenceCache, fencePushedAt } from "./store";
import type { Fences } from "./types";

export interface KairosInspection {
  readonly fences: Record<
    string,
    {
      readonly id: string;
      readonly label: string;
      readonly domains: readonly string[];
      readonly enforcement: string;
      readonly standing: boolean;
    }
  >;
  readonly lastPushAt: number;
}

export const inspectionStore = storage.defineItem<KairosInspection | null>(
  "local:fence:inspection",
  { fallback: null }
);

function buildInspection(fences: Fences, pushAt: number): KairosInspection {
  const fenceMap: KairosInspection["fences"] = {};
  for (const [id, f] of Object.entries(fences)) {
    fenceMap[id] = {
      id: f.id,
      label: f.label,
      domains: [...f.domains],
      enforcement: f.enforcement.kind,
      standing: f.enforcement.kind === "block" && f.enforcement.standing,
    };
  }
  return { fences: fenceMap, lastPushAt: pushAt };
}

export async function writeInspection(): Promise<KairosInspection> {
  const [fences, pushAt] = await Promise.all([
    fenceCache.getValue(),
    fencePushedAt.getValue(),
  ]);
  const inspection = buildInspection(fences, pushAt);
  await inspectionStore.setValue(inspection);
  return inspection;
}

export async function loadInspection(): Promise<KairosInspection | null> {
  return inspectionStore.getValue();
}
