import { describe, expect, it } from "vitest";
import type { AreaRef, FenceDeps, PhaseConfigRef } from "@/application/ports";
import {
  clearFences,
  declareWateringHours,
} from "@/application/use-cases/fences";
import type { RuleSpec } from "@/domain/intervention/RuleSpec";
import { validateRuleSpec } from "@/domain/intervention/RuleSpec";
import { Phase } from "@/domain/value-objects/Phase";
import { Weekday } from "@/domain/value-objects/Schedule";

const AREAS: AreaRef[] = [
  { id: "area-wellness", name: "Wellness" },
  { id: "area-craft", name: "Craft" },
];

const PHASE_CONFIGS: PhaseConfigRef[] = [
  { phase: Phase.MORNING, startHour: 6, endHour: 12 },
  { phase: Phase.AFTERNOON, startHour: 12, endHour: 18 },
  { phase: Phase.EVENING, startHour: 18, endHour: 22 },
];

function deps(opts?: {
  areas?: readonly AreaRef[];
  cycleId?: string | null;
  fences?: Record<string, RuleSpec>;
  phaseConfigs?: readonly PhaseConfigRef[];
}) {
  let stored: Record<string, RuleSpec> = { ...(opts?.fences ?? {}) };
  const d: FenceDeps = {
    store: {
      read: async () => ({ ...stored }),
      write: async (all) => {
        stored = all;
      },
    },
    tally: { read: async () => ({}) },
    garden: {
      areas: async () => opts?.areas ?? AREAS,
      cycles: async () => [],
      activeCycleId: async () =>
        opts?.cycleId === undefined ? "cycle-1" : opts.cycleId,
      phaseConfigs: async () => opts?.phaseConfigs ?? PHASE_CONFIGS,
    },
    newRuleId: () => "rule-1",
  };
  return { d, stored: () => stored };
}

