/**
 * Per-domain sensors — pure validation for the observe tier.
 *
 * Sensors are content scripts that detect KEY-ACTION COMPLETIONS
 * (taxonomy: completion grammar — docs/event-taxonomy.md)
 * and message them to the background writer. The hostile-page boundary
 * holds because the background trusts nothing from the page:
 *   - kind must be on the allowlist below,
 *   - payload is reduced to capped scalars,
 *   - the domain comes from `sender.tab.url` (browser-attested), never
 *     from the message,
 *   - nothing is written unless the domain is on the watchlist's
 *     observe tier (`sensorAllowed`).
 */

import { domainFromUrl } from "../activity/events";

/** The key-action completions sensors may report. Open set per the
 * taxonomy, but each addition lands here deliberately. */
export const SENSOR_KINDS = [
  "video_started",
  "video_ended",
  "video_paused",
  "video_resumed",
  "post_seen",
  "game_finished",
  "product_seen",
] as const;

export type SensorKind = (typeof SENSOR_KINDS)[number];

/** Wire shape sent by sensor content scripts. */
export interface SensorMessage {
  readonly type: "kairos-sensor";
  readonly kind: SensorKind;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** A sensor event past validation: what the writer may record. */
export interface ValidatedSensorEvent {
  readonly kind: SensorKind;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

const MAX_PAYLOAD_KEYS = 8;
const MAX_STRING_LENGTH = 64;

/**
 * Validate an untrusted runtime message into a writable sensor event.
 * Returns null for anything that is not a well-formed sensor message;
 * payload values are reduced to capped scalars (strings ≤64 chars,
 * finite numbers, booleans) and at most 8 keys.
 */
export function validateSensorMessage(msg: unknown): ValidatedSensorEvent | null {
  if (typeof msg !== "object" || msg === null) {
    return null;
  }
  const m = msg as Record<string, unknown>;
  if (m.type !== "kairos-sensor") {
    return null;
  }
  if (!(SENSOR_KINDS as readonly unknown[]).includes(m.kind)) {
    return null;
  }
  const payload: Record<string, string | number | boolean> = {};
  if (typeof m.payload === "object" && m.payload !== null) {
    for (const [key, value] of Object.entries(m.payload)) {
      if (Object.keys(payload).length >= MAX_PAYLOAD_KEYS) {
        break;
      }
      if (typeof value === "string") {
        payload[key] = value.slice(0, MAX_STRING_LENGTH);
      } else if (typeof value === "number" && Number.isFinite(value)) {
        payload[key] = value;
      } else if (typeof value === "boolean") {
        payload[key] = value;
      }
    }
  }
  return { kind: m.kind as SensorKind, payload };
}

/** The arm handshake: a freshly-injected sensor content script asks the
 * background whether its domain is on the observe tier before wiring
 * any DOM observation at all. */
export function isArmQuery(msg: unknown): boolean {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).type === "kairos-sensor-arm"
  );
}

/** The gate poll: a content script on a gated domain asking whether the
 * stopping cue is due. Answered from the background's own dwell reading. */
export function isGateQuery(msg: unknown): boolean {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).type === "kairos-gate-check"
  );
}

/** A click gate asking for its verdict. Returns the rule id the page names, or
 * null for anything else. The id is only a claim: the background answers only
 * for a click gate actually in force on the sender's attested domain. */
export function clickGateQuery(msg: unknown): string | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== "kairos-gate-click") return null;
  return typeof m.ruleId === "string" && m.ruleId !== "" && m.ruleId.length <= 128 ? m.ruleId : null;
}

/** A video-start gate asking for its verdict; same trust story as `clickGateQuery`. */
export function videoStartGateQuery(msg: unknown): string | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== "kairos-gate-video-start") return null;
  return typeof m.ruleId === "string" && m.ruleId !== "" && m.ruleId.length <= 128 ? m.ruleId : null;
}

/**
 * Reduce a media time (seconds — possibly NaN before metadata loads, or
 * negative/Infinity on a detached element) to a finite, non-negative
 * integer. The hostile-page boundary drops non-finite numbers, so a raw
 * `video.duration`/`currentTime` read could silently vanish from the
 * payload; this guarantees a present, sane value.
 */
export function finiteSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Completion heuristic for the video grammar: playback has reached a
 * threshold fraction of its duration. The native `ended` event is
 * unreliable on platform players (YouTube swaps the <video> for
 * autoplay-next; Shorts loop by resetting currentTime), so ≥90% watched
 * is the industry-standard proxy for "the user finished this video".
 * A non-positive / non-finite duration is never complete.
 */
export function videoCompleted(
  currentTime: number,
  duration: number,
  threshold = 0.9
): boolean {
  if (!Number.isFinite(duration) || duration <= 0) {
    return false;
  }
  return currentTime / duration >= threshold;
}

/**
 * Generic feed heuristic: the industry-standard disclosure labels that
 * mark a sponsored item, as the FULL text of a small element. Type-level
 * knowledge (how feeds disclose ads), not company-level.
 */
export function isSponsoredLabel(text: string): boolean {
  const t = text.trim();
  return t === "Promoted" || t === "Sponsored";
}

/**
 * The domain a sensor message is credited to: the TAB's, from the
 * browser-attested `sender.tab.url`. A player in an iframe reports through
 * its own frame (`sender.url` is the iframe host), but the attention belongs
 * to the site the gardener opened, so the frame's own URL is never read.
 */
