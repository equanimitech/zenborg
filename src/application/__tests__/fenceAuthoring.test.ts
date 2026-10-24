import { describe, expect, it } from "vitest";
import type { AreaRef, CycleRef, FenceDeps } from "@/application/ports";
import {
  declareBrowserGate,
  declareBrowserTransform,
  declareFence,
  declareHostBlock,
  declareWateringHours,
  seedHostBlocks,
  setFencesEnabled,
} from "@/application/use-cases/fences";
import type { RuleSpec } from "@/domain/intervention/RuleSpec";
import { parseFences } from "../../../extension/modules/fence/parse";
import { transformCss } from "../../../extension/modules/friction/transform/apply";

/**
 * Authoring everything the extension enforces, through the writers.
 *
 * The acceptance test is the extension's own parser: each record a writer
 * emits goes through `parseFences` exactly as the native host pushes it, and
 * must come out with nothing refused. Transforms are the exception by design:
 * they never travel through `parseFences` (it refuses every transform as
 * `unactuatable`, hand-written ones included); the native host projects them
 * into `PageTransform`s (`extract_transforms`, native-host/src/main.rs), so
 * they are checked against that projection and the extension's stylesheet.
 */

const AREAS: AreaRef[] = [{ id: "area-craft", name: "Craft" }];

const CYCLES: CycleRef[] = [
  { id: "cycle-old", name: "Early autumn", endDate: "2026-09-30" },
  { id: "cycle-last", name: "Mid autumn", endDate: "2026-10-20" },
];

function deps(opts?: {
  cycleId?: string | null;
  cycles?: readonly CycleRef[];
  fences?: Record<string, RuleSpec>;
}) {
  let stored: Record<string, RuleSpec> = { ...(opts?.fences ?? {}) };
  let ids = 0;
  const d: FenceDeps = {
    store: {
      read: async () => ({ ...stored }),
      write: async (all) => {
        stored = all;
      },
    },
    tally: { read: async () => ({}) },
    garden: {
      areas: async () => AREAS,
      activeCycleId: async () =>
        opts?.cycleId === undefined ? "cycle-1" : opts.cycleId,
      cycles: async () => opts?.cycles ?? CYCLES,
      phaseConfigs: async () => [],
    },
    newRuleId: () => `rule-${++ids}`,
  };
  return { d, stored: () => stored };
}

function ok<T>(result: T | { problems: readonly string[] }): T {
  if (typeof result === "object" && result && "problems" in result) {
    throw new Error(result.problems.join("; "));
  }
  return result as T;
}

function parsed(stored: Record<string, RuleSpec>) {
  const out = parseFences(JSON.parse(JSON.stringify(stored)));
  if (!out) throw new Error("parseFences returned null");
  return out;
}

const CHESS_SELECTORS = {
  primary: "button.bot-selection-cta-button-button",
  fallbacks: [
    ".new-game-primary > button.cc-button-primary",
    "button.game-over-new-game-button-component",
  ],
};

