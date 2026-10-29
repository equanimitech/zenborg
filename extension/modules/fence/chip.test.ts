import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chipLines } from "./chip";
import { parseFences } from "./parse";
import { STAYING } from "./questions";
import { localDay } from "./ration";

const SAT = new Date(2026, 9, 24, 14, 0).getTime();
const MON = new Date(2026, 9, 26, 14, 0).getTime();

const rationed = (host: string) => ({
  id: `watering:youtube-weekend:browser:${host}`,
  name: host,
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
});

const fences = parseFences({ a: rationed("youtube.com"), b: rationed("youtu.be") }, SAT)!.fences;
const spent = { day: localDay(SAT), minutes: { "youtube-weekend": 12.9 } };

describe("chipLines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT);
  });
  afterEach(() => vi.useRealTimers());

  it("floors the pool's minutes against the budget", () => {
    const lines = chipLines(fences, spent, "www.youtube.com", SAT);
    expect(lines[0]).toBe("12 / 60 min");
    expect(lines).toHaveLength(2);
    expect(STAYING).toContain(lines[1]);
  });
  it("reads zero when the count is from another day or missing", () => {
    expect(chipLines(fences, { ...spent, day: "2026-10-23" }, "youtube.com", SAT)[0]).toBe("0 / 60 min");
    expect(chipLines(fences, null, "youtube.com", SAT)[0]).toBe("0 / 60 min");
  });
  it("shows nothing on excluded or unrelated hosts", () => {
    expect(chipLines(fences, spent, "music.youtube.com", SAT)).toEqual([]);
    expect(chipLines(fences, spent, "example.com", SAT)).toEqual([]);
  });
  it("shows nothing outside the window", () => {
    vi.setSystemTime(MON);
    expect(chipLines(fences, spent, "youtube.com", MON)).toEqual([]);
  });
});
