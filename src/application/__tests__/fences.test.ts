import { describe, expect, it } from "vitest";
import type { AreaRef, CrossingRecord, FenceDeps } from "@/application/ports";
import {
  clearFences,
  declareFence,
  fenceReport,
} from "@/application/use-cases/fences";
import { carriesExit } from "@/domain/intervention/Primitive";
import type { RuleSpec } from "@/domain/intervention/RuleSpec";
import { validateRuleSpec } from "@/domain/intervention/RuleSpec";
import { sessionFenceRule } from "@/domain/intervention/rules/sessionFence";

const AREAS: AreaRef[] = [
  { id: "area-themia", name: "Themia" },
  { id: "area-craft", name: "Craft" },
];

function deps(opts?: {
  areas?: readonly AreaRef[];
  cycleId?: string | null;
  fences?: Record<string, RuleSpec>;
  tally?: Record<string, CrossingRecord>;
}) {
  let stored: Record<string, RuleSpec> = { ...(opts?.fences ?? {}) };
  let writes = 0;
  const d: FenceDeps = {
    store: {
      read: async () => ({ ...stored }),
      write: async (all) => {
        writes += 1;
        stored = all;
      },
    },
    tally: { read: async () => opts?.tally ?? {} },
    garden: {
      areas: async () => opts?.areas ?? AREAS,
      cycles: async () => [],
      activeCycleId: async () =>
        opts?.cycleId === undefined ? "cycle-1" : opts.cycleId,
      phaseConfigs: async () => [],
    },
    newRuleId: () => "rule-1",
  };
  return {
    d,
    stored: () => stored,
    writes: () => writes,
  };
}

const DECLARATION = {
  label: "Themia data",
  paths: ["/Users/rafa/Developer/themia"],
  areas: ["Themia"],
};

function existingFence(id: string, label: string): RuleSpec {
  return sessionFenceRule({
    id,
    label,
    description: label,
    serves: { cycleId: "cycle-0", areaId: "area-themia" },
    paths: [`/w/${id}`],
    encloses: ["area-themia"],
  });
}