describe("set_browser_gate, full shape → parseFences", () => {
  it("a 4-rung click ladder parses as a ladder of four click rungs", async () => {
    const { d, stored } = deps();
    const click = { type: "click" as const, selectors: CHESS_SELECTORS };
    ok(
      await declareBrowserGate(d, {
        id: "chess-ladder",
        host: "chess.com",
        returnsTo: ["Craft"],
        rungs: [
          {
            trigger: click,
            friction: {
              type: "intention",
              prompt: "Another, or was that the one?",
            },
            proceedLabel: "One more",
            abortLabel: "That was the one",
          },
          {
            trigger: click,
            friction: { type: "delay", seconds: 15 },
            proceedLabel: "One more",
          },
          {
            trigger: click,
            friction: { type: "breath", cycles: 3 },
            proceedLabel: "One more",
          },
          {
            trigger: click,
            friction: { type: "breath", cycles: 6 },
            proceedLabel: "One more",
          },
        ],
      }),
    );

    const { fences, refused } = parsed(stored());
    expect(refused).toEqual([]);
    const fence = fences["chess-ladder"];
    expect(fence.rungs).toHaveLength(4);
    expect(fence.rungs?.map((r) => r.friction.type)).toEqual([
      "intention",
      "delay",
      "breath",
      "breath",
    ]);
    for (const rung of fence.rungs ?? []) {
      expect(rung.click).toEqual([
        CHESS_SELECTORS.primary,
        ...CHESS_SELECTORS.fallbacks,
      ]);
    }
    expect(fence.deliveryProbability).toBe(0.7);
  });

  it("a breath dwell ladder parses with the dwell interval on every rung", async () => {
    const { d, stored } = deps();
    const dwell = { type: "dwell" as const, everyMinutes: 40 };
    ok(
      await declareBrowserGate(d, {
        id: "cinejoy-pk-ladder",
        host: "cinejoy.pk",
        returnsTo: ["Craft"],
        deliveryProbability: 1,
        rungs: [
          { trigger: dwell, friction: { type: "breath", cycles: 5 } },
          {
            trigger: dwell,
            friction: {
              type: "intention",
              prompt: "Is one more what tonight is for?",
            },
          },
          { trigger: dwell, friction: { type: "breath", cycles: 10 } },
        ],
      }),
    );
    const { fences, refused } = parsed(stored());
    expect(refused).toEqual([]);
    const fence = fences["cinejoy-pk-ladder"];
    expect(fence.rungs?.map((r) => r.everyMinutes)).toEqual([40, 40, 40]);
    expect(fence.rungs?.[2].friction).toEqual({ type: "breath", cycles: 10 });
    expect(fence.deliveryProbability).toBe(1);
  });

  it("an entry gate parses as an entry gate", async () => {
    const { d, stored } = deps();
    const result = ok(
      await declareBrowserGate(d, {
        host: "news.example",
        returnsTo: ["Craft"],
        rungs: [
          {
            trigger: { type: "entry" },
            friction: { type: "delay", seconds: 10 },
          },
        ],
      }),
    );
    const { fences, refused } = parsed(stored());
    expect(refused).toEqual([]);
    const fence = fences[result.declared[0].id];
    expect(fence.enforcement).toMatchObject({ kind: "gate", entry: true });
    expect(fence.rungs).toBeUndefined();
  });

  it("`hosts` writes one rule per host with derived ids, and re-declaring replaces", async () => {
    const { d, stored } = deps();
    const input = {
      hosts: ["one.example", "two.example"],
      name: "Evening cue",
      returnsTo: ["Craft"],
      everyMinutes: 20,
      prompt: "Still it?",
    };
    ok(await declareBrowserGate(d, input));
    ok(await declareBrowserGate(d, input));
    expect(Object.keys(stored()).sort()).toEqual([
      "evening-cue:one.example",
      "evening-cue:two.example",
    ]);
    expect(parsed(stored()).refused).toEqual([]);
  });

  it("refuses mixing the flat and the full shape, and a rung with no question", async () => {
    const { d, stored } = deps();
    const mixed = await declareBrowserGate(d, {
      host: "a.example",
      returnsTo: ["Craft"],
      everyMinutes: 5,
      rungs: [
        { trigger: { type: "entry" }, friction: { type: "breath", cycles: 3 } },
      ],
    });
    expect("problems" in mixed).toBe(true);
    const empty = await declareBrowserGate(d, {
      host: "a.example",
      returnsTo: ["Craft"],
      rungs: [
        {
          trigger: { type: "entry" },
          friction: { type: "intention", prompt: " " },
        },
      ],
    });
    expect("problems" in empty).toBe(true);
    expect(stored()).toEqual({});
  });
});

