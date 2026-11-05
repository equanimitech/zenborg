// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Attitude } from "@/domain/value-objects/Attitude";
import { Phase } from "@/domain/value-objects/Phase";
import {
  type Rhythm,
  rhythmToCycleBudget,
} from "@/domain/value-objects/Rhythm";
import { Weekday } from "@/domain/value-objects/Schedule";
import {
  activeCycleId$,
  cyclePlans$,
  cycles$,
  habits$,
  moments$,
  storeHydrated$,
} from "@/infrastructure/state/store";
import { CycleService } from "../services/CycleService";

const makeHabit = (id: string, areaId = "area-1") => ({
  id,
  name: `Habit ${id}`,
  areaId,
  attitude: null,
  phase: null,
  tags: [],
  emoji: null,
  isArchived: false,
  order: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const makeCycle = (id: string) => ({
  id,
  name: `Cycle ${id}`,
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  intention: null,
  reflection: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("CycleService.budgetHabitToCycle (plan-only, derive paradigm)", () => {
  let service: CycleService;

  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});

    cycles$["cycle-1"].set(makeCycle("cycle-1"));
    activeCycleId$.set("cycle-1");
    habits$["habit-1"].set(makeHabit("habit-1"));

    service = new CycleService();
  });

  it("should create a plan with budgetedCount N and not materialize any moments", () => {
    const before = Object.keys(moments$.get()).length;
    const result = service.budgetHabitToCycle("cycle-1", "habit-1", 3);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(3);

    // Derive paradigm: moments are NOT materialized on budget
    expect(Object.keys(moments$.get()).length).toBe(before);
  });

  it("should update plan budgetedCount when incrementing; moments untouched", () => {
    service.budgetHabitToCycle("cycle-1", "habit-1", 2);
    const momentsBefore = Object.keys(moments$.get()).length;

    const result = service.budgetHabitToCycle("cycle-1", "habit-1", 3);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(3);

    // No moments spawned regardless of budget changes
    expect(Object.keys(moments$.get()).length).toBe(momentsBefore);
  });

  it("should update plan budgetedCount when decrementing; allocated moments survive", () => {
    service.budgetHabitToCycle("cycle-1", "habit-1", 3);

    // Simulate an independently-allocated moment for this habit
    moments$["m-alloc"].set({
      id: "m-alloc",
      name: "fiction",
      areaId: "area-1",
      habitId: "habit-1",
      cycleId: "cycle-1",
      cyclePlanId: Object.values(cyclePlans$.get())[0].id,
      day: "2026-02-01",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = service.budgetHabitToCycle("cycle-1", "habit-1", 1);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(1);

    // Allocated moment must survive — budgetHabitToCycle no longer cascades
    expect(moments$["m-alloc"].get()).toBeTruthy();
    expect(moments$["m-alloc"].day.get()).toBe("2026-02-01");
  });

  it("setting budget to 0 updates plan only; allocated moments survive", () => {
    service.budgetHabitToCycle("cycle-1", "habit-1", 3);

    moments$["m-alloc"].set({
      id: "m-alloc",
      name: "fiction",
      areaId: "area-1",
      habitId: "habit-1",
      cycleId: "cycle-1",
      cyclePlanId: Object.values(cyclePlans$.get())[0].id,
      day: "2026-02-01",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = service.budgetHabitToCycle("cycle-1", "habit-1", 0);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(0);

    // Allocated moment survives (orphaned from budget but on timeline)
    expect(moments$["m-alloc"].get()).toBeTruthy();
  });
});

describe("CycleService.endCycle", () => {
  let service: CycleService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));

    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});

    service = new CycleService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeOngoingCycle = (id: string, startDate: string) => ({
    id,
    name: `Cycle ${id}`,
    startDate,
    endDate: null,
    intention: null,
    reflection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const makeFiniteCycle = (id: string, startDate: string, endDate: string) => ({
    id,
    name: `Cycle ${id}`,
    startDate,
    endDate,
    intention: null,
    reflection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("returns an error when the cycle does not exist", () => {
    const result = service.endCycle("nonexistent");
    expect("error" in result).toBe(true);
  });

  it("defaults endDate to today when no next cycle exists", () => {
    cycles$.c1.set(makeOngoingCycle("c1", "2026-03-31"));

    const result = service.endCycle("c1");

    expect("error" in result).toBe(false);
    expect(cycles$.c1.endDate.get()).toBe("2026-04-19");
  });

  it("defaults endDate to day before next cycle when next cycle is inside today", () => {
    cycles$.vipassana.set(makeOngoingCycle("vipassana", "2026-03-31"));
    cycles$.paris.set(makeFiniteCycle("paris", "2026-04-11", "2026-04-16"));

    const result = service.endCycle("vipassana");

    expect("error" in result).toBe(false);
    expect(cycles$.vipassana.endDate.get()).toBe("2026-04-10");
  });

  it("uses an explicit endDate when provided", () => {
    cycles$.c1.set(makeOngoingCycle("c1", "2026-03-31"));

    const result = service.endCycle("c1", "2026-04-05");

    expect("error" in result).toBe(false);
    expect(cycles$.c1.endDate.get()).toBe("2026-04-05");
  });

  it("surfaces a descriptive error when the chosen endDate overlaps", () => {
    cycles$.vipassana.set(makeOngoingCycle("vipassana", "2026-03-31"));
    cycles$.paris.set(makeFiniteCycle("paris", "2026-04-11", "2026-04-16"));

    const result = service.endCycle("vipassana", "2026-04-19");

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Paris/i);
      expect(result.error).toMatch(/Apr/);
    }
  });

  it("allows ending exactly at the next cycle's start date (touching endpoint)", () => {
    cycles$.a.set(makeOngoingCycle("a", "2026-03-31"));
    cycles$.b.set(makeFiniteCycle("b", "2026-04-11", "2026-04-16"));

    const result = service.endCycle("a", "2026-04-11");

    expect("error" in result).toBe(false);
    expect(cycles$.a.endDate.get()).toBe("2026-04-11");
  });
});

describe("CycleService.budgetHabitToCycleWithOptions — rhythm derivation", () => {
  let service: CycleService;

  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});
    // 28-day cycle: 2026-02-01 .. 2026-02-28 inclusive
    cycles$["cycle-1"].set({
      ...makeCycle("cycle-1"),
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    activeCycleId$.set("cycle-1");
    service = new CycleService();
  });

  it("derives count from habit rhythm when count omitted", () => {
    const rhythm: Rhythm = { period: "weekly", count: 3 };
    habits$["habit-1"].set({ ...makeHabit("habit-1"), rhythm });

    const momentsBefore = Object.keys(moments$.get()).length;
    const result = service.budgetHabitToCycleWithOptions(
      "cycle-1",
      "habit-1",
      {},
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    // rhythmToCycleBudget({weekly, 3}, 28) = round(3 * 28 / 7) = 12
    expect(rhythmToCycleBudget(rhythm, 28)).toBe(12);
    expect(result.budgetedCount).toBe(12);
    // Derive paradigm: plan written, moments unchanged
    expect(Object.keys(moments$.get()).length).toBe(momentsBefore);
  });

  it("uses explicit count when both rhythm and count given", () => {
    habits$["habit-1"].set({
      ...makeHabit("habit-1"),
      rhythm: { period: "weekly", count: 3 },
    });

    const momentsBefore = Object.keys(moments$.get()).length;
    const result = service.budgetHabitToCycleWithOptions("cycle-1", "habit-1", {
      count: 5,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(5);
    // Derive paradigm: plan written, moments unchanged
    expect(Object.keys(moments$.get()).length).toBe(momentsBefore);
  });

  it("stores rhythmOverride on the CyclePlan", () => {
    habits$["habit-1"].set(makeHabit("habit-1"));
    const override: Rhythm = { period: "monthly", count: 2 };

    const result = service.budgetHabitToCycleWithOptions("cycle-1", "habit-1", {
      rhythmOverride: override,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.rhythmOverride).toEqual(override);
  });

  it("errors when neither count, rhythm, nor override are supplied", () => {
    habits$["habit-1"].set(makeHabit("habit-1"));
    const result = service.budgetHabitToCycleWithOptions(
      "cycle-1",
      "habit-1",
      {},
    );
    expect("error" in result).toBe(true);
  });
});

describe("CycleService.getCyclePlanningProposals", () => {
  let service: CycleService;

  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    habits$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    // 28-day cycle
    cycles$["cycle-1"].set({
      ...makeCycle("cycle-1"),
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    activeCycleId$.set("cycle-1");
    service = new CycleService();
  });

  it("includes KEEPING habits with rhythm (wilting or on-rhythm)", () => {
    habits$["h-keep"].set({
      ...makeHabit("h-keep"),
      attitude: Attitude.KEEPING,
      rhythm: { period: "monthly", count: 1 },
    });
    const proposals = service.getCyclePlanningProposals("cycle-1");
    const row = proposals.find((p) => p.habitId === "h-keep");
    expect(row).toBeDefined();
    expect(row?.reason === "wilting" || row?.reason === "on-rhythm").toBe(true);
  });

  it("includes BUILDING habits with rhythm", () => {
    habits$["h-build"].set({
      ...makeHabit("h-build"),
      attitude: Attitude.BUILDING,
      rhythm: { period: "weekly", count: 3 },
    });
    const proposals = service.getCyclePlanningProposals("cycle-1");
    expect(proposals.find((p) => p.habitId === "h-build")).toBeDefined();
  });

  it("excludes BEING habits", () => {
    habits$["h-being"].set({
      ...makeHabit("h-being"),
      attitude: Attitude.BEING,
    });
    const proposals = service.getCyclePlanningProposals("cycle-1");
    expect(proposals.find((p) => p.habitId === "h-being")).toBeUndefined();
  });

  it("excludes habits without an attitude", () => {
    habits$["h-none"].set(makeHabit("h-none")); // attitude=null
    const proposals = service.getCyclePlanningProposals("cycle-1");
    expect(proposals.find((p) => p.habitId === "h-none")).toBeUndefined();
  });

  it("suggestedCount equals rhythmToCycleBudget for 28-day cycle", () => {
    habits$["h-build"].set({
      ...makeHabit("h-build"),
      attitude: Attitude.BUILDING,
      rhythm: { period: "weekly", count: 3 },
    });
    const proposals = service.getCyclePlanningProposals("cycle-1");
    const row = proposals.find((p) => p.habitId === "h-build")!;
    // weekly × 3 over 28 days = 12
    expect(row.suggestedCount).toBe(12);
  });
});

describe("CycleService.getCycleReview", () => {
  let service: CycleService;

  const makeBaseMoment = (id: string) => ({
    id,
    name: `moment-${id}`,
    areaId: "area-1",
    habitId: null as string | null,
    cycleId: "cycle-1" as string | null,
    cyclePlanId: null as string | null,
    phase: Phase.MORNING as Phase,
    day: null as string | null,
    order: 0,
    emoji: null,
    tags: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const makeMoment = (
    id: string,
    overrides: Partial<ReturnType<typeof makeBaseMoment>> = {},
  ) => ({
    ...makeBaseMoment(id),
    ...overrides,
  });

  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    habits$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    cycles$["cycle-1"].set({
      ...makeCycle("cycle-1"),
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    activeCycleId$.set("cycle-1");
    habits$["habit-1"].set(makeHabit("habit-1"));
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "cycle-1",
      habitId: "habit-1",
      budgetedCount: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    service = new CycleService();
  });

  it("returns per-habit actualCount equal to allocated moments", () => {
    moments$.m1.set(
      makeMoment("m1", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-05",
      }),
    );
    moments$.m2.set(
      makeMoment("m2", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-10",
      }),
    );
    moments$.m3.set(
      makeMoment("m3", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-20",
      }),
    );

    const review = service.getCycleReview("cycle-1");
    expect(review).not.toBeNull();
    expect(review?.habits[0].actualCount).toBe(3);
  });

  it("returns unplannedMoments for moments without cyclePlanId", () => {
    moments$.m1.set(
      makeMoment("m1", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-05",
      }),
    );
    moments$.m2.set(
      makeMoment("m2", {
        habitId: "habit-1",
        cyclePlanId: null,
        day: "2026-02-10",
      }),
    );

    const review = service.getCycleReview("cycle-1");
    expect(review?.unplannedMoments).toHaveLength(1);
    expect(review?.unplannedMoments[0].id).toBe("m2");
  });

  it("includes firstAllocation and lastAllocation", () => {
    moments$.m1.set(
      makeMoment("m1", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-05",
      }),
    );
    moments$.m2.set(
      makeMoment("m2", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-25",
      }),
    );

    const review = service.getCycleReview("cycle-1");
    expect(review?.habits[0].firstAllocation).toBe("2026-02-05");
    expect(review?.habits[0].lastAllocation).toBe("2026-02-25");
  });

  it("includes longestGapDays", () => {
    moments$.m1.set(
      makeMoment("m1", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-01",
      }),
    );
    moments$.m2.set(
      makeMoment("m2", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-05",
      }),
    );
    moments$.m3.set(
      makeMoment("m3", {
        habitId: "habit-1",
        cyclePlanId: "plan-1",
        day: "2026-02-20",
      }),
    );

    const review = service.getCycleReview("cycle-1");
    expect(review?.habits[0].longestGapDays).toBe(15);
  });
});

