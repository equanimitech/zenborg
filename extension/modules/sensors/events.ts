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

const MAX_PAYLOAD_KEYS = 8;
const MAX_STRING_LENGTH = 64;

/**
 * Validate an untrusted runtime message into a writable sensor event.
 * Returns null for anything that is not a well-formed sensor message;
 * payload values are reduced to capped scalars (strings ≤64 chars,
 * finite numbers, booleans) and at most 8 keys.
 */
export function validateSensorMessage(
  msg: unknown
): { kind: SensorKind; payload: Record<string, string | number | boolean> } | null {
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

/** Per tab: the frame that holds playback, and the frames refused while it did. */
export interface TabPlayback {
  readonly holder?: number;
  readonly refused: readonly number[];
}

/** Playback holders, keyed by tab id. */
export type PlaybackOwners = Readonly<Record<string, TabPlayback>>;

const OPENS = new Set<SensorKind>(["video_started", "video_resumed"]);

/**
 * One frame per tab speaks for playback, so a page with players in several
 * frames reads as one player, not two. The first frame to start or resume
 * holds the tab; a start from any other frame is refused, and that frame's
 * pauses and ends are dropped too, or the log would close a span it never
 * opened. When the holder pauses or ends, the next frame to start takes over.
 * With no state at all everything passes, which is how the sensor behaved
 * before it ran in subframes. Non-video kinds always pass.
 *
 * ponytail: first-come holds. A muted autoplay ad in its own iframe that
 * starts first holds the tab until it pauses, and the main player's minutes
 * in the meantime are not written. Prefer the audible frame if that shows up.
 */
export function claimPlayback(
  owners: PlaybackOwners,
  tabId: number,
  frameId: number,
  kind: SensorKind
): { owners: PlaybackOwners; write: boolean } {
  if (!kind.startsWith("video_")) {
    return { owners, write: true };
  }
  const key = String(tabId);
  const tab = owners[key] ?? { refused: [] };
  const set = (next: TabPlayback): PlaybackOwners => ({ ...owners, [key]: next });
  const refused = tab.refused.filter((f) => f !== frameId);

  if (OPENS.has(kind)) {
    if (tab.holder === undefined || tab.holder === frameId) {
      return { owners: set({ holder: frameId, refused }), write: true };
    }
    return { owners: set({ ...tab, refused: [...refused, frameId] }), write: false };
  }
  if (tab.holder === frameId) {
    return { owners: set({ refused: tab.refused }), write: true };
  }
  if (tab.holder !== undefined || tab.refused.includes(frameId)) {
    return { owners, write: false };
  }
  return { owners, write: true };
}

/** Forget a tab's playback state (tab closed or navigated). */
export function releasePlayback(owners: PlaybackOwners, tabId: number): PlaybackOwners {
  const key = String(tabId);
  if (owners[key] === undefined) {
    return owners;
  }
  const { [key]: _released, ...rest } = owners;
  return rest;
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
