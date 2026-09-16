/**
 * Activity events — pure functions for the browser surface writer.
 *
 * Everything here is side-effect free: event building, domain stripping,
 * navigation dedupe, focus transitions, prune decisions, JSONL rendering.
 * The chrome.* wiring lives in `writer.ts`; IndexedDB persistence in `log.ts`.
 *
 * Privacy posture (load-bearing, from the observability roadmap):
 * payloads carry DOMAINS only — never full URLs, never page titles.
 */

import { createActivityEvent, createDomain, normalizeRoute } from "../domain";
import type { ActivityEvent } from "../domain";

/** Retention ceiling — on startup the writer prunes oldest events beyond this. */
export const MAX_LOG_EVENTS = 200_000;

/** chrome.idle detection interval, in seconds. */
export const IDLE_DETECTION_SECONDS = 120;

// ── Domain stripping ──────────────────────────────────────────────

/**
 * Extract a bare domain from a URL string.
 *
 * Returns `null` for anything that is not an ordinary web page: invalid
 * URLs, chrome:// / about: / file: / chrome-extension:// and every other
 * non-http(s) scheme. The result is lowercase with a leading "www." dropped
 * (the shared `Domain` value-object convention) and never contains a path,
 * query, fragment, port, or credentials.
 */
export function domainFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.hostname === "") {
    return null;
  }
  return createDomain(parsed.hostname);
}

// ── Route helpers ─────────────────────────────────────────────────

/** Extract { domain, route } from a url. route is null off-registry or non-web. */
export function routeFor(url: string): { domain: string | null; route: string | null } {
  const domain = domainFromUrl(url);
  if (domain === null) {
    return { domain: null, route: null };
  }
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { domain, route: null };
  }
  return { domain, route: normalizeRoute(domain, pathname) };
}

/** Log a route only for observe-tier domains with logDetail on. */
export function shouldLogRoute(
  domain: string | null,
  observe: readonly string[],
  logDetail: boolean
): domain is string {
  return logDetail && domain !== null && observe.includes(domain);
}

/** A route_changed event fires only when the route value actually changes
 * to a non-null route. */
export function routeChanged(
  previousRoute: string | null,
  nextRoute: string | null
): nextRoute is string {
  return nextRoute !== null && nextRoute !== previousRoute;
}

// ── Event building ────────────────────────────────────────────────

export interface BrowserEventInput {
  readonly id: string;
  readonly kind: string;
  readonly ts: number;
  readonly sessionId: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly durationMs?: number;
}

/** Build an ActivityEvent pinned to the "browser" surface. */
export function buildBrowserEvent(input: BrowserEventInput): ActivityEvent {
  return createActivityEvent({ ...input, surface: "browser" });
}

// ── Dedupe / transition decisions ─────────────────────────────────

/**
 * Log a navigation only when the DOMAIN changes — never per-SPA-path.
 * `null` next-domain (non-web page) is never logged.
 */
export function shouldLogNavigation(
  previousDomain: string | null,
  nextDomain: string | null
): nextDomain is string {
  return nextDomain !== null && nextDomain !== previousDomain;
}

/**
 * A `tab_closed` event fires only when the removed tab had a known (web)
 * domain we were tracking. Tabs we never saw a domain for (chrome://, new
 * tab page, non-web) are skipped — closing them carries no attention signal.
 * Unlike `focus_end`, this also captures the dismissal of a BACKGROUND tab
 * (e.g. a video left playing in another tab, then closed) that no focus
 * transition would bracket.
 */
export function shouldLogTabClose(domain: string | null): domain is string {
  return domain !== null;
}

/**
 * Shape the `tab_opened` payload — the open bracket of a tab's lifecycle.
 *
 * Unlike `tab_closed`, this always logs (the `tab` uuid alone makes tab
 * concurrency computable, e.g. "how many video tabs open at once"). A
 * freshly-created tab usually has no web URL yet (chrome://newtab, or a
 * pending navigation), so `domain` is included only when one is already
 * known — the tab id is the load-bearing field.
 */
export function tabOpenPayload(
  tab: string,
  domain: string | null
): Readonly<Record<string, unknown>> {
  return domain === null ? { tab } : { domain, tab };
}