describe("CycleService.countAllocatedForPlan", () => {
  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});
  });

  it("returns 0 when no moments link to plan", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(service.countAllocatedForPlan("plan-1")).toBe(0);
  });

  it("counts only allocated moments (day + phase set)", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    moments$["m-1"].set({
      id: "m-1",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    moments$["m-2"].set({
      id: "m-2",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: null,
      phase: null,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(service.countAllocatedForPlan("plan-1")).toBe(1);
  });
});

describe("CycleService.allocateFromPlan", () => {
  const cycle = {
    id: "c-1",
    name: "Cycle",
    startDate: "2026-04-23",
    endDate: "2026-05-06",
    intention: null,
    reflection: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const habit = {
    id: "h-1",
    name: "fiction",
    areaId: "a-1",
    attitude: null,
    phase: null,
    tags: [],
    emoji: "📖",
    isArchived: false,
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});

    cycles$[cycle.id].set(cycle);
    habits$[habit.id].set(habit);
  });

  it("errors when no plan exists", () => {
    const service = new CycleService();
    const result = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
    });
    expect(result).toEqual({
      error: expect.stringContaining("No budget"),
    });
  });

  it("creates an allocated moment and increases plan's allocated count", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.name).toBe("fiction");
    expect(result.day).toBe("2026-04-24");
    expect(result.phase).toBe("MORNING");
    expect(result.cyclePlanId).toBe("plan-1");
    expect(service.countAllocatedForPlan("plan-1")).toBe(1);
  });

  it("errors when already over budget", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const first = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
    });
    expect("error" in first).toBe(false);
    const second = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-25",
      phase: Phase.MORNING,
    });
    expect(second).toEqual({
      error: expect.stringContaining("Over budget"),
    });
  });

  it("allocates any number of moments to the same (day, phase)", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    for (let i = 0; i < 3; i++) {
      moments$[`m-${i}`].set({
        id: `m-${i}`,
        name: "other",
        areaId: "a-1",
        habitId: null,
        cycleId: "c-1",
        cyclePlanId: null,
        day: "2026-04-24",
        phase: Phase.MORNING,
        order: i,
        tags: [],
        emoji: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    const result = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.order).toBe(3);
  });

  it("errors when day outside cycle range (endDate set)", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-06-01",
      phase: Phase.MORNING,
    });
    expect(result).toEqual({ error: expect.stringContaining("outside") });
  });

  it("inherits the habit's schedule timing onto the allocated moment", () => {
    const service = new CycleService();
    habits$[habit.id].set({
      ...habit,
      schedule: {
        weekdays: [Weekday.FRI],
        startTime: "12:00",
        durationMin: 90,
      },
    });
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.startTime).toBe("12:00");
    expect(result.durationMin).toBe(90);
  });

  it("leaves ambient habits without any timing", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.startTime).toBeUndefined();
    expect(result.durationMin).toBeUndefined();
  });

  it("errors when habit archived", () => {
    const service = new CycleService();
    habits$[habit.id].set({ ...habit, isArchived: true });
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.allocateFromPlan({
      cycleId: "c-1",
      habitId: "h-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
    });
    expect(result).toEqual({
      error: expect.stringContaining("archived"),
    });
  });
});