describe("reach", () => {
  it("a navigation-reach watering policy keeps its reach when re-declared without it", async () => {
    const { d, stored } = deps();
    const base = {
      name: "chess-afternoon",
      mode: "dry" as const,
      window: { fromHour: 16, toHour: 13 },
      waters: ["Craft"],
      restricts: { hosts: ["chess.com"] },
      unlockNote: "Chess opens 13h–16h. Wait for the afternoon.",
    };
    ok(await declareWateringHours(d, { ...base, reach: "navigation" }));
    ok(await declareWateringHours(d, base));

    const id = "watering:chess-afternoon:browser:chess.com";
    const { fences, refused } = parsed(stored());
    expect(refused).toEqual([]);
    expect(fences[id].enforcement).toEqual({
      kind: "block",
      enforcement: "browser",
      standing: true,
      reach: "navigation",
    });
    expect(fences[id].schedule).toMatchObject({ fromHour: 16, toHour: 13 });

    ok(await declareWateringHours(d, { ...base, reach: "all" }));
    expect(parsed(stored()).fences[id].enforcement).not.toHaveProperty("reach");
  });

  it("set_host_block carries reach onto the browser cooldown", async () => {
    const { d, stored } = deps();
    const result = ok(
      await declareHostBlock(d, {
        host: "chess.com",
        returnsTo: ["Craft"],
        unlockNote: "out of band",
        reach: "navigation",
      }),
    );
    const { fences, refused } = parsed(stored());
    expect(refused).toEqual([]);
    expect(fences[result.declared.id].enforcement).toMatchObject({
      reach: "navigation",
    });
  });
});

describe("set_browser_transform → the native host's projection", () => {
  it("emits a transform the extension's stylesheet renders", async () => {
    const { d, stored } = deps();
    const result = ok(
      await declareBrowserTransform(d, {
        host: "youtube.com",
        selectors: {
          primary: 'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
        },
        returnsTo: ["Craft"],
      }),
    );
    const rule = stored()[result.declared.id];
    const [prim] = rule.primitives;
    if (prim.kind !== "transform") throw new Error("expected a transform");
    // As native-host/src/main.rs `extract_transforms` projects it.
    const projected = {
      ruleId: rule.id,
      domains: ["youtube.com"],
      targets: prim.targets,
      replacement: { type: "hide" as const },
    };
    expect(transformCss([projected])).toContain("ytd-rich-grid-renderer");
    // And parseFences, by design, is not its reader.
    expect(parsed(stored()).refused).toEqual([
      { id: rule.id, reason: "unactuatable" },
    ]);
  });
});

describe("season fallback — fences outlive seasons", () => {
  const writers: [string, (d: FenceDeps) => Promise<unknown>][] = [
    [
      "set_fence",
      (d) =>
        declareFence(d, { label: "x", paths: ["/tmp/x"], areas: ["Craft"] }),
    ],
    [
      "set_host_block",
      (d) =>
        declareHostBlock(d, {
          host: "a.example",
          returnsTo: ["Craft"],
          unlockNote: "n",
        }),
    ],
    [
      "set_browser_gate",
      (d) =>
        declareBrowserGate(d, {
          host: "a.example",
          returnsTo: ["Craft"],
          everyMinutes: 5,
          prompt: "why",
        }),
    ],
    [
      "set_browser_transform",
      (d) =>
        declareBrowserTransform(d, {
          host: "a.example",
          selectors: { primary: "#x" },
          returnsTo: ["Craft"],
        }),
    ],
    [
      "seed_host_blocks",
      (d) =>
        seedHostBlocks(d, {
          hosts: ["a.example"],
          returnsTo: ["Craft"],
          unlockNote: "n",
        }),
    ],
    [
      "set_watering_hours",
      (d) =>
        declareWateringHours(d, {
          name: "p",
          mode: "dry",
          window: { fromHour: 22, toHour: 7 },
          waters: ["Craft"],
          restricts: { hosts: ["a.example"] },
          unlockNote: "n",
        }),
    ],
  ];

  for (const [name, write] of writers) {
    it(`${name} serves the last season when none is running, and says so`, async () => {
      const { d, stored } = deps({ cycleId: null });
      const result = (await write(d)) as { note?: string; problems?: string[] };
      expect(result.problems).toBeUndefined();
      expect(result.note).toBe(
        "serving the last season, 'Mid autumn', ended 2026-10-20",
      );
      for (const rule of Object.values(stored())) {
        expect(rule.serves.cycleId).toBe("cycle-last");
      }
    });

    it(`${name} refuses only when no cycle exists at all`, async () => {
      const { d, stored } = deps({ cycleId: null, cycles: [] });
      const result = (await write(d)) as { problems?: string[] };
      expect(result.problems?.join(" ")).toContain("no season exists");
      expect(stored()).toEqual({});
    });
  }
});

