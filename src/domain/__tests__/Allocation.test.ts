import { describe, expect, it } from "vitest";
import { type Allocation, allocationErrors } from "../entities/Allocation";
import { type Cycle, isCycleError, setAllocations } from "../entities/Cycle";

const bet = (name: string, appetiteDays: number): Allocation => ({
  id: name,
  kind: "bet",
  name,
  area: "Themia",
  link: "https://linear.app/themia-sas/project/x",
  appetiteDays,
});
const lane = (name: string, appetiteDays: number, aim?: string): Allocation => ({
  id: name,
  kind: "lane",
  name,
  area: "Themia",
  link: "https://linear.app/themia-sas/project/y",
  appetiteDays,
  aim,
});

const cycle: Cycle = {
  id: "c",
  name: "Cycle 23",
  startDate: "2026-11-03",
  endDate: "2026-11-23",
  intention: null,
  reflection: null,
  createdAt: "",
  updatedAt: "",
};

describe("allocation invariants (capacity 12)", () => {
  it("accepts bets and lanes up to 11.5 days", () => {
    const table = [
      bet("Rente", 5),
      lane("Data trust", 3, "DC E findings below X"),
      lane("Bugs & ops", 3, "Keep prod green"),
    ];
    expect(allocationErrors(table)).toEqual([]);
    const r = setAllocations(cycle, [...table, bet("Cut", 0.5)]);
    expect(isCycleError(r)).toBe(false);
    expect((r as Cycle).capacityDays).toBe(12);
    expect((r as Cycle).allocations).toHaveLength(4);
  });

  it("refuses appetites above 11.5 days", () => {
    const r = setAllocations(cycle, [bet("A", 6), bet("B", 5.6)]);
    expect(r).toEqual({ error: expect.stringContaining("over 11.5 d") });
  });

  it("refuses a Bugs & ops lane above a quarter of capacity", () => {
    const r = setAllocations(cycle, [lane("Bugs & ops", 3.5, "aim")]);
    expect(r).toEqual({ error: expect.stringContaining("quarter of capacity") });
    expect(allocationErrors([lane("bugs  &  OPS", 3, "aim")])).toEqual([]);
  });

  it("refuses a lane without an aim, not a bet", () => {
    expect(allocationErrors([lane("Data trust", 2)])).toEqual([
      'Lane "Data trust" requires an aim',
    ]);
    expect(allocationErrors([lane("Data trust", 2, "  ")])).toHaveLength(1);
    expect(allocationErrors([bet("Rente", 2)])).toEqual([]);
  });

  it("uses the cycle's own capacity", () => {
    expect(allocationErrors([bet("A", 8)], 8)).toHaveLength(1);
    expect(allocationErrors([bet("A", 7.5)], 8)).toEqual([]);
  });

  it("leaves the cycle untouched on refusal", () => {
    setAllocations(cycle, [bet("A", 20)]);
    expect(cycle.allocations).toBeUndefined();
  });
});
