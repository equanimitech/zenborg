/**
 * The video sense counts what is heard and still playing, and a hung frame
 * never holds a tab close.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeWithTimeout, PLAYBACK_PROBE } from "./events";
import { armVideoSense } from "./senses/video";

const sent: string[] = [];
vi.mock("./send", () => ({ sendSensorEvent: (kind: string) => sent.push(kind) }));

class FakeVideo extends EventTarget {
  paused = false;
  ended = false;
  muted = false;
  volume = 1;
  isConnected = true;
  currentTime = 0;
  duration = 100;
}

function arm(video: FakeVideo) {
  let onMessage: (m: unknown) => unknown = () => undefined;
  vi.stubGlobal("document", { body: {}, querySelectorAll: () => [video] });
  vi.stubGlobal("MutationObserver", class { observe() {} });
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal("browser", {
    runtime: { onMessage: { addListener: (f: typeof onMessage) => (onMessage = f) } },
  });
  armVideoSense();
  return (m: unknown) => onMessage(m);
}

afterEach(() => {
  sent.length = 0;
  vi.unstubAllGlobals();
});

describe("video sense", () => {
  it("muted autoplay is not a start; unmuting it is", () => {
    const v = new FakeVideo();
    v.muted = true;
    arm(v);
    expect(sent).toEqual([]);
    v.muted = false;
    v.dispatchEvent(new Event("volumechange"));
    expect(sent).toEqual(["video_started"]);
  });

  it("a player that stopped without a pause event does not answer the probe", () => {
    const v = new FakeVideo();
    const message = arm(v);
    expect(message(PLAYBACK_PROBE)).toBeDefined();
    v.ended = true;
    expect(message(PLAYBACK_PROBE)).toBeUndefined();
  });
});

describe("probeWithTimeout", () => {
  it("falls back to null when the frame hangs or errors", async () => {
    expect(await probeWithTimeout(new Promise(() => {}), 10)).toBeNull();
    expect(await probeWithTimeout(Promise.reject(new Error("x")), 10)).toBeNull();
    expect(await probeWithTimeout(Promise.resolve("ok"), 10)).toBe("ok");
  });
});
