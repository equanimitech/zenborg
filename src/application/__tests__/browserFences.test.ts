import { describe, expect, it } from "vitest";
import type { AreaRef, FenceDeps } from "@/application/ports";
import {
  declareBrowserGate,
  declareBrowserTransform,
  declareHostBlock,
  seedHostBlocks,
} from "@/application/use-cases/fences";
import {
  carriesExit,
  type TransformSpec,
} from "@/domain/intervention/Primitive";
import type { RuleSpec } from "@/domain/intervention/RuleSpec";
import { validateRuleSpec } from "@/domain/intervention/RuleSpec";

/**
 * The browser-scoped fence writer.
 *
 * Migration step 5 could not be finished without one. Slice E reported it in as
 * many words: the extension's fence cache had to keep reading
 * `~/.zenborg/keel/rules/*.json` alongside `fences`, because zenborg's only fence
 * writer produced `scope.surface: "session"` rules and a fences-only read would
 * have shipped an inert feature. These tests are that gap closing.
 */

/**
 * Nobody's hosts. The domain carries no list to fall back to, so the caller
 * names them, and a fixture here can be as invented as it likes.
 */
const HOSTS = ["one.example", "two.example", "three.example"];

const AREAS: AreaRef[] = [
  { id: "area-themia", name: "Themia" },
  { id: "area-craft", name: "Craft" },
];

function deps(opts?: {
  areas?: readonly AreaRef[];
  cycleId?: string | null;
  fences?: Record<string, RuleSpec>;
}) {
  let stored: Record<string, RuleSpec> = { ...(opts?.fences ?? {}) };
  let writes = 0;
  let ids = 0;
  const d: FenceDeps = {
    store: {
      read: async () => ({ ...stored }),
      write: async (all) => {
        writes += 1;
        stored = all;
      },
    },
    tally: { read: async () => ({}) },
    garden: {
      areas: async () => opts?.areas ?? AREAS,
      cycles: async () => [],
      activeCycleId: async () =>
        opts?.cycleId === undefined ? "cycle-1" : opts.cycleId,
      phaseConfigs: async () => [],
    },
    newRuleId: () => `rule-${++ids}`,
  };
  return { d, stored: () => stored, writes: () => writes };
}

