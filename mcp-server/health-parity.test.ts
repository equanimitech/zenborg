/**
 * Gate before deleting one of the two health implementations: on a fixture
 * spanning every attitude, `mcp-server/health.ts` and the domain's
 * `HabitHealthService` must answer the same.
 */
import { describe, expect, it } from "vitest";
import type { Habit as DomainHabit } from "../src/domain/entities/Habit.ts";
import type { Moment as DomainMoment } from "../src/domain/entities/Moment.ts";
import { habitHealthService } from "../src/domain/services/HabitHealthService.ts";
import { computeHealth } from "./health.js";
import type { Habit, Moment, Rhythm } from "./vault.js";

const NOW = new Date(2026, 9, 9, 12, 0); // local noon, Friday 2026-10-09

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const stamp = "2026-01-01T00:00:00.000Z";
const habit = (
  id: string,
  attitude: Habit["attitude"],
  rhythm?: Rhythm,
  updatedAt = stamp,
): Habit => ({
  id,
  name: id,
  areaId: "a",
  attitude,
  ...(rhythm ? { rhythm } : {}),
  phase: null,
  tags: [],
  emoji: null,
  isArchived: false,
  order: 0,
  createdAt: stamp,
  updatedAt,
});

let seq = 0;
const moment = (
  habitId: string,
  ago: number,
  over: Partial<Moment> = {},
): Moment => ({
  id: `m${seq++}`,
  name: "m",
  areaId: "a",
  habitId,
  cycleId: null,
  cyclePlanId: null,
  phase: "MORNING",
  day: daysAgo(ago),
  order: 0,
  tags: null,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

const WEEKLY: Rhythm = { period: "weekly", count: 1 };
const THRICE: Rhythm = { period: "weekly", count: 3 };

const HABITS: Habit[] = [
  habit("unstated", null),
  habit("being", "BEING", WEEKLY),
  habit("beginning-few", "BEGINNING"),
  habit("beginning-many", "BEGINNING"),
  habit("keeping-fresh", "KEEPING", WEEKLY),
  habit("keeping-stale", "KEEPING", WEEKLY),
  habit("keeping-never", "KEEPING", WEEKLY),
  habit("keeping-no-rhythm", "KEEPING"),
  habit("returning-wilted", "RETURNING", WEEKLY),
  habit("returning-budding", "RETURNING", WEEKLY),
  habit("returning-blooming", "RETURNING", WEEKLY),
  habit("pruning", "PRUNING", WEEKLY),
  habit("building-new", "BUILDING", THRICE, NOW.toISOString()),
  habit("building-on", "BUILDING", THRICE),
  habit("building-off", "BUILDING", THRICE),
  habit("pushing-on", "PUSHING", THRICE),
  habit("pushing-off", "PUSHING", THRICE),
  habit("person", "KEEPING", WEEKLY),
];

const MOMENTS: Moment[] = [
  ...[1, 2].map((d) => moment("beginning-few", d)),
  ...[1, 2, 3, 4, 5].map((d) => moment("beginning-many", d)),
  moment("keeping-fresh", 3),
  moment("keeping-stale", 20),
  moment("keeping-stale", 2, { status: "tentative" }),
  moment("returning-wilted", 30),
  moment("returning-budding", 4),
  ...[2, 6, 9].map((d) => moment("returning-blooming", d)),
  ...[1, 3, 5].map((d) => moment("building-on", d)),
  moment("building-off", 40),
  ...[1, 2, 4].map((d) => moment("pushing-on", d)),
  moment("pushing-off", 2),
  moment("other", 1, { personIds: ["person"] }),
];

describe("health parity — mcp-server/health.ts vs HabitHealthService", () => {
  for (const h of HABITS) {
    it(`agrees on ${h.id}`, () => {
      const mcp = computeHealth(h, null, MOMENTS, NOW);
      const domain = habitHealthService.computeHealth(
        h as unknown as DomainHabit,
        null,
        MOMENTS as unknown as DomainMoment[],
        NOW,
      );
      expect(domain).toBe(mcp);
    });
  }

  it("diverges on a moment planted after `now`: the domain ignores it, which a past week needs", () => {
    const h = habit("keeping-future", "KEEPING", WEEKLY);
    const moments = [
      moment("keeping-future", 30),
      moment("keeping-future", -2),
    ];
    expect(computeHealth(h, null, moments, NOW)).toBe("blooming");
    expect(
      habitHealthService.computeHealth(
        h as unknown as DomainHabit,
        null,
        moments as unknown as DomainMoment[],
        NOW,
      ),
    ).toBe("wilting");
  });
});
