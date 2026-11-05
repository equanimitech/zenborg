import { describe, expect, it } from "vitest";
import { Phase } from "@/domain/value-objects/Phase";
import { Weekday } from "@/domain/value-objects/Schedule";
import { carriesExit } from "../../Primitive";
import { validateRuleSpec } from "../../RuleSpec";
import {
  type WateringHoursInput,
  wateringHoursRules,
  wateringPolicyId,
} from "../wateringHours";

const serves = { cycleId: "c-1", areaId: "area-wellness" };

const REGULAR_INPUT: WateringHoursInput = {
  policyName: "morning-wellness",
  mode: "regular",
  window: { fromHour: 6, toHour: 12, cutFrom: Phase.MORNING },
  serves,
  returnsTo: ["area-wellness"],
  restricts: {
    areas: ["area-craft"],
    paths: ["/Users/rafa/Developer/themia"],
  },
  prompt: "Morning waters wellness. What brings you to craft?",
};

const DRY_INPUT: WateringHoursInput = {
  policyName: "mindful-monday",
  mode: "dry",
  window: { fromHour: 0, toHour: 24, weekdays: [Weekday.MON] },
  serves,
  returnsTo: ["area-wellness"],
  restricts: {
    hosts: ["netflix.com"],
    paths: ["/Users/rafa/Developer"],
    tools: ["Edit", "Write"],
  },
  unlockNote: "Re-declare watering hours tomorrow.",
};

const BY_HAND_INPUT: WateringHoursInput = {
  policyName: "artisanal-tuesday",
  mode: "by_hand",
  window: { fromHour: 0, toHour: 24, weekdays: [Weekday.TUE] },
  serves,
  returnsTo: ["area-craft"],
  restricts: {
    paths: ["/Users/rafa/Developer"],
    tools: ["Edit", "Write"],
  },
  prompt: "Irrigation is off today. By hand?",
};

describe("wateringPolicyId", () => {
  it("derives deterministic ids", () => {
    expect(wateringPolicyId("mindful-monday", "session")).toBe(
      "watering:mindful-monday:session",
    );
    expect(wateringPolicyId("mindful-monday", "browser", "netflix.com")).toBe(
      "watering:mindful-monday:browser:netflix.com",
    );
  });
});

describe("wateringHoursRules — regular mode", () => {
  const rules = wateringHoursRules(REGULAR_INPUT);

  it("generates one rule per surface declared in restricts", () => {
    expect(rules.length).toBe(2); // garden + session
    const surfaces = rules.map((r) => r.scope.surface);
    expect(surfaces).toContain("garden");
    expect(surfaces).toContain("session");
  });

  it("all rules pass the validator", () => {
    for (const rule of rules) {
      expect(validateRuleSpec(rule)).toEqual([]);
    }
  });

  it("all primitives carry exits (invariant 6)", () => {
    for (const rule of rules) {
      for (const p of rule.primitives) {
        expect(carriesExit(p)).toBe(true);
      }
    }
  });

  it("wraps gates in schedule primitives", () => {
    for (const rule of rules) {
      for (const p of rule.primitives) {
        expect(p.kind).toBe("schedule");
        if (p.kind === "schedule") {
          expect(p.window.fromHour).toBe(6);
          expect(p.window.toHour).toBe(12);
          expect(p.wraps.kind).toBe("gate");
        }
      }
    }
  });

  it("uses derived ids with policy prefix", () => {
    for (const rule of rules) {
      expect(rule.id).toMatch(/^watering:morning-wellness:/);
    }
  });

  it("session scope uses match: inside", () => {
    const session = rules.find((r) => r.scope.surface === "session")!;
    expect((session.scope as any).match).toBe("inside");
  });

  it("uses friction mechanism", () => {
    for (const rule of rules) {
      expect(rule.mechanism).toBe("friction");
    }
  });

  it("delivers always (not under test)", () => {
    for (const rule of rules) {
      expect(rule.deliveryProbability).toBe(1);
    }
  });

  it("builds an escalation ladder: intention gate then delay gate", () => {
    const session = rules.find((r) => r.scope.surface === "session")!;
    expect(session.primitives.length).toBe(2);
    const first = (session.primitives[0] as any).wraps;
    const second = (session.primitives[1] as any).wraps;
    expect(first.frictionType.type).toBe("intention");
    expect(second.frictionType.type).toBe("delay");
  });
});

