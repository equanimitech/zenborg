/**
 * Bouts — the read-side behavioral unit.
 *
 * The event taxonomy defines it: *"The behavioral unit is the read-side bout
 * (web-analytics 'visit'): derived by inactivity timeout over the merged log.
 * Writers never claim bouts."* This module is that derivation, and it is the
 * ONE place the dwell methodology lives.
 *
 * Canonized here so every retrospective uses the same math (the 2026-07-13
 * finding: ending a content retreat needed two ad-hoc Python scripts, and that
 * logic belongs in the extension rather than a session scratchpad):
 *
 *   1. global timeline    — all surfaces merged, sorted by ts
 *   2. focus/idle-gated   — time while the browser lacks OS focus, or while
 *                           chrome.idle reports idle, does not accumulate
 *   3. 30m segment cap    — a single gap contributes at most SEGMENT_CAP_MS,
 *                           so a tab left open overnight cannot invent dwell
 *   4. dedup by event id  — the relay can deliver a batch twice; ids are stable
 *
 * Pure. No I/O, no clock — callers pass events in and the domain classifier
 * separately.
 */

import type { ActivityEvent } from "./activity.js";
import { canonicalKind } from "./activity.js";
import { createDomain, createDuration, type Domain, type Duration } from "./value-objects.js";

/** A gap longer than this ends the bout (web-analytics visit timeout). */
export const BOUT_GAP_MS = 30 * 60 * 1000;

/** Maximum dwell attributable to one gap between events. */
export const SEGMENT_CAP_MS = 30 * 60 * 1000;

/** One continuous span of attention, possibly spanning several domains. */
export interface Bout {
  readonly startTs: number;
  readonly endTs: number;
  /** Focus/idle-gated, segment-capped attended time. */
  readonly dwellMs: Duration;
  /** Background-but-audible time (calls, media). Separate from dwellMs —
   * foreground dwell and audible dwell never overlap. */
  readonly audibleDwellMs: Duration;
  /**
   * Moves between domains that each held attention past `SWITCH_FLOOR_MS` —
   * the fragmentation signal. Glances below the floor cost nothing, so a
   * long read interrupted by a two-second tab peek still reads as unbroken.
   */
  readonly switches: number;
  /** Attended time per domain within the bout. */
  readonly byDomain: ReadonlyMap<Domain, Duration>;
  /** Domain holding the most attended time, or null if none accumulated. */
  readonly dominant: Domain | null;
  /** Longest unbroken single-domain stretch — the binge signal. */
  readonly longestRunMs: Duration;
}

/**
 * A continuous stretch of attention on ONE domain.
 *
 * The unit a person recognises as "a thing I did". A bout is a *visit* and can
 * span dozens of domains — one 62-minute bout on 6 Aug contained 161 switches —
 * so rendering a bout as a line item throws away most of what happened. A run
 * is what browser history would show if it grouped properly: fifty YouTube page
 * loads collapse into `02:06–02:51 · 45m`.
 *
 * Same gating as bouts: time while unfocused or idle does not accumulate, and a
 * single gap contributes at most `SEGMENT_CAP_MS`.
 */
export interface Run {
  readonly domain: Domain;
  readonly startTs: number;
  readonly endTs: number;
  /** Focus/idle-gated, segment-capped attended time. */
  readonly dwellMs: Duration;
  /** Background-but-audible time (calls, media). Separate from dwellMs. */
  readonly audibleDwellMs: Duration;
}

/**
 * A gap longer than this ends a run, even on the same domain — two sittings
 * rather than one.
 *
 * Matches `BOUT_GAP_MS` deliberately: a run is a bout narrowed to one domain,
 * so they should agree about where a sitting ends. It must also be generous,
 * because silence is the normal state of reading a page — no events fire while
 * you read, and a tight threshold would shred one long read into nothing.
 */
export const RUN_GAP_MS = BOUT_GAP_MS;

/**
 * The grouping threshold, doing two jobs at once.
 *
 * **Under this is not a thing you did, and does not break what you were doing.**
 *
 * As a floor it drops a tab touched in passing. As a detour tolerance it lets a
 * glance elsewhere be absorbed rather than shredding a session — without it a
 * chess sitting became ten entries because he checked another tab and came
 * back. One number for both keeps the rule explicable and makes overlapping
 * entries impossible: anything big enough to appear is big enough to interrupt.
 *
 * A merged entry spans its detours while its dwell counts only the domain, so
 * "13:29–14:11 · 34m" says both how long the sitting lasted and how much of it
 * was actually chess.
 */
export const MIN_RUN_MS = 2 * 60 * 1000;

