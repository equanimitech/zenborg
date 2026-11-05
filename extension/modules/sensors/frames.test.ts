/**
 * The sensor runs in every frame (allFrames). Three things must hold for an
 * embedded player: its events are credited to the tab the gardener opened, a
 * close from one frame never ends another frame's playback, and a host mapped
 * to an area widens the video sense alone.
 */
import { describe, expect, it } from "vitest";
import {
  closeWrites,
  isPlaybackProbe,
  isVideoClose,
  PLAYBACK_PROBE,
  senderDomain,
  sensorAllowed,
  sensorPermitted,
  SENSOR_KINDS,
  validateSensorMessage,
  type ObserveTiers,
  type ValidatedSensorEvent,
} from "./events";

describe("senderDomain — an iframe player is credited to the tab", () => {
  it("takes the top-level tab's domain, not the iframe host", () => {
    const sender = {
      tab: { id: 7, url: "https://www.example.tv/watch/42" },
      frameId: 3,
      url: "https://player.example.net/embed/42",
    };
    expect(senderDomain(sender)).toBe("example.tv");
  });

  it("is null without a web tab", () => {
    expect(senderDomain({})).toBeNull();
    expect(senderDomain({ tab: { url: "chrome://newtab/" } })).toBeNull();
  });

  it("an iframe event on an observed tab passes the gate; the iframe host alone would not", () => {
    const observe = ["example.tv"];
    const sender = { tab: { url: "https://example.tv/" }, url: "https://player.example.net/e" };
    expect(sensorAllowed(senderDomain(sender), observe)).toBe(true);
    expect(sensorAllowed("player.example.net", observe)).toBe(false);
  });
});

describe("sensorPermitted — an area mapping widens the video sense only", () => {
  const tiers: ObserveTiers = { deep: ["fenced.example"], video: ["fenced.example", "mapped.example"] };

  it("a mapped host passes video events and nothing else", () => {
    for (const kind of SENSOR_KINDS) {
      expect(sensorPermitted(kind, "mapped.example", tiers)).toBe(kind.startsWith("video_"));
    }
  });

  it("a fence or browser-map host passes every sense, as before", () => {
    for (const kind of SENSOR_KINDS) {
      expect(sensorPermitted(kind, "fenced.example", tiers)).toBe(true);
    }
  });

  it("an unmapped host passes nothing", () => {
    for (const kind of SENSOR_KINDS) {
      expect(sensorPermitted(kind, "other.example", tiers)).toBe(false);
    }
  });
});

describe("closeWrites — a close from one frame does not end another's playback", () => {
  const close = (kind: "video_paused" | "video_ended", seconds: number): ValidatedSensorEvent => ({
    kind,
    payload: { seconds },
  });
  const answer = (seconds: number) =>
    validateSensorMessage({ type: "kairos-sensor", kind: "video_resumed", payload: { seconds } });

  it("with nothing else playing, the close is written as sent", () => {
    expect(closeWrites(close("video_ended", 30), null)).toEqual([close("video_ended", 30)]);
  });

  it("with another frame playing, the close drops its position and that frame reopens at its own", () => {
    expect(closeWrites(close("video_ended", 30), answer(1800))).toEqual([
      { kind: "video_ended", payload: {} },
      { kind: "video_resumed", payload: { seconds: 1800 } },
    ]);
  });

  it("a dead frame cannot answer, so the tab's close goes through", () => {
    expect(closeWrites(close("video_paused", 600), validateSensorMessage(undefined))).toEqual([
      close("video_paused", 600),
    ]);
  });

  it("an answer that is not a reopen is ignored", () => {
    const forged = validateSensorMessage({ type: "kairos-sensor", kind: "video_ended" });
    expect(closeWrites(close("video_paused", 600), forged)).toEqual([close("video_paused", 600)]);
  });

  it("only video closes are ever handed over", () => {
    const opener: ValidatedSensorEvent = { kind: "video_started", payload: { seconds: 0 } };
    expect(closeWrites(opener, answer(1800))).toEqual([opener]);
    expect(isVideoClose("video_started")).toBe(false);
    expect(isVideoClose("video_resumed")).toBe(false);
    expect(isVideoClose("post_seen")).toBe(false);
  });

  it("the probe is recognised only as itself", () => {
    expect(isPlaybackProbe(PLAYBACK_PROBE)).toBe(true);
    expect(isPlaybackProbe({ type: "kairos-sensor-arm" })).toBe(false);
    expect(isPlaybackProbe(null)).toBe(false);
  });
});
