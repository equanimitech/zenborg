import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityEvent, type ActivityEvent } from "../domain/activity";
import { parseFences } from "./parse";
import { hasOpenRation, localDay, poolMinutes, rationBlocks, withRations } from "./ration";

const MIN = 60_000;
// Saturday 2026-10-24, local.
const SAT = new Date(2026, 9, 24, 14, 0).getTime();
let seq = 0;
const ev = (ts: number, kind: string, domain?: string): ActivityEvent =>
  createActivityEvent({ id: `e${++seq}`, surface: "browser", kind, ts, payload: domain ? { domain } : {} });

function rationed(host: string) {
  return {
    id: `watering:youtube-weekend:browser:${host}`,
    name: `youtube-weekend (${host})`,
    scope: { surface: "browser", domain: host },
    primitives: [
      {
        kind: "schedule",
        window: { fromHour: 0, toHour: 0, weekdays: ["SAT", "SUN"] },
        outsideWindow: "inactive",
        budget: { minutes: 60, pool: "youtube-weekend", exclude: ["music.youtube.com"] },
        wraps: {
          kind: "cooldown",
          duration: { type: "standing" },
          unlockPath: { type: "out_of_band", note: "Tomorrow." },
          enforcement: { at: "browser", reach: "navigation" },
        },
      },
    ],
  };
}

const fences = parseFences({ a: rationed("youtube.com"), b: rationed("youtu.be") }, SAT)!.fences;

describe("poolMinutes", () => {
  it("sums attended minutes across the pool's hosts", () => {
    const events = [
      ev(SAT, "navigation_committed", "www.youtube.com"),
      ev(SAT + 20 * MIN, "navigation_committed", "youtu.be"),
      ev(SAT + 30 * MIN, "tab_closed", "youtu.be"),
    ];
    expect(Math.round(poolMinutes(events, fences, SAT + 31 * MIN)["youtube-weekend"])).toBe(30);
  });

  it("drops excluded subdomains", () => {
    const events = [
      ev(SAT, "navigation_committed", "music.youtube.com"),
      ev(SAT + 20 * MIN, "tab_closed", "music.youtube.com"),
    ];
    expect(poolMinutes(events, fences, SAT + 21 * MIN)["youtube-weekend"] ?? 0).toBe(0);
  });

  it("counts only bouts that start today", () => {
    const yesterday = SAT - 24 * 60 * MIN;
    const events = [
      ev(yesterday, "navigation_committed", "youtube.com"),
      ev(yesterday + 20 * MIN, "tab_closed", "youtube.com"),
    ];
    expect(poolMinutes(events, fences, SAT)["youtube-weekend"] ?? 0).toBe(0);
  });
});

describe("withRations", () => {
  const day = localDay(SAT);
  it("drops a budgeted fence whose pool is under budget", () => {
    expect(Object.keys(withRations(fences, { day, minutes: { "youtube-weekend": 59 } }, SAT))).toEqual([]);
  });
  it("keeps it once the pool reaches the budget", () => {
    expect(Object.keys(withRations(fences, { day, minutes: { "youtube-weekend": 60 } }, SAT))).toHaveLength(2);
  });
  it("reads a stale day as zero", () => {
    expect(Object.keys(withRations(fences, { day: "2026-10-23", minutes: { "youtube-weekend": 99 } }, SAT))).toEqual(
      [],
    );
  });
  it("fails open on no count", () => {
    expect(Object.keys(withRations(fences, null, SAT))).toEqual([]);
  });
});

describe("rationBlocks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT);
  });
  afterEach(() => vi.useRealTimers());

  it("gathers one block per pool with its exclusions and reach", () => {
    expect(rationBlocks(fences)).toEqual([
      { pool: "youtube-weekend", domains: ["youtube.com", "youtu.be"], except: ["music.youtube.com"], reach: "navigation" },
    ]);
  });
});

describe("hasOpenRation", () => {
  it("is true inside the window, false outside", () => {
    expect(hasOpenRation(fences, new Date(SAT))).toBe(true);
    expect(hasOpenRation(fences, new Date(2026, 9, 26, 14))).toBe(false); // Monday
  });
});