describe("declareWateringHours", () => {
  it("writes rules keyed by derived id", async () => {
    const { d, stored } = deps();
    const result = await declareWateringHours(d, {
      name: "morning-wellness",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"], paths: ["/Users/rafa/Developer/themia"] },
      prompt: "Morning waters wellness.",
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    expect(result.declared.length).toBeGreaterThan(0);
    for (const rule of result.declared) {
      expect(rule.id).toMatch(/^watering:morning-wellness:/);
      expect(validateRuleSpec(rule)).toEqual([]);
      expect(stored()[rule.id]).toBeDefined();
    }
  });

  it("rejects when no season is running", async () => {
    const { d } = deps({ cycleId: null });
    const result = await declareWateringHours(d, {
      name: "test",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"] },
    });
    expect("problems" in result).toBe(true);
  });

  it("resolves phase names to hours", async () => {
    const { d } = deps();
    const result = await declareWateringHours(d, {
      name: "morning-wellness",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"] },
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    const gardenRule = result.declared.find(
      (r) => r.scope.surface === "garden",
    )!;
    const sched = gardenRule.primitives[0] as any;
    expect(sched.window.fromHour).toBe(6);
    expect(sched.window.toHour).toBe(12);
    expect(sched.window.cutFrom).toBe(Phase.MORNING);
  });

  it("resolves area names to ids", async () => {
    const { d } = deps();
    const result = await declareWateringHours(d, {
      name: "test",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"] },
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    const gardenRule = result.declared.find(
      (r) => r.scope.surface === "garden",
    )!;
    expect((gardenRule.scope as any).areaIds).toContain("area-craft");
  });

  it("is idempotent — re-declaring replaces", async () => {
    const { d, stored } = deps();
    await declareWateringHours(d, {
      name: "test",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"] },
    });
    const countAfterFirst = Object.keys(stored()).length;
    await declareWateringHours(d, {
      name: "test",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"] },
    });
    expect(Object.keys(stored()).length).toBe(countAfterFirst);
  });

  it("re-declaring with fewer surfaces clears the stale ones", async () => {
    const { d, stored } = deps();
    await declareWateringHours(d, {
      name: "test",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"], paths: ["/Users/rafa/Developer/themia"] },
    });
    expect(stored()["watering:test:session"]).toBeDefined();

    const result = await declareWateringHours(d, {
      name: "test",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"] },
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    expect(stored()["watering:test:session"]).toBeUndefined();
    expect(stored()["watering:test:garden"]).toBeDefined();
  });

  it("dry mode requires unlockNote", async () => {
    const { d } = deps();
    const result = await declareWateringHours(d, {
      name: "test",
      mode: "dry",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"] },
    });
    expect("problems" in result).toBe(true);
    if ("problems" in result) {
      expect(result.problems.join(" ")).toMatch(/unlock/i);
    }
  });
});

describe("clearFences with policy prefix", () => {
  it("clears all rules matching a policy prefix", async () => {
    const { d, stored } = deps();
    await declareWateringHours(d, {
      name: "morning-wellness",
      mode: "regular",
      window: { phases: [Phase.MORNING] },
      waters: ["Wellness"],
      restricts: { areas: ["Craft"], paths: ["/dev"] },
    });
    expect(Object.keys(stored()).length).toBeGreaterThan(0);

    const result = await clearFences(d, { policy: "morning-wellness" });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.cleared.length).toBeGreaterThan(0);
    expect(Object.keys(stored()).length).toBe(0);
  });
});

describe("declareWateringHours — rationed", () => {
  const base = {
    name: "youtube-weekend",
    mode: "rationed" as const,
    window: {
      fromHour: 0,
      toHour: 0,
      weekdays: [Weekday.SAT, Weekday.SUN] as const,
    },
    waters: ["Wellness"],
    restricts: {
      hosts: ["youtube.com", "m.youtube.com", "youtu.be"],
      excludeHosts: ["music.youtube.com"],
    },
    unlockNote: "Tomorrow.",
    reach: "navigation" as const,
    budgetMinutes: 60,
  };

  it("writes one rule per host with the budget", async () => {
    const { d, stored } = deps();
    const result = await declareWateringHours(d, base);
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.declared).toHaveLength(3);
    const p =
      stored()["watering:youtube-weekend:browser:youtube.com"].primitives[0];
    expect(p.kind === "schedule" && p.budget).toEqual({
      minutes: 60,
      pool: "youtube-weekend",
      exclude: ["music.youtube.com"],
    });
  });

  it("refuses rationed without budgetMinutes", async () => {
    const { budgetMinutes: _, ...rest } = base;
    const result = await declareWateringHours(deps().d, rest);
    expect("problems" in result && result.problems.join()).toMatch(
      /budgetMinutes/,
    );
  });

  it.each([0, 1441, 1.5])("refuses budgetMinutes %s", async (budgetMinutes) => {
    const result = await declareWateringHours(deps().d, {
      ...base,
      budgetMinutes,
    });
    expect("problems" in result && result.problems.join()).toMatch(
      /budgetMinutes/,
    );
  });

  it("refuses budgetMinutes on a dry policy", async () => {
    const result = await declareWateringHours(deps().d, {
      ...base,
      mode: "dry",
    });
    expect("problems" in result && result.problems.join()).toMatch(
      /budgetMinutes/,
    );
  });

  it("refuses an excluded host outside the pool", async () => {
    const result = await declareWateringHours(deps().d, {
      ...base,
      restricts: { ...base.restricts, excludeHosts: ["vimeo.com"] },
    });
    expect("problems" in result && result.problems.join()).toMatch(
      /excludeHosts/,
    );
  });

  it("refuses rationed on garden or session surfaces", async () => {
    const result = await declareWateringHours(deps().d, {
      ...base,
      restricts: { ...base.restricts, areas: ["Craft"] },
    });
    expect("problems" in result && result.problems.join()).toMatch(/rationed/);
  });
});