/**
 * A domain must hold attention this long before moving off it counts as a
 * switch — the `MIN_RUN_MS` rule applied to fragmentation.
 *
 * Measured, not chosen: across 2026-06-12..08-07, **67% of browser domain
 * dwells were under 15s** (n=7985, median 5s) — launcher pops, notification
 * steals, alt-tab flicker. Counting those made `switches` two-thirds noise,
 * and every fragmentation number built on it wrong by the same margin.
 *
 * 15s is where the transient population ends: above it the median dwell is
 * 42s, against Gloria Mark's published ~47s average screen dwell. Two
 * independent instruments agreeing is the evidence for this boundary and not
 * some rounder number.
 *
 * Fragmentation therefore counts moves between domains that were each held
 * past the floor. A glance costs nothing: it is not a thing you did, and it
 * did not break what you were doing.
 */
export const SWITCH_FLOOR_MS = 15 * 1000;

/** Kinds that mark attention leaving, and returning. */
const ATTENTION_OFF = new Set(["focus_end", "idle_start"]);
const ATTENTION_ON = new Set(["focus_start", "idle_end"]);

/** Kinds that mark a tab starting or stopping audio. */
const AUDIBLE_ON = new Set(["audible_start"]);
const AUDIBLE_OFF = new Set(["audible_end"]);

/** Pull a domain off an event payload, if it carries one. */
function domainOf(event: ActivityEvent): Domain | null {
  const raw = event.payload["domain"];
  return typeof raw === "string" && raw.length > 0 ? createDomain(raw) : null;
}

