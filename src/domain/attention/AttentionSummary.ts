/**
 * Where attention went — dwell rows, area roll-ups, agent sessions, coverage.
 *
 * Pure functions over ActivityEvent[]. The recap skill's awk one-liners,
 * made testable. No persistence — these views are computed on request.
 */
import {
  type ActivityEvent,
  type ActivitySurface,
  isHumanActor,
} from "./ActivityEvent.ts";
import type { AreaId, Duration, Instant } from "./ids.ts";
import type { AreaResolver } from "./SpanDerivation.ts";

export interface DwellRow {
  readonly surface: ActivitySurface;
  readonly locator: string;
  readonly areaId?: AreaId;
  readonly ms: Duration;
  readonly visits: number;
}

export interface DwellConfig {
  readonly capMs: Duration;
}

type LocatorOf = (event: ActivityEvent) => string | undefined;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const locatorOf: Readonly<Record<ActivitySurface, LocatorOf>> = {
  desktop: (e) =>
    e.kind === "app_switched" ? str(e.payload.app_name) : undefined,
  agent: (e) => (e.kind === "prompt" ? str(e.payload.cwd) : undefined),
  browser: (e) =>
    e.kind === "tab_activated" ? str(e.payload.domain) : undefined,
  garmin: () => undefined,
};

/**
 * Events that end an attention span on the browser surface. A tab_activated
 * opens a span; only these kinds close it. Without this filter, near-
 * simultaneous non-boundary events (focus_start, navigation_committed) truncate
 * the span to near-zero.
 */
const BROWSER_BOUNDARY_KINDS = new Set([
  "tab_activated",
  "focus_end",
  "idle_start",
]);

export function dwellRows(
  events: readonly ActivityEvent[],
  surface: ActivitySurface,
  resolve: AreaResolver,
  config: DwellConfig,
): readonly DwellRow[] {
  const getLocator = locatorOf[surface];
  // Dedup by id: the relay can deliver a batch twice (same rule as bouts.ts).
  const seen = new Set<string>();
  const surfaceEvents = events
    .filter((e) => e.surface === surface && isHumanActor(e))
    .filter((e) => !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.ts - b.ts);

  const acc = new Map<
    string,
    { spans: Interval[]; visits: number; areaId?: AreaId }
  >();
  const entryFor = (loc: string, event: ActivityEvent) => {
    const existing = acc.get(loc);
    if (existing) return existing;
    const created = { spans: [] as Interval[], visits: 0, areaId: resolve(event) };
    acc.set(loc, created);
    return created;
  };

  for (let i = 0; i < surfaceEvents.length; i++) {
    const event = surfaceEvents[i];
    const loc = getLocator(event);
    if (loc === undefined) continue;

    const boundary = findBoundary(surfaceEvents, i, surface);
    const dwell = boundary !== undefined
      ? Math.min(boundary - event.ts, config.capMs)
      : 0;

    const entry = entryFor(loc, event);
    entry.spans.push([event.ts, event.ts + dwell]);
    entry.visits += 1;
  }

  // A playing video is attention on its domain whether or not the window has
  // focus. Union with the focus spans, so a focused tab that is also playing
  // counts once.
  if (surface === "browser") {
    for (const { domain, event, span } of playingSpans(surfaceEvents, config.capMs)) {
      entryFor(domain, event).spans.push(span);
    }
  }

  return [...acc.entries()]
    .map(([locator, { spans, visits, areaId }]) => ({
      surface,
      locator,
      ...(areaId !== undefined ? { areaId } : {}),
      ms: unionMs(spans),
      visits,
    }))
    .sort((a, b) => b.ms - a.ms);
}

type Interval = readonly [start: Instant, end: Instant];

/** Total length of a set of possibly-overlapping intervals. */
function unionMs(spans: readonly Interval[]): Duration {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reach = Number.NEGATIVE_INFINITY;
  for (const [start, end] of sorted) {
    const from = Math.max(start, reach);
    if (end > from) total += end - from;
    reach = Math.max(reach, end);
  }
  return total;
}

const PLAY_OPEN = new Set(["video_started", "video_resumed"]);
const PLAY_CLOSE = new Set(["video_paused", "video_ended", "tab_closed"]);

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Intervals during which a video was playing, per domain.
 *
 * Opens on video_started/video_resumed, closes on video_paused/video_ended
 * (or tab_closed when the video events carry a tab), keyed by tab when known,
 * else by domain. Bounds, because a sensor can drop or conflate events:
 *   - playback position: a close reporting `seconds` caps the span at the
 *     position advanced since the open, so an unsettled pause is not counted;
 *   - a video_paused with no open span on its key (two tabs on one domain,
 *     before events carried a tab) still proves playback: it credits its
 *     reported position, reaching back no further than the key's last close.
 *     An orphan video_ended does not — it also fires on detach, long after;
 *   - screen lock (idle_start state=locked) closes everything. Plain idle
 *     does not: watching produces no input, which is the whole point;
 *   - a span never closed ends at the next idle_start, else the last event;
 *   - every span is capped at `capMs`.
 */
