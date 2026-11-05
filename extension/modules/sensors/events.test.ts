import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAYBACK,
  PAUSE_SETTLE_MS,
  SENSOR_KINDS,
  clickGateQuery,
  finiteSeconds,
  isArmQuery,
  isSponsoredLabel,
  playbackTransition,
  sensorAllowed,
  validateSensorMessage,
  videoCompleted,
} from "./events";

describe("validateSensorMessage (hostile-page boundary)", () => {
  it("accepts a known sensor kind with no payload", () => {
    expect(
      validateSensorMessage({ type: "kairos-sensor", kind: "video_ended" })
    ).toEqual({ kind: "video_ended", payload: {} });
  });

  it("accepts scalar payload fields", () => {
    expect(
      validateSensorMessage({
        type: "kairos-sensor",
        kind: "game_finished",
        payload: { result: "loss", rated: true, moves: 42 },
      })
    ).toEqual({
      kind: "game_finished",
      payload: { result: "loss", rated: true, moves: 42 },
    });
  });

  it("rejects unknown kinds — the allowlist is the contract", () => {
    expect(
      validateSensorMessage({ type: "kairos-sensor", kind: "evil_kind" })
    ).toBeNull();
  });

  it("rejects messages without the kairos-sensor type tag", () => {
    expect(validateSensorMessage({ kind: "video_ended" })).toBeNull();
    expect(
      validateSensorMessage({ type: "other", kind: "video_ended" })
    ).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(validateSensorMessage(null)).toBeNull();
    expect(validateSensorMessage("video_ended")).toBeNull();
    expect(validateSensorMessage(42)).toBeNull();
  });

  it("drops non-scalar payload values (no nested structures cross the boundary)", () => {
    expect(
      validateSensorMessage({
        type: "kairos-sensor",
        kind: "post_seen",
        payload: { promoted: false, nested: { a: 1 }, list: [1, 2], nul: null },
      })
    ).toEqual({ kind: "post_seen", payload: { promoted: false } });
  });

  it("truncates string payload values to 64 chars", () => {
    const long = "x".repeat(200);
    const result = validateSensorMessage({
      type: "kairos-sensor",
      kind: "video_ended",
      payload: { title: long },
    });
    expect(result?.payload.title).toBe("x".repeat(64));
  });

  it("keeps at most 8 payload keys", () => {
    const payload = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`k${i}`, i])
    );
    const result = validateSensorMessage({
      type: "kairos-sensor",
      kind: "post_seen",
      payload,
    });
    expect(Object.keys(result?.payload ?? {})).toHaveLength(8);
  });

  it("rejects non-finite numbers", () => {
    expect(
      validateSensorMessage({
        type: "kairos-sensor",
        kind: "video_ended",
        payload: { n: Infinity },
      })
    ).toEqual({ kind: "video_ended", payload: {} });
  });
});

describe("sensorAllowed (observe-tier gate)", () => {
  const observe = ["youtube.com", "chess.com"];

  it("allows an exact watchlist domain", () => {
    expect(sensorAllowed("youtube.com", observe)).toBe(true);
  });

  it("allows subdomains of a watchlist domain", () => {
    expect(sensorAllowed("music.youtube.com", observe)).toBe(true);
  });

  it("denies unlisted domains", () => {
    expect(sensorAllowed("linkedin.com", observe)).toBe(false);
  });

  it("denies suffix lookalikes", () => {
    expect(sensorAllowed("notyoutube.com", observe)).toBe(false);
  });

  it("denies a null domain (non-web sender)", () => {
    expect(sensorAllowed(null, observe)).toBe(false);
  });

  it("denies everything on an empty watchlist", () => {
    expect(sensorAllowed("youtube.com", [])).toBe(false);
  });
});

describe("isArmQuery (content script asks: am I observed?)", () => {
  it("recognizes the arm query", () => {
    expect(isArmQuery({ type: "kairos-sensor-arm" })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isArmQuery({ type: "kairos-sensor", kind: "video_ended" })).toBe(false);
    expect(isArmQuery(null)).toBe(false);
    expect(isArmQuery("kairos-sensor-arm")).toBe(false);
  });
});

describe("clickGateQuery (a click gate asks for its verdict)", () => {
  it("returns the named rule id", () => {
    expect(clickGateQuery({ type: "kairos-gate-click", ruleId: "chess-ladder" })).toBe("chess-ladder");
  });

  it("rejects a missing, empty, oversized or non-string id, and other messages", () => {
    expect(clickGateQuery({ type: "kairos-gate-click" })).toBeNull();
    expect(clickGateQuery({ type: "kairos-gate-click", ruleId: "" })).toBeNull();
    expect(clickGateQuery({ type: "kairos-gate-click", ruleId: "x".repeat(129) })).toBeNull();
    expect(clickGateQuery({ type: "kairos-gate-click", ruleId: 7 })).toBeNull();
    expect(clickGateQuery({ type: "kairos-gate-check" })).toBeNull();
    expect(clickGateQuery(null)).toBeNull();
  });
});

describe("isSponsoredLabel (generic feed heuristic — industry labels, not company names)", () => {
  it("matches the standard sponsored markers", () => {
    expect(isSponsoredLabel("Promoted")).toBe(true);
    expect(isSponsoredLabel("Sponsored")).toBe(true);
    expect(isSponsoredLabel("  Promoted  ")).toBe(true);
  });

  it("rejects ordinary text and embedded mentions", () => {
    expect(isSponsoredLabel("Promoted to manager!")).toBe(false);
    expect(isSponsoredLabel("")).toBe(false);
    expect(isSponsoredLabel("post")).toBe(false);
  });
});

