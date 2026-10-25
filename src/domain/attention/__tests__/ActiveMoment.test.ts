import { describe, expect, it } from "vitest";
import { staleReason, wakingDayKey } from "../ActiveMoment.ts";

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