describe("declareHostBlock", () => {
  it("writes a browser-scoped rule — the scope that survives into the fence record", async () => {
    const { d, stored } = deps();
    const result = await declareHostBlock(d, {
      host: "chess.com",
      returnsTo: ["Craft"],
      unlockNote: "take it out of the profile and wait for propagation",
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    expect(result.declared.scope).toEqual({
      surface: "browser",
      domain: "chess.com",
      matches: ["*://chess.com/*", "*://*.chess.com/*"],
    });
    expect(stored()[result.declared.id]).toEqual(result.declared);
  });

  it("declares a rule the validator accepts, carrying an exit", async () => {
    const { d } = deps();
    const result = await declareHostBlock(d, {
      host: "chess.com",
      returnsTo: ["Craft"],
      unlockNote: "n",
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(validateRuleSpec(result.declared)).toEqual([]);
    for (const p of result.declared.primitives)
      expect(carriesExit(p)).toBe(true);
  });

  it("refuses a host with a scheme or a path — the fence record carries domains, never URLs", async () => {
    const { d, writes } = deps();
    const result = await declareHostBlock(d, {
      host: "https://chess.com/play",
      returnsTo: ["Craft"],
      unlockNote: "n",
    });
    expect("problems" in result).toBe(true);
    expect(writes()).toBe(0);
  });

  it("refuses a block with no stated way out — invariant 6, at the door", async () => {
    const { d, writes } = deps();
    const result = await declareHostBlock(d, {
      host: "chess.com",
      returnsTo: ["Craft"],
      unlockNote: "   ",
    });
    if (!("problems" in result)) throw new Error("should have refused");
    expect(result.problems.join(" ")).toMatch(/way out|exit|unlock/i);
    expect(writes()).toBe(0);
  });

  it("refuses when no season is running, rather than inventing a distal to serve", async () => {
    const { d, writes } = deps({ cycleId: null });
    const result = await declareHostBlock(d, {
      host: "chess.com",
      returnsTo: ["Craft"],
      unlockNote: "n",
    });
    expect("problems" in result).toBe(true);
    expect(writes()).toBe(0);
  });
});

describe("declareBrowserGate", () => {
  it("writes a browser-scoped dwell gate the extension can actuate", async () => {
    const { d, stored } = deps();
    const result = await declareBrowserGate(d, {
      host: "linkedin.com",
      returnsTo: ["Craft"],
      everyMinutes: 5,
      prompt: "Still what you came for?",
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    const [declared] = result.declared;
    expect(declared.scope).toEqual({
      surface: "browser",
      domain: "linkedin.com",
      matches: ["*://linkedin.com/*", "*://*.linkedin.com/*"],
    });
    const gate = declared.primitives[0];
    expect(gate.kind).toBe("gate");
    expect(carriesExit(gate)).toBe(true);
    expect(stored()[declared.id]).toEqual(declared);
  });

  it("resolves areas by name, the words the principal actually uses", async () => {
    const { d } = deps();
    const result = await declareBrowserGate(d, {
      host: "linkedin.com",
      returnsTo: ["craft"],
      everyMinutes: 5,
      prompt: "why",
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.declared[0].outcome.measure).toEqual({
      kind: "next_span_in",
      areaIds: ["area-craft"],
    });
  });

  it("refuses a gate with nothing to ask — a prompt is the friction", async () => {
    const { d, writes } = deps();
    const result = await declareBrowserGate(d, {
      host: "linkedin.com",
      returnsTo: ["Craft"],
      everyMinutes: 5,
      prompt: "  ",
    });
    expect("problems" in result).toBe(true);
    expect(writes()).toBe(0);
  });
});

describe("declareBrowserTransform", () => {
  it("writes a browser-scoped transform the extension can actuate", async () => {
    const { d, stored } = deps();
    const result = await declareBrowserTransform(d, {
      host: "youtube.com",
      returnsTo: ["Craft"],
      selectors: {
        primary: "ytm-shorts-lockup-view-model",
        fallbacks: ["ytd-reel-shelf-renderer"],
      },
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    expect(result.declared.scope).toEqual({
      surface: "browser",
      domain: "youtube.com",
      matches: ["*://youtube.com/*", "*://*.youtube.com/*"],
    });
    const transform = result.declared.primitives[0] as TransformSpec;
    expect(transform.kind).toBe("transform");
    expect(transform.targets).toEqual({
      primary: "ytm-shorts-lockup-view-model",
      fallbacks: ["ytd-reel-shelf-renderer"],
    });
    expect(stored()[result.declared.id]).toEqual(result.declared);
  });

  it("defaults the replacement to a plain hide", async () => {
    const { d } = deps();
    const result = await declareBrowserTransform(d, {
      host: "youtube.com",
      returnsTo: ["Craft"],
      selectors: { primary: "ytm-shorts-lockup-view-model" },
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    const transform = result.declared.primitives[0] as TransformSpec;
    expect(transform.replacement).toEqual({ type: "hide" });
  });

  it("takes an explicit restyle replacement", async () => {
    const { d } = deps();
    const result = await declareBrowserTransform(d, {
      host: "linkedin.com",
      returnsTo: ["Craft"],
      selectors: { primary: 'div[componentkey*="FeedType_MAIN_FEED"]' },
      replacement: { type: "restyle", style: { visibility: "hidden" } },
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    const transform = result.declared.primitives[0] as TransformSpec;
    expect(transform.replacement).toEqual({
      type: "restyle",
      style: { visibility: "hidden" },
    });
  });

  it("declares a rule the validator accepts, carrying no exit — invariant 6 does not apply to a conceal", async () => {
    const { d } = deps();
    const result = await declareBrowserTransform(d, {
      host: "youtube.com",
      returnsTo: ["Craft"],
      selectors: { primary: "ytm-shorts-lockup-view-model" },
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(validateRuleSpec(result.declared)).toEqual([]);
    for (const p of result.declared.primitives)
      expect(carriesExit(p)).toBe(false);
  });

  it("refuses a transform with no primary selector", async () => {
    const { d, writes } = deps();
    const result = await declareBrowserTransform(d, {
      host: "youtube.com",
      returnsTo: ["Craft"],
      selectors: { primary: "   " },
    });
    expect("problems" in result).toBe(true);
    expect(writes()).toBe(0);
  });

  it("refuses a host with a scheme or a path — the fence record carries domains, never URLs", async () => {
    const { d, writes } = deps();
    const result = await declareBrowserTransform(d, {
      host: "https://youtube.com/shorts",
      returnsTo: ["Craft"],
      selectors: { primary: "ytm-shorts-lockup-view-model" },
    });
    expect("problems" in result).toBe(true);
    expect(writes()).toBe(0);
  });
});

describe("seedHostBlocks", () => {
  it("writes the seed blocklist as fences, one rule per host", async () => {
    const { d, stored } = deps();
    const result = await seedHostBlocks(d, {
      returnsTo: ["Craft"],
      hosts: HOSTS,
      unlockNote: "take it out of the profile and wait for propagation",
    });
    if ("problems" in result) throw new Error(result.problems.join("; "));

    expect(result.declared).toHaveLength(HOSTS.length);
    const domains = Object.values(stored()).map(
      (r) => (r.scope as { domain: string }).domain,
    );
    expect(domains.sort()).toEqual([...HOSTS].sort());
  });

  it("is idempotent — re-seeding replaces rather than accumulating", async () => {
    const { d, stored } = deps();
    await seedHostBlocks(d, {
      returnsTo: ["Craft"],
      hosts: HOSTS,
      unlockNote: "n",
    });
    await seedHostBlocks(d, {
      returnsTo: ["Craft"],
      hosts: HOSTS,
      unlockNote: "n",
    });
    expect(Object.keys(stored())).toHaveLength(HOSTS.length);
  });

  it("leaves fences it did not write alone", async () => {
    const { d, stored } = deps();
    const existing = await declareBrowserGate(d, {
      host: "news.ycombinator.com",
      returnsTo: ["Craft"],
      everyMinutes: 10,
      prompt: "why",
    });
    if ("problems" in existing) throw new Error("setup");
    await seedHostBlocks(d, {
      returnsTo: ["Craft"],
      hosts: HOSTS,
      unlockNote: "n",
    });
    const [gate] = existing.declared;
    expect(stored()[gate.id]).toEqual(gate);
  });
});
