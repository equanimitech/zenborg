import { describe, expect, it } from "vitest";
import type { Cycle } from "@/domain/entities/Cycle";
import { addDays, clampCycleEdge, dayDiff } from "../intervals";

function makeCycle(
  id: string,
  startDate: string,
  endDate: string | null,
): Cycle {
  return {
    id,
    name: id,
    startDate,
    endDate,
    intention: null,
    reflection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("clampCycleEdge", () => {
  it("does not clamp when there is no neighbor", () => {
    const self = makeCycle("a", "2026-05-01", "2026-05-10");
    const result = clampCycleEdge({
      cycleId: "a",
      edge: "end",
      candidateDate: "2026-05-15",
      allCycles: [self],
    });
    expect(result).toEqual({ date: "2026-05-15" });
  });

  it("clamps end against a future neighbor", () => {
    const self = makeCycle("a", "2026-05-01", "2026-05-10");
    const next = makeCycle("b", "2026-05-15", "2026-05-20");
    const result = clampCycleEdge({
      cycleId: "a",
      edge: "end",
      candidateDate: "2026-05-17",
      allCycles: [self, next],
    });
    expect(result).toEqual({ date: "2026-05-14", blockedBy: "b" });
  });

  it("clamps start against a past neighbor", () => {
    const prev = makeCycle("p", "2026-04-20", "2026-04-30");
    const self = makeCycle("a", "2026-05-05", "2026-05-10");
    const result = clampCycleEdge({
      cycleId: "a",
      edge: "start",
      candidateDate: "2026-04-25",
      allCycles: [prev, self],
    });
    expect(result).toEqual({ date: "2026-05-01", blockedBy: "p" });
  });

  it("clamps end on self-inversion (end must be > start)", () => {
    const self = makeCycle("a", "2026-05-01", "2026-05-10");
    const result = clampCycleEdge({
      cycleId: "a",
      edge: "end",
      candidateDate: "2026-04-30",
      allCycles: [self],
    });
    expect(result).toEqual({ date: "2026-05-02" });
  });

  it("clamps start on self-inversion (start must be < end)", () => {
    const self = makeCycle("a", "2026-05-01", "2026-05-10");
    const result = clampCycleEdge({
      cycleId: "a",
      edge: "start",
      candidateDate: "2026-05-15",
      allCycles: [self],
    });
    expect(result).toEqual({ date: "2026-05-09" });
  });

  it("treats touching cycles as blocking (no overlap, including the boundary)", () => {
    const self = makeCycle("a", "2026-05-01", "2026-05-10");
    const next = makeCycle("b", "2026-05-11", "2026-05-20");
    const result = clampCycleEdge({
      cycleId: "a",
      edge: "end",
      candidateDate: "2026-05-11",
      allCycles: [self, next],
    });
    expect(result).toEqual({ date: "2026-05-10", blockedBy: "b" });
  });

  it("handles ongoing cycle (endDate=null) as blocking from its startDate", () => {
    const self = makeCycle("a", "2026-05-01", "2026-05-10");
    const ongoing = makeCycle("b", "2026-05-15", null);
    const result = clampCycleEdge({
      cycleId: "a",
      edge: "end",
      candidateDate: "2026-05-20",
      allCycles: [self, ongoing],
    });
    expect(result).toEqual({ date: "2026-05-14", blockedBy: "b" });
  });
});

describe("addDays / dayDiff", () => {
  it("adds positive days", () => {
    expect(addDays("2026-05-01", 5)).toBe("2026-05-06");
  });

  it("subtracts days", () => {
    expect(addDays("2026-05-01", -1)).toBe("2026-04-30");
  });

  it("handles month rollover", () => {
    expect(addDays("2026-05-31", 1)).toBe("2026-06-01");
  });

  it("computes whole-day deltas", () => {
    expect(dayDiff("2026-05-01", "2026-05-08")).toBe(7);
    expect(dayDiff("2026-05-08", "2026-05-01")).toBe(-7);
    expect(dayDiff("2026-05-01", "2026-05-01")).toBe(0);
  });
});