describe("set_fence_enabled", () => {
  it("pauses and resumes by id, logging each change, never deleting", async () => {
    const { d, stored } = deps();
    const declared = ok(
      await declareBrowserGate(d, {
        id: "g",
        host: "a.example",
        returnsTo: ["Craft"],
        everyMinutes: 5,
        prompt: "why",
      }),
    );
    const original = declared.declared[0].description;

    const paused = ok(
      await setFencesEnabled(d, { id: "g" }, false, "travelling", "2026-10-24"),
    );
    expect(paused.changed).toEqual([{ id: "g", name: "a.example" }]);
    expect(stored().g.defaultEnabled).toBe(false);
    expect(stored().g.description).toBe(
      `${original}\nPaused 2026-10-24: travelling`,
    );
    // The extension skips it: neither enforced nor refused.
    const { fences, refused } = parsed(stored());
    expect(fences.g).toBeUndefined();
    expect(refused).toEqual([]);

    const again = ok(
      await setFencesEnabled(d, { id: "g" }, false, "still", "2026-10-24"),
    );
    expect(again).toEqual({ changed: [], unchanged: ["g"] });

    ok(await setFencesEnabled(d, { id: "g" }, true, "home", "2026-10-25"));
    expect(stored().g.defaultEnabled).toBe(true);
    expect(stored().g.description).toBe(
      `${original}\nPaused 2026-10-24: travelling\nResumed 2026-10-25: home`,
    );
    expect(parsed(stored()).fences.g).toBeDefined();
  });

  it("pauses every rule of a watering policy, and a re-declaration keeps it paused", async () => {
    const { d, stored } = deps();
    const policy = {
      name: "nights",
      mode: "dry" as const,
      window: { fromHour: 22, toHour: 7 },
      waters: ["Craft"],
      restricts: { hosts: ["a.example", "b.example"] },
      unlockNote: "morning",
    };
    ok(await declareWateringHours(d, policy));
    const result = ok(
      await setFencesEnabled(
        d,
        { policy: "nights" },
        false,
        "holiday",
        "2026-10-24",
      ),
    );
    expect(result.changed).toHaveLength(2);

    const redeclared = ok(await declareWateringHours(d, policy));
    expect(redeclared.note).toContain("still paused");
    for (const rule of Object.values(stored())) {
      expect(rule.defaultEnabled).toBe(false);
    }
  });

  it("refuses an unknown target and an empty reason", async () => {
    const { d } = deps();
    expect(
      "problems" in
        (await setFencesEnabled(d, { id: "nope" }, false, "r", "2026-10-24")),
    ).toBe(true);
    expect(
      "problems" in
        (await setFencesEnabled(d, { id: "nope" }, false, " ", "2026-10-24")),
    ).toBe(true);
  });
});

describe("unknown fields survive a re-declaration", () => {
  it("keeps fields this build does not write", async () => {
    const { d, stored } = deps();
    ok(
      await declareBrowserGate(d, {
        id: "g",
        host: "a.example",
        returnsTo: ["Craft"],
        everyMinutes: 5,
        prompt: "why",
      }),
    );
    const withExtra = {
      ...stored().g,
      arming: "ambient",
      persistAcrossSpaNavigation: true,
    };
    const again = deps({ fences: { g: withExtra as RuleSpec } });
    ok(
      await declareBrowserGate(again.d, {
        id: "g",
        host: "a.example",
        returnsTo: ["Craft"],
        everyMinutes: 9,
        prompt: "why",
      }),
    );
    expect(again.stored().g).toMatchObject({
      arming: "ambient",
      persistAcrossSpaNavigation: true,
    });
    expect(stored().g.primitives).toHaveLength(1);
  });
});
