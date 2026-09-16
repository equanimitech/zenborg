import { describe, expect, it } from "vitest";
import { breakdown, byDay, byWeek, clock, dayLabel } from "./days.js";
import { createDomain, createDuration, type Run } from "../../domain";

const MIN = 60_000;

function run(startTs: number, minutes: number, domain = "youtube.com"): Run {
  return {
    domain: createDomain(domain),
    startTs,
    endTs: startTs + minutes * MIN,
    dwellMs: createDuration(minutes * MIN),
    audibleDwellMs: createDuration(0),
  };
}

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m, d, h, min).getTime();

describe("byDay", () => {
  it("puts the newest day first — the recent past is what you check", () => {
    const groups = byDay([
      run(at(2026, 7, 4, 10), 5),
      run(at(2026, 7, 6, 10), 5),
      run(at(2026, 7, 5, 10), 5),
    ]);
    expect(groups.map((g) => new Date(g.startOfDay).getDate())).toEqual([6, 5, 4]);
  });

  it("reads each day forwards — a day is lived in order", () => {
    const groups = byDay([
      run(at(2026, 7, 6, 18), 5),
      run(at(2026, 7, 6, 9), 5),
      run(at(2026, 7, 6, 13), 5),
    ]);
    expect(groups[0].runs.map((r) => new Date(r.startTs).getHours())).toEqual([9, 13, 18]);
  });

  it("totals the day", () => {
    const groups = byDay([run(at(2026, 7, 6, 9), 20), run(at(2026, 7, 6, 14), 40)]);
    expect(groups[0].dwellMs).toBe(60 * MIN);
  });

  it("splits across local midnight, not UTC", () => {
    // A late-night run and an early-morning one are different days to a person.
    const groups = byDay([run(at(2026, 7, 5, 23, 30), 20), run(at(2026, 7, 6, 0, 30), 20)]);
    expect(groups).toHaveLength(2);
  });

  it("returns nothing for no runs", () => {
    expect(byDay([])).toEqual([]);
  });
});

describe("dayLabel — recall beats precision", () => {
  const now = at(2026, 7, 6, 15);

  it("names today and yesterday", () => {
    expect(dayLabel(at(2026, 7, 6), now)).toBe("Today");
    expect(dayLabel(at(2026, 7, 5), now)).toBe("Yesterday");
  });

  it("names the weekday further back, since that is how a week is recalled", () => {
    const label = dayLabel(at(2026, 7, 3), now);
    expect(label).toContain("August");
    expect(label).not.toBe("Today");
  });
});

describe("clock", () => {
  it("drops seconds — a run boundary is never that precise", () => {
    expect(clock(at(2026, 7, 6, 14, 18))).toMatch(/14.18|2.18/);
  });
});

describe("byWeek", () => {
  const day = (y: number, m: number, d: number, minutes: number) => ({
    startOfDay: new Date(y, m, d).getTime(),
    dwellMs: minutes * MIN,
    runs: [run(new Date(y, m, d, 10).getTime(), minutes)],
  });

  it("starts weeks on Monday", () => {
    // Sun 9 Aug 2026 belongs to the week beginning Mon 3 Aug.
    const groups = byWeek([day(2026, 7, 9, 10), day(2026, 7, 3, 10)]);
    expect(groups).toHaveLength(1);
    expect(new Date(groups[0].startOfWeek).getDay()).toBe(1);
    expect(new Date(groups[0].startOfWeek).getDate()).toBe(3);
  });

  it("separates a Sunday from the Monday after it", () => {
    const groups = byWeek([day(2026, 7, 2, 10), day(2026, 7, 3, 10)]);
    expect(groups).toHaveLength(2);
  });

  it("puts the newest week first, and the newest day inside it first", () => {
    const groups = byWeek([day(2026, 7, 3, 10), day(2026, 7, 5, 10), day(2026, 6, 27, 10)]);
    expect(groups[0].days.map((d) => new Date(d.startOfDay).getDate())).toEqual([5, 3]);
    expect(new Date(groups[1].startOfWeek).getDate()).toBe(27);
  });

  it("totals the week", () => {
    const groups = byWeek([day(2026, 7, 3, 30), day(2026, 7, 4, 45)]);
    expect(groups[0].dwellMs).toBe(75 * MIN);
  });
});

describe("breakdown — what a folded group was made of", () => {
  const areas = [
    { id: "ent", name: "Entertainement", emoji: "🍿", color: "#ef4444" },
    { id: "play", name: "Playful", emoji: "😄", color: "#eab308" },
  ];
  const map = { "youtube.com": "ent", "chess.com": "play" };

  it("splits by area, largest first", () => {
    const slices = breakdown(
      [run(0, 60, "youtube.com"), run(60 * MIN, 20, "chess.com")],
      map,
      areas
    );
    expect(slices.map((s) => s.areaId)).toEqual(["ent", "play"]);
    expect(slices[0].share).toBeCloseTo(0.75);
    expect(slices[0].color).toBe("#ef4444");
  });

  it("gives unassigned domains a slice with no colour", () => {
    const slices = breakdown([run(0, 30, "unknown.example")], map, areas);
    expect(slices[0].areaId).toBeNull();
    expect(slices[0].name).toBe("unsorted");
    expect(slices[0].color).toBe("");
  });

  it("shares sum to one, so the bar fills exactly", () => {
    const slices = breakdown(
      [run(0, 10, "youtube.com"), run(10 * MIN, 20, "chess.com"), run(30 * MIN, 5, "x.example")],
      map,
      areas
    );
    const sum = slices.reduce((acc, s) => acc + s.share, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("returns nothing when there is nothing to show", () => {
    expect(breakdown([], map, areas)).toEqual([]);
  });
});
