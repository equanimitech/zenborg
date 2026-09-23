import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CooldownSpec, ScheduleSpec } from "../../src/domain/intervention/Primitive.ts";
import type { RuleSpec } from "../../src/domain/intervention/RuleSpec.ts";
import {
  FENCE_TAG,
  collectResolverHosts,
  composeRules,
  filterRuleToHost,
  hostToFilterRule,
  mergeRules,
  parseTaggedRules,
  readResolverHealth,
  syncRules,
} from "./adguard.js";

// ── hostToFilterRule / filterRuleToHost ────────────────────────────────

describe("hostToFilterRule", () => {
  it("wraps a host in AdGuard syntax", () => {
    expect(hostToFilterRule("chess.com")).toBe("||chess.com^");
  });
});

describe("filterRuleToHost", () => {
  it("extracts host from a valid rule", () => {
    expect(filterRuleToHost("||chess.com^")).toBe("chess.com");
  });

  it("returns null for non-host rules", () => {
    expect(filterRuleToHost("! some comment")).toBeNull();
    expect(filterRuleToHost("@@||example.com^")).toBeNull();
    expect(filterRuleToHost("plain text")).toBeNull();
  });
});

// ── parseTaggedRules ──────────────────────────────────────────────────

describe("parseTaggedRules", () => {
  it("separates user rules from zenborg-tagged rules", () => {
    const lines = [
      "||ads.example.com^",
      "! my custom comment",
      FENCE_TAG,
      "||chess.com^",
      FENCE_TAG,
      "||reddit.com^",
      "||tracker.example.com^",
    ];
    const { userRules, zenborgHosts } = parseTaggedRules(lines);
    expect(userRules).toEqual([
      "||ads.example.com^",
      "! my custom comment",
      "||tracker.example.com^",
    ]);
    expect(zenborgHosts).toEqual(new Set(["chess.com", "reddit.com"]));
  });

  it("handles empty input", () => {
    const { userRules, zenborgHosts } = parseTaggedRules([]);
    expect(userRules).toEqual([]);
    expect(zenborgHosts.size).toBe(0);
  });

  it("handles no zenborg rules", () => {
    const lines = ["||ads.example.com^", "! comment"];
    const { userRules, zenborgHosts } = parseTaggedRules(lines);
    expect(userRules).toEqual(lines);
    expect(zenborgHosts.size).toBe(0);
  });
});

// ── composeRules ──────────────────────────────────────────────────────

describe("composeRules", () => {
  it("appends tagged zenborg rules after user rules", () => {
    const result = composeRules(
      ["||ads.example.com^"],
      new Set(["chess.com"]),
    );
    expect(result).toEqual([
      "||ads.example.com^",
      FENCE_TAG,
      "||chess.com^",
    ]);
  });
});

// ── mergeRules ────────────────────────────────────────────────────────

describe("mergeRules", () => {
  const existing = [
    "||ads.example.com^",
    FENCE_TAG,
    "||chess.com^",
  ];

  it("adds new hosts without clobbering user rules", () => {
    const result = mergeRules(existing, ["reddit.com"], []);
    expect(result).toContain("||ads.example.com^");
    expect(result).toContain("||chess.com^");
    expect(result).toContain("||reddit.com^");
  });

  it("removes hosts without clobbering user rules", () => {
    const result = mergeRules(existing, [], ["chess.com"]);
    expect(result).toContain("||ads.example.com^");
    expect(result).not.toContain("||chess.com^");
  });

  it("round-trip: add then remove preserves user rules", () => {
    const added = mergeRules(existing, ["twitter.com"], []);
    const removed = mergeRules(added, [], ["twitter.com", "chess.com"]);
    // Only user rules remain
    expect(removed).toEqual(["||ads.example.com^"]);
  });
});

// ── syncRules ─────────────────────────────────────────────────────────

describe("syncRules", () => {
  it("replaces zenborg hosts with desired set, preserves user rules", () => {
    const existing = [
      "! my ad filter",
      "||ads.example.com^",
      FENCE_TAG,
      "||chess.com^",
      FENCE_TAG,
      "||reddit.com^",
    ];
    const result = syncRules(existing, new Set(["twitter.com"]));
    expect(result).toEqual([
      "! my ad filter",
      "||ads.example.com^",
      FENCE_TAG,
      "||twitter.com^",
    ]);
  });

  it("clears all zenborg hosts when desired set is empty", () => {
    const existing = [
      "||ads.example.com^",
      FENCE_TAG,
      "||chess.com^",
    ];
    const result = syncRules(existing, new Set());
    expect(result).toEqual(["||ads.example.com^"]);
  });
});

// ── collectResolverHosts ──────────────────────────────────────────────