function playingSpans(
  events: readonly ActivityEvent[],
  capMs: Duration,
): readonly { domain: string; event: ActivityEvent; span: Interval }[] {
  const out: { domain: string; event: ActivityEvent; span: Interval }[] = [];
  const open = new Map<string, ActivityEvent>();
  const lastClose = new Map<string, Instant>();
  const push = (event: ActivityEvent, start: Instant, end: Instant) =>
    out.push({
      domain: str(event.payload.domain) ?? "",
      event,
      span: [start, Math.min(end, start + capMs)],
    });

  const close = (key: string, opener: ActivityEvent, closer?: ActivityEvent, at = closer?.ts ?? 0) => {
    open.delete(key);
    lastClose.set(key, at);
    const from = num(opener.payload.seconds);
    const to = num(closer?.payload.seconds);
    const played = from !== undefined && to !== undefined && to > 0 && to >= from
      ? (to - from) * 1000
      : Number.POSITIVE_INFINITY;
    push(opener, opener.ts, Math.min(at, opener.ts + played));
  };

  for (const e of events) {
    if (e.kind === "idle_start" && e.payload.state === "locked") {
      for (const [key, opener] of open) close(key, opener, undefined, e.ts);
      continue;
    }
    const domain = str(e.payload.domain);
    if (domain === undefined) continue;
    const key = str(e.payload.tab) ?? domain;
    const opener = open.get(key);
    if (PLAY_OPEN.has(e.kind)) {
      if (opener === undefined) open.set(key, e);
    } else if (PLAY_CLOSE.has(e.kind)) {
      if (opener !== undefined) {
        close(key, opener, e);
        continue;
      }
      const seconds = num(e.payload.seconds);
      if (e.kind === "video_paused" && seconds !== undefined && seconds > 0) {
        push(e, Math.max(e.ts - seconds * 1000, lastClose.get(key) ?? 0), e.ts);
      }
      lastClose.set(key, e.ts);
    }
  }

  // ponytail: an unclosed span is a guess; idle is the best "gone" proxy we have.
  const last = events.at(-1)?.ts ?? 0;
  for (const [key, opener] of open) {
    const idle = events.find((e) => e.kind === "idle_start" && e.ts > opener.ts);
    close(key, opener, undefined, idle?.ts ?? last);
  }
  return out;
}

/**
 * Find the next dwell boundary after surfaceEvents[fromIndex].
 *
 * For desktop/agent, any subsequent event works (the old behaviour).
 * For browser, only boundary kinds count — focus_start, navigation_committed,
 * etc. happen simultaneously with tab_activated and would truncate real dwell
 * to near-zero.
 */
function findBoundary(
  surfaceEvents: readonly ActivityEvent[],
  fromIndex: number,
  surface: ActivitySurface,
): number | undefined {
  if (surface !== "browser") {
    const next = surfaceEvents[fromIndex + 1];
    return next?.ts;
  }
  for (let j = fromIndex + 1; j < surfaceEvents.length; j++) {
    if (BROWSER_BOUNDARY_KINDS.has(surfaceEvents[j].kind)) {
      return surfaceEvents[j].ts;
    }
  }
  return undefined;
}

export interface AreaAttention {
  readonly areaId: AreaId;
  readonly ms: Duration;
  readonly visits: number;
}

export function byArea(rows: readonly DwellRow[]): readonly AreaAttention[] {
  const acc = new Map<AreaId, { ms: number; visits: number }>();
  for (const row of rows) {
    if (row.areaId === undefined) continue;
    const entry = acc.get(row.areaId);
    if (entry) {
      entry.ms += row.ms;
      entry.visits += row.visits;
    } else {
      acc.set(row.areaId, { ms: row.ms, visits: row.visits });
    }
  }
  return [...acc.entries()]
    .map(([areaId, { ms, visits }]) => ({ areaId, ms, visits }))
    .sort((a, b) => b.ms - a.ms);
}

export interface AgentSession {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly start: Instant;
  readonly end: Instant;
  readonly prompts: number;
}

export function agentSessions(
  events: readonly ActivityEvent[],
): readonly AgentSession[] {
  const sessions = new Map<
    string,
    { cwd?: string; start: number; end: number; prompts: number }
  >();

  for (const e of events) {
    if (e.surface !== "agent") continue;
    const sid = e.sessionId;
    if (!sid) continue;

    const entry = sessions.get(sid);
    const cwd = str(e.payload.cwd);
    if (entry) {
      entry.start = Math.min(entry.start, e.ts);
      entry.end = Math.max(entry.end, e.ts);
      if (e.kind === "prompt") entry.prompts += 1;
      if (cwd && !entry.cwd) entry.cwd = cwd;
    } else {
      sessions.set(sid, {
        cwd,
        start: e.ts,
        end: e.ts,
        prompts: e.kind === "prompt" ? 1 : 0,
      });
    }
  }

  return [...sessions.entries()]
    .map(([sessionId, s]) => ({
      sessionId,
      ...(s.cwd ? { cwd: s.cwd } : {}),
      start: s.start,
      end: s.end,
      prompts: s.prompts,
    }))
    .sort((a, b) => a.start - b.start);
}

export interface Coverage {
  readonly surface: ActivitySurface;
  readonly first?: Instant;
  readonly last?: Instant;
  readonly events: number;
}

export function coverage(
  events: readonly ActivityEvent[],
  surfaces: readonly ActivitySurface[] = ["desktop", "agent", "browser"],
): readonly Coverage[] {
  return surfaces.map((surface) => {
    const surfaceEvents = events.filter((e) => e.surface === surface);
    if (surfaceEvents.length === 0) return { surface, events: 0 };
    const sorted = surfaceEvents.map((e) => e.ts).sort((a, b) => a - b);
    return {
      surface,
      first: sorted[0],
      last: sorted[sorted.length - 1],
      events: surfaceEvents.length,
    };
  });
}
