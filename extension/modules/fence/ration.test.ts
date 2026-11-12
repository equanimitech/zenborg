import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityEvent, type ActivityEvent } from "../domain/activity";
import { parseFences } from "./parse";
import { hasOpenRation, localDay, poolMinutes, rationBlocks, rationDay, withRations } from "./ration";

const MIN = 60_000;
// Saturday 2026-10-24, local.
const SAT = new Date(2026, 9, 24, 14, 0).getTime();
let seq = 0;
const ev = (ts: number, kind: string, domain?: string): ActivityEvent =>
  createActivityEvent({ id: `e${++seq}`, surface: "browser", kind, ts, payload: domain ? { domain } : {} });

function rationed(
  host: string,
  pool = "youtube-weekend",
  window: { fromHour: number; toHour: number; weekdays: string[] } = { fromHour: 0, toHour: 0, weekdays: ["SAT", "SUN"] },
) {
  return {
    id: `watering:${pool}:browser:${host}`,
    name: `${pool} (${host})`,
    scope: { surface: "browser", domain: host },
    primitives: [
      {
        kind: "schedule",
        window,
        outsideWindow: "inactive",
        budget: { minutes: 60, pool, exclude: ["music.youtube.com"] },
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

// Monday 2026-10-26, local. The 07h day boundary and the pool window are tested apart:
// `open` is a weekday pool open all day, so only the boundary decides; `split` has the
// real shape, a 12-17 weekday pool and a weekend pool on the same host (weekday first).
const MON = (h: number, m = 0) => new Date(2026, 9, 26, h, m).getTime();
const watch = (start: number, mins: number): ActivityEvent[] => [
  ev(start, "navigation_committed", "youtube.com"),
  ev(start + mins * MIN, "tab_closed", "youtube.com"),
];
const allDay = { fromHour: 0, toHour: 0, weekdays: ["MON", "TUE", "WED", "THU", "FRI"] };
const open = parseFences({ a: rationed("youtube.com", "youtube-ration", allDay) }, MON(12))!.fences;
const split = parseFences(
  {
    a: rationed("youtube.com", "youtube-ration", { fromHour: 12, toHour: 17, weekdays: allDay.weekdays }),
    b: rationed("youtube.com"),
  },
  MON(12),
)!.fences;

describe("rationDay", () => {
  it("turns over at 07h, not midnight", () => {
    expect(rationDay(MON(0, 30))).toBe("2026-10-25");
    expect(rationDay(MON(6, 59))).toBe("2026-10-25");
    expect(rationDay(MON(7))).toBe("2026-10-26");
  });
});

describe("poolMinutes ration day", () => {
  it("does not spend today's pool with after-midnight watching", () => {
    expect(poolMinutes(watch(MON(0, 30), 60), open, MON(13))["youtube-ration"] ?? 0).toBe(0);
  });
  it("counts watching from 08h toward that day", () => {
    expect(Math.round(poolMinutes(watch(MON(8), 20), open, MON(13))["youtube-ration"])).toBe(20);
  });
  it("still counts the after-midnight bout on the day it belongs to, until 07h", () => {
    expect(Math.round(poolMinutes(watch(MON(0, 30), 20), open, MON(6, 30))["youtube-ration"])).toBe(20);
  });
});

describe("poolMinutes window", () => {
  it("credits a weekday 13h bout to the weekday pool, not the weekend one", () => {
    const m = poolMinutes(watch(MON(13), 20), split, MON(14));
    expect(Math.round(m["youtube-ration"])).toBe(20);
    expect(m["youtube-weekend"] ?? 0).toBe(0);
  });
  it("credits a Saturday 14h bout to the weekend pool", () => {
    const m = poolMinutes(watch(SAT, 20), split, SAT + 30 * MIN);
    expect(Math.round(m["youtube-weekend"])).toBe(20);
    expect(m["youtube-ration"] ?? 0).toBe(0);
  });
  it("spends nothing when no pool's window is active", () => {
    expect(poolMinutes(watch(MON(9), 20), split, MON(14))).toEqual({});
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
  it("reads the count from before 07h as stale after 07h", () => {
    const night = { day: rationDay(MON(0, 30)), minutes: { "youtube-ration": 99 } };
    expect(Object.keys(withRations(open, night, MON(6, 30)))).toHaveLength(1);
    expect(Object.keys(withRations(open, night, MON(8)))).toEqual([]);
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