describe("SENSOR_KINDS", () => {
  it("conforms to the completion grammar (past-tense / seen)", () => {
    expect([...SENSOR_KINDS].sort()).toEqual([
      "game_finished",
      "post_seen",
      "product_seen",
      "video_ended",
      "video_paused",
      "video_resumed",
      "video_started",
    ]);
  });
});

describe("finiteSeconds (payload guard against NaN media times)", () => {
  it("rounds a finite positive time", () => {
    expect(finiteSeconds(60.4)).toBe(60);
    expect(finiteSeconds(0.6)).toBe(1);
  });

  it("collapses NaN / Infinity / negative / zero to 0", () => {
    expect(finiteSeconds(NaN)).toBe(0); // duration before metadata loads
    expect(finiteSeconds(Infinity)).toBe(0); // live stream
    expect(finiteSeconds(-5)).toBe(0);
    expect(finiteSeconds(0)).toBe(0);
  });
});

describe("videoCompleted (≥90% watched heuristic)", () => {
  it("is true at or past the threshold", () => {
    expect(videoCompleted(90, 100)).toBe(true);
    expect(videoCompleted(100, 100)).toBe(true);
    expect(videoCompleted(1000, 1107)).toBe(true); // ~90% of an 18-min video
  });

  it("is false below the threshold", () => {
    expect(videoCompleted(50, 100)).toBe(false);
    expect(videoCompleted(0, 100)).toBe(false);
  });

  it("is never complete for a non-positive or non-finite duration", () => {
    expect(videoCompleted(10, 0)).toBe(false);
    expect(videoCompleted(10, NaN)).toBe(false); // metadata not yet loaded
    expect(videoCompleted(10, Infinity)).toBe(false); // live stream
  });

  it("honors a custom threshold", () => {
    expect(videoCompleted(80, 100, 0.75)).toBe(true);
    expect(videoCompleted(70, 100, 0.75)).toBe(false);
  });
});

describe("SENSOR_KINDS includes the video pause/resume grammar", () => {
  it("accepts video_paused and video_resumed as sensor kinds", () => {
    expect(SENSOR_KINDS).toContain("video_paused");
    expect(SENSOR_KINDS).toContain("video_resumed");
  });

  it("validateSensorMessage accepts a video_paused event", () => {
    expect(
      validateSensorMessage({
        type: "kairos-sensor",
        kind: "video_paused",
        payload: { seconds: 42 },
      })
    ).toEqual({ kind: "video_paused", payload: { seconds: 42 } });
  });
});

describe("playbackTransition (debounced pause / resume state machine)", () => {
  it("a pause from playing arms a pending pause without emitting", () => {
    const r = playbackTransition(INITIAL_PLAYBACK, { type: "pause", t: 1000 });
    expect(r.emit).toBeNull();
    expect(r.state).toEqual({ phase: "pending_pause", pauseTs: 1000 });
  });

  it("a play before the settle window is a transient — no emit, back to playing", () => {
    const pending = playbackTransition(INITIAL_PLAYBACK, { type: "pause", t: 1000 }).state;
    const r = playbackTransition(pending, { type: "play", t: 1000 + PAUSE_SETTLE_MS - 1 });
    expect(r.emit).toBeNull();
    expect(r.state).toEqual({ phase: "playing", pauseTs: null });
  });

  it("a tick before the settle window does not settle", () => {
    const pending = playbackTransition(INITIAL_PLAYBACK, { type: "pause", t: 1000 }).state;
    const r = playbackTransition(pending, { type: "tick", t: 1000 + PAUSE_SETTLE_MS - 1 });
    expect(r.emit).toBeNull();
    expect(r.state.phase).toBe("pending_pause");
  });

  it("a tick at or past the settle window emits video_paused", () => {
    const pending = playbackTransition(INITIAL_PLAYBACK, { type: "pause", t: 1000 }).state;
    const r = playbackTransition(pending, { type: "tick", t: 1000 + PAUSE_SETTLE_MS });
    expect(r.emit).toBe("video_paused");
    expect(r.state.phase).toBe("settled_paused");
  });

  it("a play after a settled pause emits video_resumed", () => {
    const pending = playbackTransition(INITIAL_PLAYBACK, { type: "pause", t: 1000 }).state;
    const settled = playbackTransition(pending, { type: "tick", t: 1000 + PAUSE_SETTLE_MS }).state;
    const r = playbackTransition(settled, { type: "play", t: 9000 });
    expect(r.emit).toBe("video_resumed");
    expect(r.state).toEqual({ phase: "playing", pauseTs: null });
  });

  it("a stale tick after a transient resume is a no-op", () => {
    const pending = playbackTransition(INITIAL_PLAYBACK, { type: "pause", t: 1000 }).state;
    const resumed = playbackTransition(pending, { type: "play", t: 1500 }).state;
    const r = playbackTransition(resumed, { type: "tick", t: 1000 + PAUSE_SETTLE_MS });
    expect(r.emit).toBeNull();
    expect(r.state.phase).toBe("playing");
  });

  it("a full bail-and-return sequence emits exactly one paused then one resumed", () => {
    const emissions: (string | null)[] = [];
    let state = INITIAL_PLAYBACK;
    for (const input of [
      { type: "pause", t: 1000 } as const,
      { type: "tick", t: 1000 + PAUSE_SETTLE_MS } as const,
      { type: "play", t: 20000 } as const,
    ]) {
      const r = playbackTransition(state, input);
      state = r.state;
      if (r.emit) emissions.push(r.emit);
    }
    expect(emissions).toEqual(["video_paused", "video_resumed"]);
  });
});