describe("declareFence", () => {
  it("builds the rule with the domain factory and writes it keyed by id", async () => {
    const { d, stored } = deps();
    const result = await declareFence(d, DECLARATION);
    if ("problems" in result) throw new Error(result.problems.join("; "));

    expect(result.declared).toEqual(
      sessionFenceRule({
        id: "rule-1",
        label: "Themia data",
        description: result.declared.description,
        serves: { cycleId: "cycle-1", areaId: "area-themia" },
        paths: ["/Users/rafa/Developer/themia"],
        encloses: ["area-themia"],
      }),
    );
    expect(stored()["rule-1"]).toEqual(result.declared);
    expect(result.standing).toBe(1);
  });

  it("resolves areas by name, case-insensitively", async () => {
    const { d } = deps();
    const result = await declareFence(d, {
      ...DECLARATION,
      areas: ["themia", "CRAFT"],
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.declared.outcome.measure).toEqual({
      kind: "next_span_in",
      areaIds: ["area-themia", "area-craft"],
    });
    // `serves` points at the first enclosed plot's season intention.
    expect(result.declared.serves.areaId).toBe("area-themia");
  });

  it("declares a rule the domain validator accepts, whose every rung carries an exit", async () => {
    const { d } = deps();
    const result = await declareFence(d, DECLARATION);
    if ("problems" in result) throw new Error(result.problems.join("; "));

    expect(validateRuleSpec(result.declared)).toEqual([]);
    // The never-deny constraint, held structurally: gates and cooldowns are
    // the only rungs the factory builds, and both carry an exit by type.
    expect(result.declared.primitives.length).toBeGreaterThan(0);
    for (const rung of result.declared.primitives) {
      expect(carriesExit(rung)).toBe(true);
    }
  });

  it("refuses an unknown area and names the ones that exist", async () => {
    const { d, writes } = deps();
    const result = await declareFence(d, {
      ...DECLARATION,
      areas: ["Themio"],
    });
    if (!("problems" in result)) throw new Error("expected refusal");
    expect(result.problems.join(" ")).toContain('unknown area "Themio"');
    expect(result.problems.join(" ")).toContain("Themia");
    expect(writes()).toBe(0);
  });

  it("refuses when no cycle exists at all — `serves` needs a cycle to point at", async () => {
    const { d, writes } = deps({ cycleId: null });
    const result = await declareFence(d, DECLARATION);
    if (!("problems" in result)) throw new Error("expected refusal");
    expect(result.problems.join(" ")).toContain("no season exists");
    expect(writes()).toBe(0);
  });

  it("refuses relative paths, which the enforcing hook could never match", async () => {
    const { d, writes } = deps();
    const result = await declareFence(d, {
      ...DECLARATION,
      paths: ["Developer/themia"],
    });
    if (!("problems" in result)) throw new Error("expected refusal");
    expect(result.problems.join(" ")).toContain("not absolute");
    expect(writes()).toBe(0);
  });

  it("reports every problem at once, not just the first", async () => {
    const { d } = deps({ cycleId: null });
    const result = await declareFence(d, {
      label: "  ",
      paths: [],
      areas: ["nobody"],
    });
    if (!("problems" in result)) throw new Error("expected refusal");
    expect(result.problems.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps the caller's own words when a description is given", async () => {
    const { d } = deps();
    const result = await declareFence(d, {
      ...DECLARATION,
      description: "only Themia data this afternoon",
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.declared.description).toBe("only Themia data this afternoon");
  });

  it("adds beside standing fences rather than replacing them", async () => {
    const existing = existingFence("rule-0", "Craft");
    const { d, stored } = deps({ fences: { "rule-0": existing } });
    const result = await declareFence(d, DECLARATION);
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(Object.keys(stored())).toEqual(["rule-0", "rule-1"]);
    expect(result.standing).toBe(2);
  });
});

describe("clearFences", () => {
  it("takes one fence down by id and leaves the rest standing", async () => {
    const a = existingFence("rule-a", "A");
    const b = existingFence("rule-b", "B");
    const { d, stored } = deps({ fences: { "rule-a": a, "rule-b": b } });
    const result = await clearFences(d, { id: "rule-a" });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.cleared).toEqual([a]);
    expect(stored()).toEqual({ "rule-b": b });
  });

  it("takes everything down at once", async () => {
    const a = existingFence("rule-a", "A");
    const b = existingFence("rule-b", "B");
    const { d, stored } = deps({ fences: { "rule-a": a, "rule-b": b } });
    const result = await clearFences(d, { all: true });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.cleared).toHaveLength(2);
    expect(stored()).toEqual({});
  });

  it("refuses an unknown id and does not write", async () => {
    const a = existingFence("rule-a", "A");
    const { d, stored, writes } = deps({ fences: { "rule-a": a } });
    const result = await clearFences(d, { id: "rule-x" });
    if (!("problems" in result)) throw new Error("expected refusal");
    expect(result.problems.join(" ")).toContain("rule-a");
    expect(writes()).toBe(0);
    expect(stored()).toEqual({ "rule-a": a });
  });

  it("clearing nothing writes nothing", async () => {
    const { d, writes } = deps();
    const result = await clearFences(d, { all: true });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.cleared).toEqual([]);
    expect(writes()).toBe(0);
  });
});

describe("fenceReport", () => {
  it("reads a never-crossed fence as zero crossings, first rung next", async () => {
    const a = existingFence("rule-a", "A");
    const { d } = deps({ fences: { "rule-a": a } });
    const { fences } = await fenceReport(d);
    expect(fences).toHaveLength(1);
    expect(fences[0].crossings).toBe(0);
    expect(fences[0].lastCrossedAt).toBeNull();
    // First crossing lands on the confirmation gate — rung 1 of the ladder.
    expect(fences[0].nextRung).toEqual(a.primitives[0]);
  });

  it("merges the plugin's tally and walks the ladder to the rung that repeats", async () => {
    const a = existingFence("rule-a", "A");
    const { d } = deps({
      fences: { "rule-a": a },
      tally: { "rule-a": { crossings: 5, at: 1_700_000_000_000 } },
    });
    const { fences } = await fenceReport(d);
    expect(fences[0].crossings).toBe(5);
    expect(fences[0].lastCrossedAt).toBe(1_700_000_000_000);
    // Past the ladder's end the last rung repeats — same read as the hook's.
    expect(fences[0].nextRung).toEqual(a.primitives[a.primitives.length - 1]);
  });

  it("ignores tally entries for fences already down", async () => {
    const { d } = deps({
      tally: { "rule-gone": { crossings: 3, at: 1 } },
    });
    const { fences } = await fenceReport(d);
    expect(fences).toEqual([]);
  });
});
