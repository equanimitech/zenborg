/**
 * The sensor runs in every frame (allFrames). Two things must hold for an
 * embedded player: its events are credited to the tab the gardener opened,
 * and players in several frames of one tab never read as two.
 */
import { describe, expect, it } from "vitest";
import { claimPlayback, releasePlayback, senderDomain, sensorAllowed, type PlaybackOwners } from "./events";
import { deriveObserveSet } from "../watchlist/derived";

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
    const observe = deriveObserveSet({}, {}, ["example.tv"]);
    const sender = { tab: { url: "https://example.tv/" }, url: "https://player.example.net/e" };
    expect(sensorAllowed(senderDomain(sender), observe)).toBe(true);
    expect(sensorAllowed("player.example.net", observe)).toBe(false);
  });
});

describe("deriveObserveSet — the vault's area map is the observe tier", () => {
  it("a host mapped to an area becomes observed, an unmapped one does not", () => {
    const observe = deriveObserveSet({}, {}, ["example.tv"]);
    expect(sensorAllowed("example.tv", observe)).toBe(true);
    expect(sensorAllowed("player.example.net", observe)).toBe(false);
  });

  it("dedupes a host that is both pushed and locally mapped", () => {
    const observe = deriveObserveSet({}, { "example.tv": "area-1" }, ["example.tv"]);
    expect(observe.filter((d) => d === "example.tv")).toHaveLength(1);
  });
});

describe("claimPlayback — no double count across frames", () => {
  const TAB = 7;
  const run = (steps: readonly [frameId: number, kind: Parameters<typeof claimPlayback>[3]][]) => {
    let owners: PlaybackOwners = {};
    const written: string[] = [];
    for (const [frameId, kind] of steps) {
      const r = claimPlayback(owners, TAB, frameId, kind);
      owners = r.owners;
      if (r.write) written.push(`${frameId}:${kind}`);
    }
    return { owners, written };
  };

  it("two frames playing at once write one start and one end", () => {
    const { written } = run([
      [3, "video_started"],
      [5, "video_started"], // a second player in another frame: refused
      [5, "video_paused"], // its close: dropped
      [3, "video_ended"],
      [5, "video_ended"], // no holder now, but frame 5 never opened: dropped
    ]);
    expect(written).toEqual(["3:video_started", "3:video_ended"]);
  });

  it("another frame takes over once the holder pauses", () => {
    const { written, owners } = run([
      [3, "video_started"],
      [3, "video_paused"],
      [5, "video_started"],
      [3, "video_resumed"], // frame 5 holds now: refused
      [5, "video_paused"],
    ]);
    expect(written).toEqual([
      "3:video_started",
      "3:video_paused",
      "5:video_started",
      "5:video_paused",
    ]);
    expect(owners["7"]).toEqual({ refused: [3] });
  });

  it("a refused frame that later starts on a free tab speaks again", () => {
    const { written } = run([
      [3, "video_started"],
      [5, "video_started"],
      [3, "video_ended"],
      [5, "video_resumed"],
      [5, "video_paused"],
    ]);
    expect(written).toEqual(["3:video_started", "3:video_ended", "5:video_resumed", "5:video_paused"]);
  });

  it("one frame's own pause/resume/end pass through untouched", () => {
    const { written } = run([
      [0, "video_started"],
      [0, "video_paused"],
      [0, "video_resumed"],
      [0, "video_ended"],
    ]);
    expect(written).toHaveLength(4);
  });

  it("non-video senses are never gated", () => {
    expect(claimPlayback({ "7": { holder: 3, refused: [] } }, TAB, 5, "post_seen").write).toBe(true);
  });

  it("holders are per tab", () => {
    const r = claimPlayback({ "7": { holder: 3, refused: [] } }, 8, 5, "video_started");
    expect(r.write).toBe(true);
    expect(r.owners["8"]).toEqual({ holder: 5, refused: [] });
  });

  it("with no state, a close passes (the pre-allFrames behaviour)", () => {
    expect(claimPlayback({}, TAB, 0, "video_paused").write).toBe(true);
  });

  it("releasePlayback forgets a tab, and is a no-op on an unknown one", () => {
    expect(releasePlayback({ "7": { holder: 3, refused: [5] } }, TAB)).toEqual({});
    const free: PlaybackOwners = {};
    expect(releasePlayback(free, TAB)).toBe(free);
  });
});
