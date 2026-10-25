/**
 * Passes and openings: a rationed, time-boxed way through a time block.
 *
 * A **lift** opens hosts from `from` until `until`. Two arrive here: a pass,
 * spent on the block page (the background records it), and a planned opening,
 * declared ahead through Claude as an `opening` record in `fences.json`.
 *
 * A lift takes its hosts out of **scheduled blocks** and **gates**. A standing
 * block with no schedule keeps its out-of-band unlock, and hides (transforms)
 * never reach this cache at all, so they stay.
 *
 * Pure: no chrome APIs, no storage. The clock arrives as an argument.
 */

import { normalizeDomain } from "../domains";
import type { Fence, Fences } from "./types";

export interface Lift {
  readonly hosts: readonly string[];
  /** Epoch ms. */
  readonly from: number;
  /** Epoch ms, exclusive. */
  readonly until: number;
}

export interface Opening extends Lift {
  readonly id: string;
  readonly reason: string;
}

export interface PassAllowance {
  readonly perMonth: number;
  readonly hours: number;
}

/** What the extension uses when `fences.json` carries no `pass-allowance` record. */
export const DEFAULT_ALLOWANCE: PassAllowance = { perMonth: 4, hours: 3 };

export const OPENING_KIND = "opening";
export const ALLOWANCE_KIND = "pass-allowance";

const MAX_REASON = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const h of raw) {
    const host = typeof h === "string" ? normalizeDomain(h) : null;
    if (host !== null) out.add(host);
  }
  return [...out];
}

/**
 * An `opening` record, or null when it is malformed or already over at `now`.
 * An upcoming opening is kept: it lifts once `now` reaches `from`.
 */
export function readOpening(id: string, value: Record<string, unknown>, now: number): Opening | null {
  const hosts = hostsOf(value.hosts);
  const from = Date.parse(String(value.from));
  const until = Date.parse(String(value.until));
  if (hosts.length === 0 || !Number.isFinite(from) || !Number.isFinite(until) || until <= from) {
    return null;
  }
  if (until <= now) return null;
  const reason = typeof value.reason === "string" ? value.reason.trim().slice(0, MAX_REASON) : "";
  return { id, hosts, from, until, reason };
}

/** A `pass-allowance` record, or null to fall back to the defaults. */
export function readAllowance(value: Record<string, unknown>): PassAllowance | null {
  const perMonth = Number(value.perMonth);
  const hours = Number(value.hours);
  if (!Number.isInteger(perMonth) || perMonth < 0 || !Number.isFinite(hours) || hours <= 0) {
    return null;
  }
  return { perMonth, hours };
}

export function isLiftActive(lift: Lift, now: number): boolean {
  return lift.from <= now && now < lift.until;
}

function covers(domain: string, host: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Is `domain` lifted at `now`? Either direction counts: a lift on youtube.com
 * opens m.youtube.com, and a lift on m.youtube.com opens a block declared on
 * youtube.com.
 *
 * ponytail: the second direction lifts the parent domain whole (DNR blocks by
 * domain list); use `excludedRequestDomains` if a subdomain-only pass matters.
 */
export function isLifted(lifts: readonly Lift[], domain: string, now: number): boolean {
  return lifts.some(
    (l) => isLiftActive(l, now) && l.hosts.some((h) => covers(h, domain) || covers(domain, h))
  );
}

/** Would a lift reach this fence at all? Scheduled blocks and gates; nothing else. */
function liftable(fence: Fence): boolean {
  return fence.enforcement.kind === "gate" || fence.schedule !== undefined;
}

/**
 * The fences in force once active lifts are applied: lifted domains come out of
 * scheduled blocks and gates, and a fence left with no domains drops. The one
 * choke point: DNR projection, gate evaluation and the block page all read this.
 */
export function withLifts(fences: Fences, lifts: readonly Lift[], now: number): Fences {
  if (!lifts.some((l) => isLiftActive(l, now))) return fences;
  const out: Record<string, Fence> = {};
  for (const [id, fence] of Object.entries(fences)) {
    if (!liftable(fence)) {
      out[id] = fence;
      continue;
    }
    const domains = fence.domains.filter((d) => !isLifted(lifts, d, now));
    if (domains.length === fence.domains.length) out[id] = fence;
    else if (domains.length > 0) out[id] = { ...fence, domains };
  }
  return out;
}

/** The next instant a lift starts or ends, or null. Drives the edge alarm. */
export function nextLiftEdge(lifts: readonly Lift[], now: number): number | null {
  let next: number | null = null;
  for (const l of lifts) {
    for (const t of [l.from, l.until]) {
      if (t > now && (next === null || t < next)) next = t;
    }
  }
  return next;
}

/** Midnight on the 1st of `now`'s month, local time. The allowance resets here. */
export function startOfLocalMonth(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** "October", for "N of 4 left in October". Local, like the reset. */
export function monthName(now: number): string {
  return new Date(now).toLocaleString("en-US", { month: "long" });
}

export const PASS_USED_KIND = "pass_used";
export const OPENING_ACTIVE_KIND = "opening_active";
export const BLOCK_HIT_KIND = "block_hit";

/** `block_hit`: a blocked load was attempted. The domain and the blocking fence ids. Never the URL. */
export function blockHitPayload(domain: string, fences: readonly { readonly id: string }[]) {
  return { domain, fenceIds: fences.map((f) => f.id) };
}

/** Passes spent this local month, from `pass_used` events. Counted, never scored. */
export function passesUsedThisMonth(
  events: readonly { readonly kind: string; readonly ts: number }[],
  now: number
): number {
  const since = startOfLocalMonth(now);
  return events.filter((e) => e.kind === PASS_USED_KIND && e.ts >= since && e.ts <= now).length;
}

/** `pass_used`: the domain, the one line of why, and when it closes. Nothing else. */
export function passUsedPayload(domain: string, reason: string, until: number) {
  return { domain, reason, until };
}

/** `opening_active`: hosts, when it closes, and the declared why. */
export function openingActivePayload(opening: Opening) {
  return { hosts: [...opening.hosts], until: opening.until, reason: opening.reason };
}

/** A pass request from the block page, validated. The page is untrusted. */
export function readPassRequest(msg: unknown): { host: string; reason: string } | null {
  if (!isRecord(msg) || msg.type !== "zenborg-use-pass") return null;
  const host = typeof msg.host === "string" ? normalizeDomain(msg.host) : null;
  const reason =
    typeof msg.reason === "string" ? msg.reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON) : "";
  return host === null || reason === "" ? null : { host, reason };
}

/** The pass button's words, exactly as the pitch has them. */
export function passLabel(left: number, perMonth: number, month: string): string {
  return `Use a pass, ${left} of ${perMonth} left in ${month}`;
}

/**
 * Where the block page goes once the host is open: the URL that was blocked,
 * if it is an ordinary page on that host, else the host's front page. Never a
 * `javascript:` URL or another site.
 */
export function returnTarget(url: string | null, host: string): string {
  try {
    const parsed = new URL(url ?? "");
    const h = normalizeDomain(parsed.hostname);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && h !== null && covers(host, h)) {
      return parsed.toString();
    }
  } catch {
    // fall through to the front page
  }
  return `https://${host}/`;
}

/** The block page asking what holds on `host`. */
export function readBlockInfoRequest(msg: unknown): string | null {
  if (!isRecord(msg) || msg.type !== "zenborg-block-info") return null;
  return typeof msg.host === "string" ? normalizeDomain(msg.host) : null;
}
