/**
 * Video sense — generic over any page that plays HTML5 video.
 * Type-level knowledge: <video> elements + SPA-safe re-wiring.
 * Emits video_started / video_ended (completion grammar) plus the debounced
 * video_paused / video_resumed pair (the pure state machine lives in ../events).
 */

import {
  INITIAL_PLAYBACK,
  PAUSE_SETTLE_MS,
  finiteSeconds,
  playbackTransition,
  videoCompleted,
  type PlaybackInput,
  type PlaybackState,
} from "../events";
import { sendSensorEvent } from "../send";

export function armVideoSense(): void {
  // LOAD-BEARING ASSUMPTION: platforms SWAP the <video> element per video
  // (YouTube does — each new video gets a fresh element → fresh wire()).
  // Dedupe is therefore keyed per element: one started + one ended each.
  // A platform that REUSES one element across videos would degrade to a
  // single started+ended for the whole session (once:true + the `ended`
  // WeakSet suppress every subsequent video). No clean hostile-page signal
  // for per-video identity exists, so this is the pragmatic boundary.
  const wired = new WeakSet<HTMLVideoElement>();
  const ended = new WeakSet<HTMLVideoElement>();

  // Elements that emitted `started` and have not yet emitted `ended`.
  //
  // A strong Set, unlike the two WeakSets above, and deliberately so: the
  // whole job here is to still be holding the element after the page has
  // dropped it, so its span can be closed. Entries leave on `ended`, on the
  // detach sweep, or when the page goes away — never accumulating.
  const open = new Set<HTMLVideoElement>();

  // Completion fires at most once per element — from whichever trigger
  // (the ≥90% heuristic, the native `ended`, detach, or page teardown)
  // reaches it first.
  const emitEnded = (video: HTMLVideoElement): void => {
    open.delete(video);
    if (ended.has(video)) {
      return;
    }
    ended.add(video);
    sendSensorEvent("video_ended", {
      seconds: finiteSeconds(video.currentTime),
    });
  };

  // Measured gap this closes: over 2026-06-12..08-07 the log carried 132
  // `video_started` against 52 `video_ended` — 61% of watch spans never
  // closed, making view time uncomputable. Neither trigger above fires when
  // the platform simply destroys the element (SPA route change, autoplay
  // swap) or when the tab goes away.

  // A detached element is a finished watch. The MutationObserver below is
  // already running for re-wiring, so this rides along on the same beat.
  const sweepDetached = (): void => {
    for (const video of [...open]) {
      if (!video.isConnected) {
        emitEnded(video);
      }
    }
  };

  const wire = (video: HTMLVideoElement): void => {
    if (wired.has(video)) {
      return;
    }
    wired.add(video);

    // One "started" per video element. `playing` (not `play`) fires after
    // buffering resolves, and `{ once: true }` collapses YouTube's
    // play/seek/ad-transition storm to a single emission per element.
    // `seconds` is the start position (≈0 fresh, >0 on resume), not the
    // total length — duration is often NaN at this moment.
    const started = (): void => {
      open.add(video);
      sendSensorEvent("video_started", {
        seconds: finiteSeconds(video.currentTime),
      });
    };
    // An embedded player usually autoplays before the arm handshake returns,
    // so its `playing` has already fired by the time it is wired. Without
    // this it would emit pauses and ends with no start.
    if (!video.paused && !video.ended) {
      started();
    } else {
      video.addEventListener("playing", started, { once: true });
    }

    // Completion grammar: platform players rarely let native `ended` fire
    // (autoplay swaps the element; Shorts loop by resetting currentTime),
    // so treat ≥90% watched as the completion. `ended` stays wired as a
    // supplementary trigger for ordinary HTML5 video; emitEnded dedupes.
    video.addEventListener("timeupdate", () => {
      if (videoCompleted(video.currentTime, video.duration)) {
        emitEnded(video);
      }
    });
    video.addEventListener("ended", () => {
      emitEnded(video);
    });

    // Pause/resume grammar. A raw `pause` fires on ad breaks, scrubbing, and
    // autoplay swaps, so the pure machine only "settles" into video_paused
    // after the element stays paused past PAUSE_SETTLE_MS; a `play` before
    // then is a transient. A play after a settled pause emits video_resumed.
    // The setTimeout is the only impurity — it feeds a `tick` to the machine.
    let playback: PlaybackState = INITIAL_PLAYBACK;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const feedPlayback = (input: PlaybackInput): void => {
      const result = playbackTransition(playback, input);
      playback = result.state;
      if (result.emit !== null) {
        sendSensorEvent(result.emit, { seconds: finiteSeconds(video.currentTime) });
      }
    };
    video.addEventListener("pause", () => {
      const t = Date.now();
      feedPlayback({ type: "pause", t });
      clearTimeout(settleTimer);
      settleTimer = setTimeout(
        () => feedPlayback({ type: "tick", t: t + PAUSE_SETTLE_MS }),
        PAUSE_SETTLE_MS
      );
    });
    video.addEventListener("play", () => {
      clearTimeout(settleTimer);
      feedPlayback({ type: "play", t: Date.now() });
    });
  };

  const wireAll = (): void => {
    for (const video of document.querySelectorAll("video")) {
      wire(video);
    }
  };

  wireAll();
  new MutationObserver(() => {
    sweepDetached();
    wireAll();
  }).observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Tab close and cross-document navigation produce no removal mutation, so
  // the sweep never sees them. `pagehide` is the last reliable beat — it
  // fires for bfcache entry too, which `unload` does not. Delivery is
  // best-effort at teardown; that is still strictly better than dropping the
  // span outright.
  addEventListener("pagehide", () => {
    for (const video of [...open]) {
      emitEnded(video);
    }
  });
}