/**
 * Outcome of feeding one observation into a span (start/end + durationMs
 * pattern — see docs/event-taxonomy.md).
 *
 * `kind` is the event to emit (null = nothing to log); `durationMs` is set
 * only on an end event whose start was observed; `spanStart` is the state
 * the caller carries to the next observation.
 */
export interface SpanTransition {
  readonly kind: string | null;
  readonly durationMs?: number;
  readonly spanStart: number | null;
}

/**
 * Focus span — the browser holds OS focus (`focus_start`/`focus_end`).
 * Window-to-window hops inside the browser dedupe; the span stays open.
 */
export function focusTransition(
  spanStart: number | null,
  isFocused: boolean,
  now: number
): SpanTransition {
  if (isFocused) {
    return spanStart === null
      ? { kind: "focus_start", spanStart: now }
      : { kind: null, spanStart };
  }
  return spanStart === null
    ? { kind: null, spanStart: null }
    : { kind: "focus_end", durationMs: now - spanStart, spanStart: null };
}

/**
 * Idle span — AFK bracketing over chrome.idle states
 * ("active" | "idle" | "locked"; locked counts as idle).
 *
 * "active" with no open span means the service worker restarted mid-idle:
 * the boundary is real, so `idle_end` is emitted without a duration.
 */
export function idleTransition(
  spanStart: number | null,
  state: string,
  now: number
): SpanTransition {
  if (state !== "active") {
    return spanStart === null
      ? { kind: "idle_start", spanStart: now }
      : { kind: null, spanStart };
  }
  return spanStart === null
    ? { kind: "idle_end", spanStart: null }
    : { kind: "idle_end", durationMs: now - spanStart, spanStart: null };
}

// ── Audible span (tab producing audio while backgrounded) ────

/**
 * Audible span — a tab starts or stops producing audio.
 *
 * Same start/end + durationMs pattern as focus and idle spans.
 * The browser fires `chrome.tabs.onUpdated` with `changeInfo.audible`
 * when a tab starts or stops producing audio — no extra permission
 * beyond `tabs` (already granted).
 */
export function audibleTransition(
  spanStart: number | null,
  isAudible: boolean,
  now: number
): SpanTransition {
  if (isAudible) {
    return spanStart === null
      ? { kind: "audible_start", spanStart: now }
      : { kind: null, spanStart };
  }
  return spanStart === null
    ? { kind: null, spanStart: null }
    : { kind: "audible_end", durationMs: now - spanStart, spanStart: null };
}

// ── Retention ─────────────────────────────────────────────────────

/** How many oldest events to delete so the store fits under `max`. */
export function excessEventCount(
  total: number,
  max: number = MAX_LOG_EVENTS
): number {
  return total > max ? total - max : 0;
}

// ── Popup mirror (today's deep-sensor completions) ────────────────

/** What zenborg noticed: the key-action completions the watchlist sensors
 * emit, tallied for the popup's calm mirror (awareness, not a score). */
export interface CompletionTally {
  readonly videos: number;
  readonly games: number;
  readonly posts: number;
}

/** Tally deep-sensor completions at or after `sinceTs`. Pure — the caller
 * supplies the cutoff (e.g. local midnight via `startOfLocalDay`) so this
 * stays deterministic and unit-testable. `video_started` counts a video
 * begun (one per video after the sense fix); coarse events are ignored. */
export function tallyCompletionsSince(
  events: readonly Pick<ActivityEvent, "kind" | "ts">[],
  sinceTs: number
): CompletionTally {
  let videos = 0;
  let games = 0;
  let posts = 0;
  for (const event of events) {
    if (event.ts < sinceTs) {
      continue;
    }
    if (event.kind === "video_started") {
      videos += 1;
    } else if (event.kind === "game_finished") {
      games += 1;
    } else if (event.kind === "post_seen") {
      posts += 1;
    }
  }
  return { videos, games, posts };
}

/** Local midnight for a timestamp — the popup's "today" cutoff. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Export (JSONL) ────────────────────────────────────────────────

/** Render events as JSONL — one JSON object per line, trailing newline. */
export function toJsonl(events: readonly ActivityEvent[]): string {
  let out = "";
  for (const event of events) {
    out += JSON.stringify(event) + "\n";
  }
  return out;
}

/** `YYYY-MM-DD-browser-export.jsonl` for the given timestamp (local time). */
export function exportFileName(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-browser-export.jsonl`;
}