describe("CycleService.unallocateMoment", () => {
  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});
  });

  it("deletes plan-linked moment row", () => {
    const service = new CycleService();
    moments$["m-1"].set({
      id: "m-1",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.unallocateMoment("m-1");
    expect(result).toEqual({ ok: true });
    expect(moments$["m-1"].get()).toBeUndefined();
  });

  it("errors when moment not found", () => {
    const service = new CycleService();
    expect(service.unallocateMoment("missing")).toEqual({
      error: expect.stringContaining("not found"),
    });
  });

  it("rejects spontaneous moments (cyclePlanId === null)", () => {
    const service = new CycleService();
    moments$["m-1"].set({
      id: "m-1",
      name: "spontaneous",
      areaId: "a-1",
      habitId: null,
      cycleId: "c-1",
      cyclePlanId: null,
      day: "2026-04-24",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(service.unallocateMoment("m-1")).toEqual({
      error: expect.stringContaining("spontaneous"),
    });
    expect(moments$["m-1"].get()?.id).toBe("m-1");
  });
});

describe("CycleService.reconcileLegacyDeckMoments", () => {
  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});
  });

  it("deletes plan-linked moments with day + phase null", () => {
    const service = new CycleService();
    moments$["m-1"].set({
      id: "m-1",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: null,
      phase: null,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.reconcileLegacyDeckMoments();
    expect(result.deleted).toBe(1);
    expect(moments$["m-1"].get()).toBeUndefined();
  });

  it("preserves allocated moments and spontaneous moments", () => {
    const service = new CycleService();
    moments$.allocated.set({
      id: "allocated",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    moments$.spontaneous.set({
      id: "spontaneous",
      name: "ad-hoc",
      areaId: "a-1",
      habitId: null,
      cycleId: "c-1",
      cyclePlanId: null,
      day: null,
      phase: null,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.reconcileLegacyDeckMoments();
    expect(result.deleted).toBe(0);
    expect(moments$.allocated.get()?.id).toBe("allocated");
    expect(moments$.spontaneous.get()?.id).toBe("spontaneous");
  });
});

describe("CycleService.decrementHabitBudget (floored at allocatedCount)", () => {
  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});

    cycles$["c-1"].set({
      id: "c-1",
      name: "Cycle",
      startDate: "2026-04-23",
      endDate: "2026-05-06",
      intention: null,
      reflection: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    habits$["h-1"].set({
      id: "h-1",
      name: "fiction",
      areaId: "a-1",
      attitude: null,
      phase: null,
      tags: [],
      emoji: null,
      isArchived: false,
      order: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it("no-ops when decrement would dip below allocatedCount", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    moments$["m-1"].set({
      id: "m-1",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    moments$["m-2"].set({
      id: "m-2",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: "2026-04-25",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.decrementHabitBudget("c-1", "h-1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(2); // unchanged
  });

  it("decrements when allocatedCount leaves headroom", () => {
    const service = new CycleService();
    cyclePlans$["plan-1"].set({
      id: "plan-1",
      cycleId: "c-1",
      habitId: "h-1",
      budgetedCount: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    moments$["m-1"].set({
      id: "m-1",
      name: "fiction",
      areaId: "a-1",
      habitId: "h-1",
      cycleId: "c-1",
      cyclePlanId: "plan-1",
      day: "2026-04-24",
      phase: Phase.MORNING,
      order: 0,
      tags: [],
      emoji: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = service.decrementHabitBudget("c-1", "h-1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(3);
  });
});

describe("budgetHabitToCycle (derive paradigm)", () => {
  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});
  });

  it("writes plan only; moments.json untouched", () => {
    const service = new CycleService();
    cycles$["c-1"].set({
      id: "c-1",
      name: "Cycle",
      startDate: "2026-04-23",
      endDate: "2026-05-06",
      intention: null,
      reflection: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    habits$["h-1"].set({
      id: "h-1",
      name: "fiction",
      areaId: "a-1",
      attitude: null,
      phase: null,
      tags: [],
      emoji: null,
      isArchived: false,
      order: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const before = Object.keys(moments$.get()).length;
    const result = service.budgetHabitToCycle("c-1", "h-1", 5);
    expect("error" in result).toBe(false);
    const after = Object.keys(moments$.get()).length;
    expect(after).toBe(before); // no new moments spawned
    if ("error" in result) return;
    expect(result.budgetedCount).toBe(5);
  });
});

describe("CycleService.getCyclePlanningProposals — daysSinceLast agrees with currentHealth", () => {
  let service: CycleService;

  /**
   * Proposals read the wall clock (`new Date()`), so days are expressed
   * relative to the real today rather than a frozen instant.
   */
  const isoDay = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  /**
   * The day `n` local calendar days before today. Shifts the calendar date
   * rather than subtracting milliseconds, so a DST boundary cannot slide it.
   */
  const daysAgo = (n: number) => {
    const shifted = new Date();
    shifted.setDate(shifted.getDate() - n);
    return isoDay(shifted);
  };

  const WEEKLY: Rhythm = { period: "weekly", count: 1 }; // 7-day threshold

  const makePerson = (id: string, name: string) => ({
    ...makeHabit(id),
    name,
    attitude: Attitude.KEEPING,
    rhythm: WEEKLY,
  });

  const makeMoment = (
    id: string,
    overrides: Partial<{
      habitId: string | null;
      day: string | null;
      personIds: string[];
    }> = {},
  ) => ({
    id,
    name: "dinner",
    areaId: "area-1",
    habitId: null as string | null,
    cycleId: null as string | null,
    cyclePlanId: null as string | null,
    phase: Phase.EVENING as Phase,
    day: daysAgo(2) as string | null,
    order: 0,
    emoji: null,
    tags: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    habits$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    cycles$["cycle-1"].set({
      ...makeCycle("cycle-1"),
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    activeCycleId$.set("cycle-1");
    service = new CycleService();
  });

  it("counts a moment that names the habit only in personIds", () => {
    // `habitId: null` and the id only in `personIds` — the `||` cannot
    // short-circuit on a habitId match, so this exercises the widened clause.
    habits$["p-ada"].set(makePerson("p-ada", "Ada"));
    moments$["m-group-dinner"].set(
      makeMoment("m-group-dinner", { personIds: ["p-cal", "p-ada"] }),
    );

    const row = service
      .getCyclePlanningProposals("cycle-1")
      .find((p) => p.habitId === "p-ada");

    expect(row).toBeDefined();
    expect(row?.daysSinceLast).toBe(2);
    expect(row?.currentHealth).toBe("blooming");
  });

  it("no longer emits a stale pre-migration day count beside a blooming", () => {
    // The reported defect: currentHealth and daysSinceLast land in the SAME
    // proposal object. A person seen at a group dinner two days ago, whose last
    // directly-planted moment is 400 days old, read as blooming / 400 days.
    habits$["p-ada"].set(makePerson("p-ada", "Ada"));
    moments$["m-stale"].set(
      makeMoment("m-stale", { habitId: "p-ada", day: daysAgo(400) }),
    );
    moments$["m-group-dinner"].set(
      makeMoment("m-group-dinner", { personIds: ["p-ada"] }),
    );

    const row = service
      .getCyclePlanningProposals("cycle-1")
      .find((p) => p.habitId === "p-ada");

    expect(row?.currentHealth).toBe("blooming");
    expect(row?.daysSinceLast).toBe(2);
  });

  it("leaves an ordinary habit's daysSinceLast untouched", () => {
    // No-regression pin: `personIds` can never hold an ordinary habit's own id,
    // so the widened predicate is inert for every non-person record.
    habits$["h-meditation"].set({
      ...makeHabit("h-meditation"),
      name: "meditation",
      attitude: Attitude.KEEPING,
      rhythm: WEEKLY,
    });
    moments$["m-own"].set(makeMoment("m-own", { habitId: "h-meditation" }));
    moments$["m-other"].set(
      makeMoment("m-other", {
        day: daysAgo(1),
        personIds: ["p-ada", "p-cal"],
      }),
    );

    const row = service
      .getCyclePlanningProposals("cycle-1")
      .find((p) => p.habitId === "h-meditation");

    expect(row?.daysSinceLast).toBe(2);
    expect(row?.currentHealth).toBe("blooming");
  });

  it("stays null for a habit whose only moments name other people", () => {
    habits$["h-meditation"].set({
      ...makeHabit("h-meditation"),
      name: "meditation",
      attitude: Attitude.KEEPING,
      rhythm: WEEKLY,
    });
    moments$["m-other"].set(
      makeMoment("m-other", { personIds: ["p-ada", "p-cal"] }),
    );

    const row = service
      .getCyclePlanningProposals("cycle-1")
      .find((p) => p.habitId === "h-meditation");

    expect(row?.daysSinceLast).toBeNull();
    expect(row?.currentHealth).toBe("wilting");
  });
});

describe("CycleService.updateCycle — reflection provenance", () => {
  let service: CycleService;

  const season = (over: Record<string, unknown> = {}) => ({
    id: "c",
    name: "Avalon Spring",
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    intention: null,
    reflection: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  });

  beforeEach(() => {
    moments$.set({});
    cyclePlans$.set({});
    cycles$.set({});
    activeCycleId$.set(null);
    storeHydrated$.set(false);
    habits$.set({});

    service = new CycleService();
  });

  it("stamps a reflection edited in the app as human-written", () => {
    cycles$.set({ c: season() as never });

    service.updateCycle("c", { reflection: "The season held Avalon." });

    expect(cycles$.c.reflectionSource.get()).toBe("human");
  });

  it("promotes a machine draft to human once you edit it", () => {
    cycles$.set({
      c: season({
        reflection: "Drafted prose.",
        reflectionSource: "machine",
      }) as never,
    });

    service.updateCycle("c", { reflection: "My own words." });

    expect(cycles$.c.reflectionSource.get()).toBe("human");
  });

  it("clears the stamp when the reflection is cleared", () => {
    cycles$.set({
      c: season({ reflection: "Gone.", reflectionSource: "human" }) as never,
    });

    service.updateCycle("c", { reflection: null });

    expect(cycles$.c.reflectionSource.get()).toBeNull();
  });

  it("leaves provenance alone when editing something else", () => {
    cycles$.set({
      c: season({
        reflection: "Drafted prose.",
        reflectionSource: "machine",
      }) as never,
    });

    service.updateCycle("c", { intention: "Read the tide." });

    expect(cycles$.c.reflectionSource.get()).toBe("machine");
    expect(cycles$.c.reflection.get()).toBe("Drafted prose.");
  });

  it("keeps season intentions when the cycle is renamed", () => {
    cycles$.set({
      c: season({
        areaIntentions: { "area-1": "settle in slowly" },
        people: { "person-1": "", "person-2": "weekly calls" },
      }) as never,
    });

    service.updateCycle("c", { name: "Avalon Summer" });

    expect(cycles$.c.name.get()).toBe("Avalon Summer");
    expect(cycles$.c.areaIntentions.get()).toEqual({
      "area-1": "settle in slowly",
    });
    expect(cycles$.c.people.get()).toEqual({
      "person-1": "",
      "person-2": "weekly calls",
    });
  });

  it("lets a caller name the author explicitly", () => {
    cycles$.set({ c: season() as never });

    service.updateCycle("c", {
      reflection: "Drafted prose.",
      reflectionSource: "machine",
    });

    expect(cycles$.c.reflectionSource.get()).toBe("machine");
  });
});
