import { describe, expect, it } from "vitest";
import {
  checkMapIntegrity,
  coverage,
  type GarminActivity,
  type GarminHabitMap,
  parseHabitMap,
  resolveActivities,
  resolveActivity,
} from "@/domain/garmin/GarminHabitMap";

// Synthetic fixtures. Real habit ids are per-vault and never live in this repo.
const YOGA = "11111111-1111-4111-8111-111111111111";
const FOOTY = "22222222-2222-4222-8222-222222222222";

const MAP: GarminHabitMap = {
  version: 1,
  mappings: {
    yoga: { habitId: YOGA, habitName: "yoga" },
    soccer: { habitId: FOOTY, habitName: "footy" },
  },
  pending: {
    running: {
      reason: "three candidate habits",
      recommendation: "split on splits",
    },
  },
};

const act = (type: string, id = 1): GarminActivity => ({ id, type });

describe("resolveActivity", () => {
  it("resolves a confirmed type to its habit", () => {
    const r = resolveActivity(MAP, act("yoga"));
    expect(r.kind).toBe("mapped");
    if (r.kind !== "mapped") return;
    expect(r.mapping.habitId).toBe(YOGA);
  });

  it("resolves soccer to its mapped habit, not to a habit named soccer", () => {
    // The destination is the mapping's habitId, never a name match on the
    // activity type.
    const r = resolveActivity(MAP, act("soccer"));
    if (r.kind !== "mapped") throw new Error("expected mapped");
    expect(r.mapping.habitId).toBe(FOOTY);
    expect(r.mapping.habitName).toBe("footy");
  });

  it("reports an undecided type as pending, never as a habit", () => {
    const r = resolveActivity(MAP, act("running"));
    expect(r.kind).toBe("pending");
  });

  it("lets pending outrank a stray mapping for the same type", () => {
    // A half-finished edit must not start writing moments.
    const conflicted: GarminHabitMap = {
      ...MAP,
      mappings: {
        ...MAP.mappings,
        running: { habitId: FOOTY, habitName: "footy" },
      },
    };
    expect(resolveActivity(conflicted, act("running")).kind).toBe("pending");
  });

  it("treats an unmapped type as unknown rather than throwing", () => {
    expect(resolveActivity(MAP, act("cycling")).kind).toBe("unknown");
  });
});

describe("parseHabitMap", () => {
  it("fails soft to an empty map on garbage", () => {
    for (const junk of [null, undefined, 42, "nope", []]) {
      const m = parseHabitMap(junk);
      expect(Object.keys(m.mappings)).toHaveLength(0);
      expect(Object.keys(m.pending)).toHaveLength(0);
    }
  });

  it("drops entries with no habitId instead of inventing one", () => {
    const m = parseHabitMap({ mappings: { yoga: { habitName: "yoga" } } });
    expect(m.mappings.yoga).toBeUndefined();
  });

  it("round-trips a well-formed map", () => {
    const m = parseHabitMap(JSON.parse(JSON.stringify(MAP)));
    expect(m.mappings.yoga.habitId).toBe(YOGA);
    expect(m.pending.running.reason).toContain("candidate");
  });
});

describe("checkMapIntegrity", () => {
  const habits = [
    { id: YOGA, name: "yoga", isArchived: false },
    { id: FOOTY, name: "footy", isArchived: false },
  ];

  it("passes a map whose ids all exist", () => {
    expect(checkMapIntegrity(MAP, habits)).toHaveLength(0);
  });

  it("flags a dangling habit id", () => {
    const broken: GarminHabitMap = {
      ...MAP,
      mappings: { yoga: { habitId: "does-not-exist", habitName: "yoga" } },
    };
    const issues = checkMapIntegrity(broken, habits);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("no habit with this id");
  });

  it("flags an archived habit", () => {
    const issues = checkMapIntegrity(MAP, [
      { id: YOGA, name: "yoga", isArchived: true },
      ...habits.slice(1),
    ]);
    expect(issues.some((i) => i.detail.includes("archived"))).toBe(true);
  });

  it("flags a rename so the audit name cannot rot", () => {
    const issues = checkMapIntegrity(MAP, [
      { id: YOGA, name: "Yoga", isArchived: false },
      ...habits.slice(1),
    ]);
    expect(issues.some((i) => i.detail.includes("renamed"))).toBe(true);
  });
});

describe("coverage", () => {
  it("tallies by type, busiest first", () => {
    const rows = coverage(
      resolveActivities(MAP, [
        act("yoga", 1),
        act("yoga", 2),
        act("yoga", 3),
        act("soccer", 4),
        act("running", 5),
        act("cycling", 6),
        act("cycling", 7),
      ]),
    );
    expect(rows[0]).toMatchObject({ type: "yoga", count: 3, status: "mapped" });
    expect(rows.find((r) => r.type === "cycling")).toMatchObject({
      count: 2,
      status: "unknown",
    });
    expect(rows.find((r) => r.type === "running")?.status).toBe("pending");
  });
});