export function senderDomain(sender: { readonly tab?: { readonly url?: string } }): string | null {
  const url = sender.tab?.url;
  return url === undefined ? null : domainFromUrl(url);
}

/** The probe a video close sends to every frame of its tab. */
export const PLAYBACK_PROBE = { type: "kairos-sensor-playing" } as const;

export function isPlaybackProbe(msg: unknown): boolean {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).type === PLAYBACK_PROBE.type
  );
}

/** A hung frame must not hold a close: on timeout or error, answer null (plain close). */
export function probeWithTimeout(probe: Promise<unknown>, ms = 200): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([probe.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

export function isVideoClose(kind: SensorKind): boolean {
  return kind === "video_paused" || kind === "video_ended";
}

/**
 * What a sensor event writes, given a frame's answer to `PLAYBACK_PROBE`.
 *
 * Every frame's start is written and the read side's tab key dedupes it
 * (`playingSpans` ignores a second open), but the first close on that key ends
 * the span, whichever frame it came from. So a close with another player still
 * going hands the span over: it closes, and the frame that answered reopens at
 * its own position. Dropping the close instead would pair a later close with an
 * opener from another frame, and a position only means something inside one
 * frame: a 30-second ad closing a film's span would cap the film at 30 seconds.
 * For the same reason the close gives up its `seconds` here.
 *
 * No answer means nothing else plays, including when a frame has died.
 */
export function closeWrites(
  event: ValidatedSensorEvent,
  stillPlaying: ValidatedSensorEvent | null
): readonly ValidatedSensorEvent[] {
  if (!isVideoClose(event.kind) || stillPlaying?.kind !== "video_resumed") {
    return [event];
  }
  const { seconds: _otherFrames, ...payload } = event.payload;
  return [{ kind: event.kind, payload }, stillPlaying];
}

/**
 * The observe-tier gate: sensor events are written only for watchlist
 * domains (exact match or subdomain). `domain` is derived by the
 * background from the sender tab's URL — null means a non-web sender.
 */
export function sensorAllowed(
  domain: string | null,
  observe: readonly string[]
): boolean {
  if (domain === null) {
    return false;
  }
  return observe.some(
    (entry) => domain === entry || domain.endsWith("." + entry)
  );
}

/**
 * The observe tier, in two widths. `deep` is every fence and browser-map host,
 * and arms every sense. `video` adds the hosts the vault maps to an area, which
 * arm the video sense alone: an area mapping says whose attention a host is,
 * not that its feed or shopping pages may be read.
 */
export interface ObserveTiers {
  readonly deep: readonly string[];
  readonly video: readonly string[];
}

/** The observe-tier gate per sense: a video event may ride the wider tier. */
export function sensorPermitted(
  kind: SensorKind,
  domain: string | null,
  tiers: ObserveTiers
): boolean {
  return sensorAllowed(domain, kind.startsWith("video_") ? tiers.video : tiers.deep);
}

/**
 * Debounce window before a paused video "settles" into a video_paused.
 * A raw <video> `pause` is ambiguous (ad breaks, scrubbing, autoplay
 * transitions, tab backgrounding), so a pause only counts once playback
 * stays paused this long — short enough to feel immediate, long enough to
 * drop scrubs and ad swaps.
 */
export const PAUSE_SETTLE_MS = 2500;

export type PlaybackPhase = "playing" | "pending_pause" | "settled_paused";

/** Pure playback state for the pause/resume grammar. `pauseTs` is the
 * moment the current pending pause began (null while playing). */
export interface PlaybackState {
  readonly phase: PlaybackPhase;
  readonly pauseTs: number | null;
}

export const INITIAL_PLAYBACK: PlaybackState = { phase: "playing", pauseTs: null };

export type PlaybackInput =
  | { readonly type: "play"; readonly t: number }
  | { readonly type: "pause"; readonly t: number }
  | { readonly type: "tick"; readonly t: number };

export interface PlaybackResult {
  readonly state: PlaybackState;
  readonly emit: "video_paused" | "video_resumed" | null;
}

/**
 * Timer-free state machine for debounced pause/resume. The DOM wiring feeds
 * it `pause`/`play` events plus a `tick` scheduled at pauseTs + settleMs:
 *   - a pause from playing arms a pending pause (no emit yet),
 *   - a play before the tick is a transient (scrub/ad) — back to playing,
 *   - a tick at/after the settle window emits `video_paused`,
 *   - a play after a settled pause emits `video_resumed`.
 * Pure so the debounce/pairing is unit-testable without real timers.
 */
export function playbackTransition(
  state: PlaybackState,
  input: PlaybackInput,
  settleMs: number = PAUSE_SETTLE_MS
): PlaybackResult {
  switch (state.phase) {
    case "playing":
      if (input.type === "pause") {
        return { state: { phase: "pending_pause", pauseTs: input.t }, emit: null };
      }
      return { state, emit: null };
    case "pending_pause":
      if (input.type === "play") {
        return { state: INITIAL_PLAYBACK, emit: null };
      }
      if (
        input.type === "tick" &&
        state.pauseTs !== null &&
        input.t - state.pauseTs >= settleMs
      ) {
        return { state: { phase: "settled_paused", pauseTs: state.pauseTs }, emit: "video_paused" };
      }
      return { state, emit: null };
    case "settled_paused":
      if (input.type === "play") {
        return { state: INITIAL_PLAYBACK, emit: "video_resumed" };
      }
      return { state, emit: null };
  }
  return { state, emit: null };
}