describe("collectResolverHosts", () => {
  function makeRule(
    domain: string | readonly string[],
    enforcement: CooldownSpec["enforcement"],
    duration: CooldownSpec["duration"] = { type: "standing" },
  ): RuleSpec {
    return {
      id: `rule-${typeof domain === "string" ? domain : domain[0]}`,
      name: "test",
      description: "test rule",
      scope: {
        surface: "browser",
        domain,
        matches: ["*://*/*"],
      },
      mechanism: "access-block",
      fadeEligibility: "never",
      outcome: { claim: "test", windowMs: 86400000, measure: { kind: "dwell_reduction" } },
      serves: { cycleId: "c1", areaId: "a1" },
      deliveryProbability: 1,
      primitives: [
        {
          kind: "cooldown",
          enforcement,
          duration,
          unlockPath: { type: "out_of_band", note: "ask" },
        } satisfies CooldownSpec,
      ],
    } as unknown as RuleSpec;
  }

  it("collects hosts from resolver-enforced standing cooldowns", () => {
    const fences = {
      r1: makeRule("chess.com", { at: "resolver", profile: "default" }),
      r2: makeRule("reddit.com", { at: "resolver", profile: "default" }),
    };
    expect(collectResolverHosts(fences)).toEqual(
      new Set(["chess.com", "reddit.com"]),
    );
  });

  it("collects hosts from browser-enforced standing cooldowns (fan-out)", () => {
    const fences = {
      r1: makeRule("chess.com", { at: "browser" }),
    };
    expect(collectResolverHosts(fences)).toEqual(new Set(["chess.com"]));
  });

  it("collects hosts from standing cooldowns with no enforcement field", () => {
    const fences = {
      r1: makeRule("chess.com", undefined),
    };
    expect(collectResolverHosts(fences)).toEqual(new Set(["chess.com"]));
  });

  it("ignores non-standing cooldowns (timed)", () => {
    const fences = {
      r1: makeRule("chess.com", undefined, { type: "seconds", seconds: 300 }),
    };
    expect(collectResolverHosts(fences).size).toBe(0);
  });

  it("handles array domains", () => {
    const fences = {
      r1: makeRule(
        ["chess.com", "lichess.org"] as const,
        { at: "browser" },
      ),
    };
    expect(collectResolverHosts(fences)).toEqual(
      new Set(["chess.com", "lichess.org"]),
    );
  });

  it("ignores non-browser-scoped rules", () => {
    const fences = {
      r1: {
        ...makeRule("chess.com", { at: "browser" }),
        scope: { surface: "session" as const, paths: ["/foo"] },
      } as unknown as RuleSpec,
    };
    expect(collectResolverHosts(fences).size).toBe(0);
  });

  it("unwraps schedule-wrapped cooldowns (dry watering hours)", () => {
    const scheduledCooldown: ScheduleSpec = {
      kind: "schedule",
      window: { fromHour: 9, toHour: 17 },
      outsideWindow: "inactive",
      wraps: {
        kind: "cooldown",
        duration: { type: "standing" },
        unlockPath: { type: "out_of_band", note: "re-declare watering hours" },
      } as CooldownSpec,
    };
    const fences = {
      r1: {
        id: "watering:dry:browser:youtube.com",
        name: "dry hours (youtube.com)",
        description: "test",
        scope: { surface: "browser" as const, domain: "youtube.com", matches: ["*://youtube.com/*"] },
        mechanism: "access-block",
        fadeEligibility: "manual",
        outcome: { claim: "test", windowMs: 600000, measure: { kind: "dwell_reduction" } },
        serves: { cycleId: "c1", areaId: "a1" },
        deliveryProbability: 1,
        primitives: [scheduledCooldown],
      } as unknown as RuleSpec,
    };
    expect(collectResolverHosts(fences)).toEqual(new Set(["youtube.com"]));
  });

  it("ignores gate-only rules (no cooldown)", () => {
    const fences = {
      r1: {
        id: "gate-1",
        name: "test gate",
        description: "test",
        scope: { surface: "browser" as const, domain: "linkedin.com", matches: ["*://linkedin.com/*"] },
        mechanism: "friction",
        fadeEligibility: "manual",
        outcome: { claim: "test", windowMs: 600000, measure: { kind: "dwell_reduction" } },
        serves: { cycleId: "c1", areaId: "a1" },
        deliveryProbability: 0.5,
        primitives: [
          {
            kind: "gate",
            trigger: { type: "dwell", everyMinutes: 15 },
            frictionType: { type: "intention", prompt: "Still here?" },
            proceedAffordance: { label: "Continue", action: { type: "continue" } },
          },
        ],
      } as unknown as RuleSpec,
    };
    expect(collectResolverHosts(fences).size).toBe(0);
  });
});

// ── readResolverHealth ───────────────────────────────────────────────

describe("readResolverHealth", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-health-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    expect(readResolverHealth(tmpDir)).toBeNull();
  });

  it("reads a valid health record", () => {
    const dir = path.join(tmpDir, "plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "resolver-health.json"),
      JSON.stringify({ reachable: true, at: "2026-09-21T10:00:00Z" }),
    );
    const h = readResolverHealth(tmpDir);
    expect(h).toEqual({ reachable: true, at: "2026-09-21T10:00:00Z" });
  });

  it("returns null for malformed JSON", () => {
    const dir = path.join(tmpDir, "plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "resolver-health.json"), "not json");
    expect(readResolverHealth(tmpDir)).toBeNull();
  });

  it("returns null for missing required fields", () => {
    const dir = path.join(tmpDir, "plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "resolver-health.json"),
      JSON.stringify({ reachable: "yes" }),
    );
    expect(readResolverHealth(tmpDir)).toBeNull();
  });
});
