import { describe, expect, it, vi } from "vitest";

// `project.ts` also exports `syncFenceRules`, which pulls in `./store`, which
// calls `storage.defineItem` at module load and throws outside a real extension
// environment (no `browser.runtime`). `buildDnrRules` never touches it, so this
// mock exists only to keep the import graph loadable in plain vitest — see `../drogues/blocklist/sync.test.ts`
// for the same pattern against the modules this one replaces.
vi.mock("./store", () => ({ liveFences: async () => ({}) }));

const { buildDnrRules } = await import("./project");

/**
 * `buildDnrRules` is the pure heart of the projector: a domain list in,
 * DNR rules out, no chrome and no storage. `syncFenceRules` is the thin
 * wrapper that resolves that list from state and hands them here.
 */
describe("buildDnrRules", () => {
  it("projects standing blocks onto the BLOCK_RULE_ID rule", () => {
    const rules = buildDnrRules(["chess.com", "youtube.com"]);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(1);
    expect([...rules[0].condition.requestDomains].sort()).toEqual([
      "chess.com",
      "youtube.com",
    ]);
  });

  it("an `all` rule and a `navigation` rule block different resource types", () => {
    const [all, nav] = buildDnrRules(["youtube.com"], ["chess.com"]);
    expect(all.condition.requestDomains).toEqual(["youtube.com"]);
    expect(all.condition.resourceTypes).toContain("websocket");
    expect(nav.id).not.toBe(all.id);
    expect(nav.condition.requestDomains).toEqual(["chess.com"]);
    expect([...nav.condition.resourceTypes]).toEqual(["main_frame", "sub_frame"]);
  });

  it("navigation-only blocks emit just the navigation rule", () => {
    const rules = buildDnrRules([], ["lichess.org"]);
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.resourceTypes).not.toContain("websocket");
  });

  it("emits nothing when there are no domains", () => {
    const rules = buildDnrRules([]);
    expect(rules).toEqual([]);
  });
});

describe("buildDnrRules — rationed pools", () => {
  it("gives each spent pool its own rule, sparing excluded hosts", () => {
    const rules = buildDnrRules([], [], [
      { pool: "youtube-weekend", domains: ["youtube.com", "youtu.be"], except: ["music.youtube.com"], reach: "navigation" },
    ]);
    expect(rules).toEqual([
      {
        id: 100,
        priority: 1,
        action: { type: "block" },
        condition: {
          requestDomains: ["youtube.com", "youtu.be"],
          excludedRequestDomains: ["music.youtube.com"],
          resourceTypes: ["main_frame", "sub_frame"],
        },
      },
    ]);
  });
});