/** Dedup by id, then sort by ts. Stable for equal timestamps. */
function normalize(events: readonly ActivityEvent[]): readonly ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of events) {
    if (!byId.has(event.id)) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/** Mutable accumulator; frozen into a Bout by `seal`. */
interface Draft {
  startTs: number;
  endTs: number;
  dwellMs: number;
  audibleDwellMs: number;
  switches: number;
  byDomain: Map<Domain, number>;
  runDomain: Domain | null;
  runMs: number;
  longestRunMs: number;
  /** Last domain that held attention past `SWITCH_FLOOR_MS`. */
  lastSubstantial: Domain | null;
  /** Domains currently audible (by domain, not tab — multiple tabs on the
   * same domain don't double-count). */
  audibleDomains: Set<Domain>;
}

function newDraft(ts: number): Draft {
  return {
    startTs: ts,
    endTs: ts,
    dwellMs: 0,
    audibleDwellMs: 0,
    switches: 0,
    byDomain: new Map(),
    runDomain: null,
    runMs: 0,
    longestRunMs: 0,
    lastSubstantial: null,
    audibleDomains: new Set(),
  };
}

function seal(draft: Draft): Bout {
  const longest = Math.max(draft.longestRunMs, draft.runMs);
  let dominant: Domain | null = null;
  let best = 0;
  for (const [domain, ms] of draft.byDomain) {
    if (ms > best) {
      best = ms;
      dominant = domain;
    }
  }
  const byDomain = new Map<Domain, Duration>();
  for (const [domain, ms] of draft.byDomain) {
    byDomain.set(domain, createDuration(ms));
  }
  return {
    startTs: draft.startTs,
    endTs: draft.endTs,
    dwellMs: createDuration(draft.dwellMs),
    audibleDwellMs: createDuration(draft.audibleDwellMs),
    switches: draft.switches,
    byDomain,
    dominant,
    longestRunMs: createDuration(longest),
  };
}

/**
 * Derive bouts from a merged event stream.
 *
 * Attribution is *backwards*: the gap between event N and N+1 is credited to
 * the domain in flight at N. That is what makes a single `navigation_committed`
 * followed by 30 minutes of silence count as 30 minutes on that domain rather
 * than zero — while the cap keeps an abandoned tab from counting as a night.
 */
export function bouts(events: readonly ActivityEvent[]): readonly Bout[] {
  const ordered = normalize(events);
  const out: Bout[] = [];
  let draft: Draft | null = null;
  let current: Domain | null = null;
  let attending = true;

  for (const event of ordered) {
    const kind = canonicalKind(event.kind);

    // Close the bout when the stream goes quiet for longer than the timeout.
    if (draft !== null && event.ts - draft.endTs > BOUT_GAP_MS) {
      out.push(seal(draft));
      draft = null;
      current = null;
    }

    // Credit the elapsed gap to whatever was in flight.
    // Foreground + attending → dwellMs. Background but audible → audibleDwellMs.
    if (draft !== null && current !== null) {
      const elapsed = Math.min(event.ts - draft.endTs, SEGMENT_CAP_MS);
      if (elapsed > 0) {
        if (attending) {
          draft.dwellMs += elapsed;
          draft.byDomain.set(current, (draft.byDomain.get(current) ?? 0) + elapsed);
          if (draft.runDomain === current) {
            draft.runMs += elapsed;
          }
          if (
            draft.runDomain !== null &&
            draft.runMs >= SWITCH_FLOOR_MS &&
            draft.runDomain !== draft.lastSubstantial
          ) {
            if (draft.lastSubstantial !== null) {
              draft.switches += 1;
            }
            draft.lastSubstantial = draft.runDomain;
          }
        } else if (draft.audibleDomains.has(current)) {
          draft.audibleDwellMs += elapsed;
        }
      }
    }

    if (ATTENTION_OFF.has(kind)) {
      attending = false;
    } else if (ATTENTION_ON.has(kind)) {
      attending = true;
    }

    // Track which domains are currently audible.
    if (AUDIBLE_ON.has(kind)) {
      const d = domainOf(event);
      if (d !== null && draft !== null) {
        draft.audibleDomains.add(d);
      }
    } else if (AUDIBLE_OFF.has(kind)) {
      const d = domainOf(event);
      if (d !== null && draft !== null) {
        draft.audibleDomains.delete(d);
      }
    }

    // Audible events carry a domain for identification but do not represent
    // a tab switch — they must not change `current` or `runDomain`.
    if (!AUDIBLE_ON.has(kind) && !AUDIBLE_OFF.has(kind)) {
      const domain = domainOf(event);
      if (domain !== null) {
        if (draft === null) {
          draft = newDraft(event.ts);
        }
        if (draft.runDomain !== domain) {
          draft.longestRunMs = Math.max(draft.longestRunMs, draft.runMs);
          draft.runDomain = domain;
          draft.runMs = 0;
        }
        current = domain;
      }
    }

    if (draft !== null) {
      draft.endTs = event.ts;
    }
  }

  if (draft !== null) {
    out.push(seal(draft));
  }
  return out;
}

/**
 * Derive runs — what you did, grouped the way you would describe it.
 *
 * Chronological, so a caller can render them as history without re-sorting.
 * Attribution matches `bouts`: a gap is credited to the domain in flight,
 * capped, and dropped while attention is off. The two derivations share that
 * walk deliberately, so a run's minutes and a bout's minutes can never disagree
 * about the same stretch of time.
 *
 * One threshold does two jobs, and that is the whole grouping rule:
 * **under `MIN_RUN_MS` is not a thing you did, and does not break what you were
 * doing.** A ten-second glance at another tab is neither an entry of its own nor
 * a reason to split a chess session into ten.
 */
export function runs(
  events: readonly ActivityEvent[],
  gapMs: number = RUN_GAP_MS,
  minRunMs: number = MIN_RUN_MS
): readonly Run[] {
  const ordered = normalize(events);
  const out: Run[] = [];
  let current: Domain | null = null;
  let startTs = 0;
  let endTs = 0;
  let dwellMs = 0;
  let audibleDwellMs = 0;
  let attending = true;
  const audibleDomains = new Set<Domain>();
  let prevTs = 0;
  let newSitting = false;

  const flush = (): void => {
    if (current === null || (dwellMs + audibleDwellMs) < minRunMs) {
      return;
    }
    const last = out[out.length - 1];
    const isDetour = last !== undefined && startTs - last.endTs < minRunMs;
    if (!newSitting && last !== undefined && last.domain === current && isDetour) {
      out[out.length - 1] = {
        domain: last.domain,
        startTs: last.startTs,
        endTs,
        dwellMs: createDuration(last.dwellMs + dwellMs),
        audibleDwellMs: createDuration(last.audibleDwellMs + audibleDwellMs),
      };
      return;
    }
    out.push({ domain: current, startTs, endTs, dwellMs: createDuration(dwellMs), audibleDwellMs: createDuration(audibleDwellMs) });
  };

  for (const event of ordered) {
    const kind = canonicalKind(event.kind);

    if (current !== null) {
      const idle = event.ts - prevTs;
      if (attending) {
        const elapsed = Math.min(idle, SEGMENT_CAP_MS);
        if (elapsed > 0) {
          dwellMs += elapsed;
          endTs = prevTs + elapsed;
        }
      } else if (audibleDomains.has(current)) {
        const elapsed = Math.min(idle, SEGMENT_CAP_MS);
        if (elapsed > 0) {
          audibleDwellMs += elapsed;
          endTs = prevTs + elapsed;
        }
      }
      if (idle > gapMs) {
        flush();
        current = null;
        dwellMs = 0;
        audibleDwellMs = 0;
        newSitting = true;
      }
    }

    if (ATTENTION_OFF.has(kind)) {
      attending = false;
    } else if (ATTENTION_ON.has(kind)) {
      attending = true;
    }

    if (AUDIBLE_ON.has(kind)) {
      const d = domainOf(event);
      if (d !== null) audibleDomains.add(d);
    } else if (AUDIBLE_OFF.has(kind)) {
      const d = domainOf(event);
      if (d !== null) audibleDomains.delete(d);
    }

    if (!AUDIBLE_ON.has(kind) && !AUDIBLE_OFF.has(kind)) {
      const domain = domainOf(event);
      if (domain !== null && domain !== current) {
        flush();
        if (current !== null) {
          newSitting = false;
        }
        current = domain;
        startTs = event.ts;
        endTs = event.ts;
        dwellMs = 0;
        audibleDwellMs = 0;
      }
    }
    prevTs = event.ts;
  }
  flush();
  return out;
}
