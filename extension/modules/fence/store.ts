/**
 * The fence cache, on disk in `chrome.storage.local`.
 *
 * `parse.ts` decides what is well-formed; this file decides what persists. Two
 * items and one rule:
 *
 *   **A malformed push leaves the cache alone; an empty one lifts.**
 *
 * That asymmetry is the whole reliability claim. A dead or downgraded host must
 * not read as "nothing is fenced" — the fences would drop exactly when the
 * machine is least healthy — but taking a fence down has to land, or the person
 * is trapped by a mirror nobody can edit. `parseFences` returns `null` for the
 * first case and `{}` for the second, and `replaceFences` honours both.
 *
 * `fencePushedAt` records freshness rather than validity: the cache is
 * authoritative whatever its age, and the timestamp exists so a surface can say
 * how long it has been since the app last spoke.
 */

import { storage } from "wxt/storage";
import { parseFences } from "./parse";
import { writeInspection } from "./inspect";
import { withLifts, type Lift, type Opening, type PassAllowance } from "./lifts";
import type { Fences, Refusal } from "./types";

/** What is in force right now, keyed by fence id. */
export const fenceCache = storage.defineItem<Fences>("local:fence:record", { fallback: {} });

/** When the app last pushed. 0 means never — not "stale", just never. */
export const fencePushedAt = storage.defineItem<number>("local:fence:pushedAt", { fallback: 0 });

/**
 * Entries the last push was refused for, kept so the failure is visible.
 *
 * An invariant-6 refusal is a bug in the rule that set it, and a bug nobody
 * can see is one that ships. This is the surface that lets the manage page —
 * or a person reading storage — find out why a fence they declared is not
 * holding, instead of concluding the extension is broken.
 */
export const fenceRefusals = storage.defineItem<Refusal[]>("local:fence:refused", {
  fallback: [],
});

/** Planned openings from the last push, active or upcoming. */
export const openingsCache = storage.defineItem<Opening[]>("local:fence:openings", { fallback: [] });

/** The `pass-allowance` record from the last push; null means the defaults. */
export const passAllowance = storage.defineItem<PassAllowance | null>("local:fence:passAllowance", {
  fallback: null,
});

/** Passes spent and still open. Written only by the background, on a validated message. */
export const passLifts = storage.defineItem<Lift[]>("local:fence:passes", { fallback: [] });

/** Openings already announced with `opening_active`, so each is written once. */
export const openingsAnnounced = storage.defineItem<string[]>("local:fence:openingsAnnounced", {
  fallback: [],
});

/** Every lift the extension knows of: openings and passes. */
export async function allLifts(): Promise<Lift[]> {
  const [openings, passes] = await Promise.all([openingsCache.getValue(), passLifts.getValue()]);
  return [...openings, ...passes];
}

/** The fences in force at `now`, lifts applied. What every actuator reads. */
export async function liveFences(now: number = Date.now()): Promise<Fences> {
  const [fences, lifts] = await Promise.all([fenceCache.getValue(), allLifts()]);
  return withLifts(fences, lifts, now);
}

export interface FenceWriteResult {
  readonly accepted: number;
  readonly refused: readonly Refusal[];
  /** False when the push was malformed and the previous cache was kept. */
  readonly applied: boolean;
}

/** Apply a pushed fences record. Returns what landed, for logging. */
export async function replaceFences(
  raw: unknown,
  now: number = Date.now()
): Promise<FenceWriteResult> {
  const parsed = parseFences(raw);
  if (parsed === null) {
    // Not a record collection. Keep what we have — see the rule above.
    return { accepted: 0, refused: [], applied: false };
  }
  // Lifts first: the fence-cache watcher re-projects DNR, and it must see them.
  await openingsCache.setValue([...parsed.openings]);
  await passAllowance.setValue(parsed.allowance ?? null);
  await fenceCache.setValue(parsed.fences);
  await fenceRefusals.setValue([...parsed.refused]);
  await fencePushedAt.setValue(now);
  await writeInspection();
  return {
    accepted: Object.keys(parsed.fences).length,
    refused: parsed.refused,
    applied: true,
  };
}
