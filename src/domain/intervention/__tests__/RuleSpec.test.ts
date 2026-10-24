import { describe, expect, it } from "vitest";
import { type RuleSpec, validateRuleSpec } from "../RuleSpec";

function ruleWithScope(scope: any): RuleSpec {
  return {
    id: "test-rule",
    name: "test",
    description: "test",
    scope,
    mechanism: "friction",
    fadeEligibility: "manual",
    outcome: {
      claim: "attention returns",
      measure: { kind: "next_span_in", areaIds: ["area-1"] },
      windowMs: 600_000,
    },
    serves: { cycleId: "c-1", areaId: "area-1" },
    deliveryProbability: 1,
    primitives: [
      {
        kind: "gate",
        trigger: { type: "entry" },
        frictionType: { type: "confirmation" },
        proceedAffordance: { label: "Cross", action: { type: "continue" } },
      },
    ],
  };
}

const rule: RuleSpec = {
  id: "rule-area-drift",
  name: "area drift",
  description: "attention resolved to an unplanted area",
  scope: { surface: "session", paths: ["~/Developer/equanimitech"] },
  mechanism: "friction",
  fadeEligibility: "manual",
  deliveryProbability: 0.5,
  outcome: {
    claim: "attention returns to a planted moment",
    measure: { kind: "next_span_in", areaIds: ["area-equanimitech"] },
    windowMs: 600_000,
  },
  serves: { cycleId: "cycle-1", areaId: "area-equanimitech" },
  primitives: [
    {
      kind: "gate",
      trigger: { type: "entry" },
      frictionType: { type: "intention", prompt: "what is this for?" },
      proceedAffordance: { label: "proceed", action: { type: "continue" } },
    },
  ],
};

describe("validateRuleSpec", () => {
  it("accepts a well-formed rule", () => {
    expect(validateRuleSpec(rule)).toEqual([]);
  });

  it("accepts a click-trigger gate and rejects one with an empty primary selector", () => {
    const click = (primary: string): RuleSpec => ({
      ...rule,
      primitives: [
        {
          kind: "gate",
          trigger: { type: "click", selectors: { primary, fallbacks: [".row button"] } },
          frictionType: { type: "confirmation" },
          proceedAffordance: { label: "One more", action: { type: "continue" } },
        },
      ],
    });
    expect(validateRuleSpec(click("button.play"))).toEqual([]);
    expect(validateRuleSpec(click("  "))).toEqual([
      "gate.trigger.selectors.primary must name a selector",
    ]);
  });

  it("rejects a rule with no primitives", () => {
    expect(validateRuleSpec({ ...rule, primitives: [] })).toContain(
      "a rule must carry at least one primitive",
    );
  });

  it("rejects a deliveryProbability outside [0, 1]", () => {
    expect(validateRuleSpec({ ...rule, deliveryProbability: 1.5 })).toContain(
      "deliveryProbability must be between 0 and 1",
    );
    expect(validateRuleSpec({ ...rule, deliveryProbability: -0.1 })).toContain(
      "deliveryProbability must be between 0 and 1",
    );
  });

  it("rejects a non-positive outcome window", () => {
    expect(
      validateRuleSpec({ ...rule, outcome: { ...rule.outcome, windowMs: 0 } }),
    ).toContain("outcome.windowMs must be positive");
  });

  it("rejects an empty outcome claim", () => {
    expect(
      validateRuleSpec({ ...rule, outcome: { ...rule.outcome, claim: "  " } }),
    ).toContain("outcome.claim must say what the rule should shift");
  });

  it("rejects a browser scope with no matches", () => {
    expect(
      validateRuleSpec({
        ...rule,
        scope: { surface: "browser", domain: "linkedin.com", matches: [] },
      }),
    ).toContain("scope.matches must be non-empty");
  });

  it("rejects a global browser match pattern", () => {
    expect(
      validateRuleSpec({
        ...rule,
        scope: {
          surface: "browser",
          domain: "linkedin.com",
          matches: ["*://*/*"],
        },
      }),
    ).toContain("scope.matches must not be global");
  });

  it("accumulates several problems rather than reporting only the first", () => {
    const problems = validateRuleSpec({
      ...rule,
      primitives: [],
      deliveryProbability: 2,
    });
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateRuleSpec — garden scope", () => {
  it("accepts a garden scope with non-empty areaIds", () => {
    const rule = ruleWithScope({ surface: "garden", areaIds: ["area-craft"] });
    expect(validateRuleSpec(rule)).toEqual([]);
  });

  it("rejects a garden scope with empty areaIds", () => {
    const rule = ruleWithScope({ surface: "garden", areaIds: [] });
    expect(validateRuleSpec(rule)).toContainEqual(
      expect.stringContaining("areaIds"),
    );
  });
});

describe("validateRuleSpec — session scope with tools", () => {
  it("accepts a session scope with match and tools", () => {
    const rule = ruleWithScope({
      surface: "session",
      paths: ["/Users/rafa/Developer"],
      match: "inside",
      tools: ["Edit", "Write"],
    });
    expect(validateRuleSpec(rule)).toEqual([]);
  });

  it("accepts a session scope without match (defaults to outside)", () => {
    const rule = ruleWithScope({
      surface: "session",
      paths: ["/Users/rafa/Developer"],
    });
    expect(validateRuleSpec(rule)).toEqual([]);
  });
});
