import { describe, expect, it } from "vitest";
import type { Allocation } from "../../entities/Allocation.ts";
import { appetiteCheck } from "../AppetiteCheck.ts";

const al = (
  id: string,
  name: string,
  area: string,
  kind: "bet" | "lane" = "bet",
  appetiteDays = 3,
): Allocation => ({ id, name, area, kind, link: "x", appetiteDays, aim: "a" });
const table = [
  al("d", "Data trust", "area-themia", "lane"),
  al("b", "Bugs & ops", "Themia", "lane"),
  al("z", "Shape Up for one", "equanimi.tech"),
  al("c", "CEDH bêta", "THEMIA", "bet", 1.5),
];
const areas = { "area-themia": { name: "Themia" } };
const spend = {
  unattributedPct: 36,
  allocations: [
    { id: "d", days: 2, pct: 67 },
    { id: "b", days: 4, pct: 133 },
    { id: "z", days: 1, pct: 33 },
    { id: "c", days: 0.5, pct: 33 },
  ],
};

describe("appetiteCheck", () => {
  const r = appetiteCheck(table, spend, 12, areas);

  it("tables every allocation and the cycle figures", () => {
    expect(r.rows.map((x) => x.name)).toHaveLength(4);
    expect(r.daysLeftToBet).toBe(12 - 0.5 - 10.5);
    expect(r.bugsOps).toEqual({
      days: 4,
      pctOfCapacity: 33,
      limitPctOfCapacity: 25,
      over: true,
    });
  });

  it("the Themia extract has Themia allocations only (by name, id or case)", () => {
    expect(r.themiaExtract.rows.map((x) => x.name)).toEqual([
      "Data trust",
      "Bugs & ops",
      "CEDH bêta",
    ]);
    expect(JSON.stringify(r.themiaExtract)).not.toMatch(/Shape Up|equanimi/);
    expect(r.themiaExtract.unattributedPct).toBe(36);
    expect(r.themiaExtract).not.toHaveProperty("daysLeftToBet");
  });

  it("drops the Bugs & ops figure from the extract when that lane is personal", () => {
    const t = table.map((a) => (a.id === "b" ? { ...a, area: "Adminy" } : a));
    const x = appetiteCheck(t, spend, 12, areas);
    expect(x.themiaExtract.bugsOps).toBeUndefined();
    expect(x.themiaExtract.rows.map((y) => y.name)).not.toContain("Bugs & ops");
  });
});
