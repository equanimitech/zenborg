import { describe, expect, it, vi } from "vitest";

// `project.ts` also exports `syncFenceRules`, which pulls in `./store`, which
// calls `storage.defineItem` at module load and throws outside a real extension
// environment (no `browser.runtime`). `buildDnrRules` never touches it, so this
// mock exists only to keep the import graph loadable in plain vitest — see `../drogues/blocklist/sync.test.ts`
// for the same pattern against the modules this one replaces.
vi.mock("./store", () => ({ fenceCache: { getValue: async () => ({}) } }));

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

  it("emits nothing when there are no domains", () => {
    const rules = buildDnrRules([]);
    expect(rules).toEqual([]);
  });
});
