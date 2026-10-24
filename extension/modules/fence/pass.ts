/**
 * Passes and openings, the effectful half. Background only.
 *
 * The block page is a surface, not a writer: it asks what holds on a host and
 * asks to spend a pass. Every check (is this host under a time block, is it
 * already open, is a pass left this month) and every write happens here.
 *
 * The count has one source: `pass_used` events this local month, the host's
 * copy merged with the not-yet-flushed outbox. It survives a reinstall.
 */

import { readEventsSince } from "../activity/log";
import { queryEvents } from "../relay/client";
import { mergeById } from "./deliveries";
import {
  DEFAULT_ALLOWANCE,
  OPENING_ACTIVE_KIND,
  PASS_USED_KIND,
  isLiftActive,
  monthName,
  openingActivePayload,
  passUsedPayload,
  passesUsedThisMonth,
  startOfLocalMonth,
} from "./lifts";
import { fencesFor } from "./parse";
import { syncFenceRules } from "./project";
import { liveFences, openingsAnnounced, openingsCache, passAllowance, passLifts } from "./store";
import type { Fence, Fences } from "./types";

type Write = (kind: string, payload?: Readonly<Record<string, unknown>>) => void;

export interface BlockInfo {
  readonly host: string;
  /** Nothing blocks the host now (a lift, or the window ended): go straight back. */
  readonly open: boolean;
  /** The unlock notes of the blocks holding it. */
  readonly notes: readonly string[];
  /** Present only when every block on the host is a time block a pass can lift. */
  readonly pass: { readonly left: number; readonly perMonth: number; readonly hours: number; readonly month: string } | null;
}

export type PassResult =
  | { readonly ok: true; readonly until?: number; readonly alreadyOpen?: true }
  | { readonly ok: false; readonly error: "none_left" | "not_a_time_block" };

/** Browser blocks holding `host` in `fences`. */
export function blockingFences(fences: Fences, host: string): Fence[] {
  return fencesFor(fences, host).filter(
    (f) => f.enforcement.kind === "block" && f.enforcement.standing && f.enforcement.enforcement === "browser"
  );
}

async function passesUsed(now: number): Promise<number> {
  const since = startOfLocalMonth(now);
  const [host, outbox] = await Promise.all([queryEvents(since, [PASS_USED_KIND]), readEventsSince(since)]);
  return passesUsedThisMonth(mergeById(host, outbox), now);
}

export async function blockInfo(host: string, now: number = Date.now()): Promise<BlockInfo> {
  const blocking = blockingFences(await liveFences(now), host);
  const notes = [...new Set(blocking.map((f) => f.proceed.label))];
  if (blocking.length === 0 || !blocking.every((f) => f.schedule !== undefined)) {
    return { host, open: blocking.length === 0, notes, pass: null };
  }
  const { perMonth, hours } = (await passAllowance.getValue()) ?? DEFAULT_ALLOWANCE;
  const left = Math.max(0, perMonth - (await passesUsed(now)));
  return { host, open: false, notes, pass: { left, perMonth, hours, month: monthName(now) } };
}

// One pass at a time, so a double click cannot spend two.
let queue: Promise<unknown> = Promise.resolve();

export function usePass(host: string, reason: string, write: Write): Promise<PassResult> {
  const run = async (): Promise<PassResult> => {
    const now = Date.now();
    const info = await blockInfo(host, now);
    // Already open (an opening, an earlier pass): nothing burns.
    if (info.open) return { ok: true, alreadyOpen: true };
    if (info.pass === null) return { ok: false, error: "not_a_time_block" };
    if (info.pass.left <= 0) return { ok: false, error: "none_left" };
    const until = now + info.pass.hours * 3_600_000;
    const live = (await passLifts.getValue()).filter((l) => l.until > now);
    await passLifts.setValue([...live, { hosts: [host], from: now, until }]);
    write(PASS_USED_KIND, passUsedPayload(host, reason, until));
    // Awaited so the page's navigation lands after the rule is gone.
    await syncFenceRules();
    return { ok: true, until };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/** Write `opening_active` once for each opening that has taken effect; drop spent passes. */
export async function settleLifts(write: Write, now: number = Date.now()): Promise<void> {
  const [openings, announced, passes] = await Promise.all([
    openingsCache.getValue(),
    openingsAnnounced.getValue(),
    passLifts.getValue(),
  ]);
  const seen = new Set(announced);
  for (const o of openings) {
    if (isLiftActive(o, now) && !seen.has(o.id)) {
      write(OPENING_ACTIVE_KIND, openingActivePayload(o));
      seen.add(o.id);
    }
  }
  const kept = openings.map((o) => o.id).filter((id) => seen.has(id));
  if (kept.length !== announced.length || kept.some((id, i) => id !== announced[i])) {
    await openingsAnnounced.setValue(kept);
  }
  const live = passes.filter((l) => l.until > now);
  if (live.length !== passes.length) await passLifts.setValue(live);
}