describe("wateringHoursRules — dry mode", () => {
  const rules = wateringHoursRules(DRY_INPUT);

  it("generates rules for each surface", () => {
    const surfaces = rules.map((r) => r.scope.surface);
    expect(surfaces).toContain("session");
    expect(surfaces).toContain("browser");
  });

  it("all rules pass the validator", () => {
    for (const rule of rules) {
      expect(validateRuleSpec(rule)).toEqual([]);
    }
  });

  it("wraps a standing cooldown in schedule", () => {
    const session = rules.find((r) => r.scope.surface === "session")!;
    expect(session.primitives.length).toBe(1);
    const sched = session.primitives[0];
    expect(sched.kind).toBe("schedule");
    if (sched.kind === "schedule") {
      expect(sched.wraps.kind).toBe("cooldown");
      if (sched.wraps.kind === "cooldown") {
        expect(sched.wraps.duration).toEqual({ type: "standing" });
        expect(sched.wraps.unlockPath.type).toBe("out_of_band");
      }
    }
  });

  it("carries weekday restriction", () => {
    const session = rules.find((r) => r.scope.surface === "session")!;
    const sched = session.primitives[0];
    if (sched.kind === "schedule") {
      expect(sched.window.weekdays).toEqual([Weekday.MON]);
    }
  });

  it("uses access-block mechanism", () => {
    for (const rule of rules) {
      expect(rule.mechanism).toBe("access-block");
    }
  });
});

describe("wateringHoursRules — by_hand mode", () => {
  const rules = wateringHoursRules(BY_HAND_INPUT);

  it("generates a session-scoped rule only", () => {
    expect(rules.length).toBe(1);
    expect(rules[0].scope.surface).toBe("session");
  });

  it("scopes to specific tools", () => {
    const scope = rules[0].scope as any;
    expect(scope.tools).toEqual(["Edit", "Write"]);
    expect(scope.match).toBe("inside");
  });

  it("wraps a confirmation gate in schedule", () => {
    const sched = rules[0].primitives[0];
    expect(sched.kind).toBe("schedule");
    if (sched.kind === "schedule") {
      expect(sched.wraps.kind).toBe("gate");
      if (sched.wraps.kind === "gate") {
        expect(sched.wraps.frictionType.type).toBe("confirmation");
      }
    }
  });

  it("passes the validator", () => {
    expect(validateRuleSpec(rules[0])).toEqual([]);
  });
});

const RATIONED_INPUT: WateringHoursInput = {
  policyName: "youtube-weekend",
  mode: "rationed",
  window: { fromHour: 0, toHour: 0, weekdays: [Weekday.SAT, Weekday.SUN] },
  serves,
  returnsTo: ["area-wellness"],
  restricts: { hosts: ["youtube.com", "youtu.be"] },
  unlockNote: "Tomorrow.",
  reach: "navigation",
  budget: { minutes: 60, exclude: ["music.youtube.com"] },
};

describe("wateringHoursRules — rationed mode", () => {
  it("emits one access-block browser rule per host, each carrying the pool budget", () => {
    const rules = wateringHoursRules(RATIONED_INPUT);
    expect(rules.map((r) => r.id)).toEqual([
      "watering:youtube-weekend:browser:youtube.com",
      "watering:youtube-weekend:browser:youtu.be",
    ]);
    for (const rule of rules) {
      expect(rule.mechanism).toBe("access-block");
      expect(validateRuleSpec(rule)).toEqual([]);
      expect(carriesExit(rule.primitives[0])).toBe(true);
      const p = rule.primitives[0];
      if (p.kind !== "schedule") throw new Error("expected schedule");
      expect(p.budget).toEqual({
        minutes: 60,
        pool: "youtube-weekend",
        exclude: ["music.youtube.com"],
      });
      if (p.wraps.kind !== "cooldown") throw new Error("expected cooldown");
      expect(p.wraps.enforcement).toEqual({
        at: "browser",
        reach: "navigation",
      });
    }
  });

  it("puts no budget on a dry rule", () => {
    const [rule] = wateringHoursRules({
      ...RATIONED_INPUT,
      mode: "dry",
      budget: undefined,
    });
    const p = rule.primitives[0];
    expect(p.kind === "schedule" && p.budget).toBeFalsy();
  });
});
