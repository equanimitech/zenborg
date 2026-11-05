import { describe, expect, it } from "vitest";
import { computeHealth, countsAsAllocation, daysSinceLast } from "./health.js";
import type { Habit, Moment, Rhythm } from "./vault.js";

const NOW = new Date("2026-08-07T12:00:00.000Z");

/** Local-calendar day string — exactly the form `parseVaultDay` reads back. */
function isoDay(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The day `n` local calendar days before `d`. Shifts the calendar date rather
 * than subtracting milliseconds, so a DST boundary cannot slide it by a day.
 */
function dayBefore(d: Date, n: number): string {
  const shifted = new Date(d.getTime());
  shifted.setDate(shifted.getDate() - n);
  return isoDay(shifted);
}

const WEEKLY: Rhythm = { period: "weekly", count: 1 }; // 7-day threshold

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: "h-1",
    name: "test habit",
    areaId: "a-1",
    attitude: "KEEPING",
    phase: null,
    tags: [],
    emoji: null,
    isArchived: false,
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function moment(over: Partial<Moment> = {}): Moment {
  return {
    id: "m-1",
    name: "dinner",
    areaId: "a-1",
    habitId: null,
    cycleId: null,
    cyclePlanId: null,
    // MCP `Phase` is a string-literal union (z.enum), not a TS enum.
    phase: "EVENING",
    day: dayBefore(NOW, 2),
    order: 0,
    tags: null,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    ...over,
  };
}

describe("computeHealth — moments attached via personIds", () => {
  it("counts a moment that names the habit in personIds toward its health", () => {
    // People ARE habit records. One dinner with three friends is ONE moment
    // carrying three ids — it must reach every one of their health reads, or
    // get_habit_health and list_people_to_reach disagree about the same person.
    const yaya = habit({ id: "p-ada", name: "Ada", rhythm: WEEKLY });
    const groupDinner = moment({
      id: "m-group-dinner",
      personIds: ["p-cal", "p-ada", "p-dee"],
    });

    expect(computeHealth(yaya, null, [], NOW)).toBe("wilting");
    expect(computeHealth(yaya, null, [groupDinner], NOW)).toBe("blooming");
  });

  it("counts personIds moments for RETURNING as well as KEEPING", () => {
    const mari = habit({
      id: "p-dee",
      name: "Dee",
      attitude: "RETURNING",
      rhythm: WEEKLY,
    });
    const groupDinner = moment({
      id: "m-group-dinner",
      personIds: ["p-dee"],
    });

    expect(computeHealth(mari, null, [], NOW)).toBe("wilting");
    // Single allocation → re-entry budding grace (< 3 in window)
    expect(computeHealth(mari, null, [groupDinner], NOW)).toBe("budding");
  });

  it("leaves an ordinary habit's health untouched by unrelated personIds", () => {
    // No-regression pin: `personIds` can never hold an ordinary habit's own id,
    // so the widened filter is provably inert for every non-person record.
    const meditation = habit({
      id: "h-meditation",
      name: "meditation",
      rhythm: WEEKLY,
    });
    const ownMoment = moment({ id: "m-own", habitId: "h-meditation" });
    const otherPeople = moment({
      id: "m-other",
      personIds: ["p-ada", "p-cal", "p-dee"],
    });

    expect(computeHealth(meditation, null, [otherPeople], NOW)).toBe("wilting");
    expect(computeHealth(meditation, null, [ownMoment, otherPeople], NOW)).toBe(
      "blooming",
    );
  });

  it("does not throw on a moment carrying no personIds at all", () => {
    // `habitId: null` and no `personIds` — the optional chain is genuinely
    // exercised here, not short-circuited by a habitId match.
    const yaya = habit({ id: "p-ada", rhythm: WEEKLY });
    const orphan = moment({ id: "m-orphan" });
    expect(orphan.personIds).toBeUndefined();
    expect(orphan.habitId).toBeNull();

    expect(() => computeHealth(yaya, null, [orphan], NOW)).not.toThrow();
    expect(computeHealth(yaya, null, [orphan], NOW)).toBe("wilting");
  });

  it("counts personIds moments toward BEGINNING's 5-moment budding gate", () => {
    const uma = habit({
      id: "p-uma",
      name: "Uma",
      attitude: "BEGINNING",
    });
    const five = [1, 2, 3, 4, 5].map((n) =>
      moment({ id: `m-${n}`, personIds: ["p-uma"] }),
    );

    expect(computeHealth(uma, null, five.slice(0, 4), NOW)).toBe("seedling");
    expect(computeHealth(uma, null, five, NOW)).toBe("budding");
  });
});

describe("daysSinceLast — moments attached via personIds", () => {
  it("sees a moment that names the habit in personIds", () => {
    const groupDinner = moment({
      id: "m-group-dinner",
      personIds: ["p-ada"],
    });
    // Emitted beside `health` in get_habit_health — it must agree with it.
    expect(daysSinceLast("p-ada", [groupDinner], NOW)).toBe(2);
  });

  it("is unmoved by personIds that do not name this habit", () => {
    const otherPeople = moment({
      id: "m-other",
      personIds: ["p-cal", "p-dee"],
    });
    expect(daysSinceLast("h-meditation", [otherPeople], NOW)).toBeNull();
  });

  it("does not throw on a moment carrying no personIds at all", () => {
    const orphan = moment({ id: "m-orphan" });
    expect(() => daysSinceLast("p-ada", [orphan], NOW)).not.toThrow();
    expect(daysSinceLast("p-ada", [orphan], NOW)).toBeNull();
  });
});

describe("computeHealth — PRUNING", () => {
  it("is 'dormant' regardless of silence when rhythm is set", () => {
    const pruning = habit({
      attitude: "PRUNING",
      rhythm: WEEKLY,
    });
    expect(computeHealth(pruning, null, [], NOW)).toBe("dormant");
  });

  it("is 'unstated' when PRUNING has no rhythm", () => {
    const pruning = habit({ attitude: "PRUNING" });
    expect(computeHealth(pruning, null, [], NOW)).toBe("unstated");
  });
});

describe("computeHealth — PUSHING vs BUILDING tolerance", () => {
  it("PUSHING is stricter than BUILDING for the same count", () => {
    const rhythm: Rhythm = { period: "weekly", count: 5 };
    // 4 allocations out of 5 expected — BUILDING's tolerance=1 saves it, PUSHING's 0 does not
    const moments = [0, 1, 2, 3].map((i) =>
      moment({
        id: `m-${i}`,
        habitId: "h-1",
        day: dayBefore(NOW, i + 1),
      }),
    );

    const building = habit({ attitude: "BUILDING", rhythm });
    const pushing = habit({ attitude: "PUSHING", rhythm });

    expect(computeHealth(building, null, moments, NOW)).toBe("blooming");
    expect(computeHealth(pushing, null, moments, NOW)).toBe("wilting");
  });
});

describe("tentative moments (spec D5)", () => {
  const keeping = habit({ attitude: "KEEPING", rhythm: WEEKLY });

  const allocated = (day: string, over: Partial<Moment> = {}): Moment =>
    moment({
      id: `m-${day}`,
      habitId: "h-1",
      day,
      ...over,
    });

  it("countsAsAllocation rejects tentative, accepts absent and accepted", () => {
    expect(countsAsAllocation(allocated(dayBefore(NOW, 0)))).toBe(true);
    expect(
      countsAsAllocation(allocated(dayBefore(NOW, 0), { status: "accepted" })),
    ).toBe(true);
    expect(
      countsAsAllocation(allocated(dayBefore(NOW, 0), { status: "tentative" })),
    ).toBe(false);
  });

  it("computeHealth ignores a tentative moment for a KEEPING habit", () => {
    const moments = [
      allocated(dayBefore(NOW, 30)),
      allocated(dayBefore(NOW, 0), { status: "tentative" }),
    ];
    expect(computeHealth(keeping, null, moments, NOW)).toBe("wilting");
  });

  it("daysSinceLast ignores tentative moments", () => {
    const moments = [
      allocated(dayBefore(NOW, 10)),
      allocated(dayBefore(NOW, 1), { status: "tentative" }),
    ];
    expect(daysSinceLast("h-1", moments, NOW)).toBe(10);
  });
});

describe("moments planted after now", () => {
  // The domain's rule since mcp-server/health.ts stopped carrying its own copy
  // (see the parity gate in git history): a future moment has not happened yet.
  // A week read back from its close must not see the week after it.
  it("do not keep a KEEPING habit blooming, nor shorten daysSinceLast", () => {
    const keeping = habit({ attitude: "KEEPING", rhythm: WEEKLY });
    const moments = [
      moment({ day: dayBefore(NOW, 30) }),
      moment({ id: "m-2", day: dayBefore(NOW, -2) }),
    ];
    for (const m of moments) m.habitId = keeping.id;
    expect(computeHealth(keeping, null, moments, NOW)).toBe("wilting");
    expect(daysSinceLast(keeping.id, moments, NOW)).toBe(30);
  });
});
