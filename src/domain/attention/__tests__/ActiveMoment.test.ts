import { describe, expect, it } from "vitest";
import { resolvePointer, staleReason, switchPointer, wakingDayKey } from "../ActiveMoment.ts";

describe("staleReason", () => {
  it("is null for a moment allocated to today", () => {
    expect(staleReason({ day: "2026-10-25" }, "2026-10-25")).toBeNull();
  });
  it("names the past day", () => {
    expect(staleReason({ day: "2026-10-24" }, "2026-10-25")).toBe(
      "moment is allocated to 2026-10-24, not today",
    );
  });
  it("treats an unallocated moment as stale", () => {
    expect(staleReason({ day: null }, "2026-10-25")).toBe(
      "moment is allocated to no day, not today",
    );
  });
  it("treats a missing moment as stale", () => {
    expect(staleReason(undefined, "2026-10-25")).toBe(
      "moment no longer exists",
    );
  });
});

describe("wakingDayKey", () => {
  it("still belongs to yesterday at 02:00", () => {
    expect(wakingDayKey(new Date(2026, 9, 25, 2, 0))).toBe("2026-10-24");
    expect(wakingDayKey(new Date(2026, 9, 25, 5, 0))).toBe("2026-10-25");
  });
});

describe("timed switch", () => {
  const T0 = "2026-10-31T20:00:00.000Z";
  const t = (min: number) => Date.parse(T0) + min * 60_000;

  it("an old pointer without the new fields is untouched", () => {
    const p = { momentId: "a", at: T0 };
    expect(resolvePointer(p, t(999))).toEqual(p);
  });
  it("keeps unknown fields while in force", () => {
    const p = { momentId: "a", at: T0, future: 1 } as never;
    expect(resolvePointer(p, t(0))).toEqual({ momentId: "a", at: T0, future: 1 });
  });
  it("reads empty or missing as none", () => {
    expect(resolvePointer({} as never, t(0))).toBeNull();
    expect(resolvePointer(null, t(0))).toBeNull();
  });
  it("returns to the previous moment when until passes", () => {
    const prev = { momentId: "work", at: "2026-10-31T18:00:00.000Z" };
    const sw = switchPointer(prev, "yt", T0, 30);
    expect(sw).toEqual({ momentId: "yt", at: T0, until: "2026-10-31T20:30:00.000Z", returnTo: prev });
    expect(resolvePointer(sw, t(29))?.momentId).toBe("yt");
    expect(resolvePointer(sw, t(30))).toEqual(prev);
  });
  it("clears at until when there was nothing to return to", () => {
    expect(resolvePointer(switchPointer(null, "yt", T0, 15), t(15))).toBeNull();
  });
  it("does not nest: a second switch returns where the first would", () => {
    const prev = { momentId: "work", at: "2026-10-31T18:00:00.000Z" };
    const first = switchPointer(prev, "yt", T0, 30);
    const second = switchPointer(resolvePointer(first, t(5)), "chess", new Date(t(5)).toISOString(), 20);
    expect(second.returnTo).toEqual(prev);
  });
  it("a plain set drops the timer", () => {
    expect(switchPointer({ momentId: "a", at: T0, until: T0 }, "b", T0)).toEqual({ momentId: "b", at: T0 });
  });
  it("an unparseable until reads as untimed", () => {
    expect(resolvePointer({ momentId: "a", at: T0, until: "soon" }, t(999))?.momentId).toBe("a");
  });
});
