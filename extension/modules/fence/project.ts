/**
 * Project the effective blocklist → declarativeNetRequest *dynamic* rules.
 *
 * The `fences` collection is the source of truth, pushed into
 * chrome.storage.local by the native host as the fence record; this projects
 * that cache onto a single idempotent `block` rule. Re-running replaces it, so
 * it stays in sync after any add/remove with no leftover state.
 *
 * Why `block` and not `redirect` to a branded page: DNR's `redirect` (and
 * `modifyHeaders`) actions require *host permissions* for the target domain.
 * zenborg ships ZERO host_permissions on purpose — that's the structural guarantee
 * that it cannot read your browsing. `block` needs no host access, so it
 * preserves that property while actually stopping the page from loading. The
 * cost is the generic browser "blocked" page instead of the zenborg block page.
 *
 * Uses the native `chrome.declarativeNetRequest` (always present in MV3; the
 * WXT `browser` shim does not surface this namespace). Errors are logged, never
 * swallowed — a silently-failing blocker is worse than no blocker.
 */

import { standingBlockHosts } from "./parse";
import { fenceCache } from "./store";

// Standing blocks, from the fence cache. Slice E had to give the fence record a
// THIRD rule id, because the policy mirror carried a second list of blocked
// hosts projected from `~/.zenborg/keel/rules/*.json` and the two refreshed on
// different schedules. Migration step 5 retired that store, so there is one
// source again and one rule id for it.
const BLOCK_RULE_ID = 1;
// Rule 2 once held the self-armed cooldown. Kept in removeRuleIds below so a
// browser that still has it installed gets it cleared.
const COOLDOWN_RULE_ID = 2;

// All resource types, main_frame + sub_frame included, so a blocked domain is
// stopped whether navigated to directly or embedded.
const ALL_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "script",
  "image",
  "media",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "font",
  "stylesheet",
  "websocket",
  "webtransport",
  "other",
] as const;

interface DnrRule {
  id: number;
  priority: number;
  action: { type: "block" };
  condition: { requestDomains: string[]; resourceTypes: readonly string[] };
}

type Dnr = {
  updateDynamicRules(options: {
    removeRuleIds?: number[];
    addRules?: DnrRule[];
  }): Promise<void>;
  getDynamicRules?(): Promise<unknown[]>;
};

function getDnr(): Dnr | null {
  const c = (globalThis as { chrome?: { declarativeNetRequest?: Dnr } }).chrome;
  return c?.declarativeNetRequest ?? null;
}

/**
 * The pure projection: the blocked domains → the DNR rule that enforces them.
 *
 * Kept separate from `syncFenceRules` so the mapping is testable without
 * mocking chrome or storage.
 */
export function buildDnrRules(blockDomains: readonly string[]): DnrRule[] {
  const rules: DnrRule[] = [];
  if (blockDomains.length > 0) {
    rules.push({
      id: BLOCK_RULE_ID,
      priority: 1,
      action: { type: "block" },
      condition: {
        requestDomains: [...blockDomains],
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    });
  }
  return rules;
}

export async function syncFenceRules(): Promise<void> {
  const dnr = getDnr();
  if (!dnr) {
    console.error("[zenborg fence] chrome.declarativeNetRequest unavailable");
    return;
  }

  // The fence cache is the source, and it is read from local storage — no round
  // trip, so a navigation never waits on the host and a dead host never lifts a
  // shield. Only browser-enforced standing cooldowns arrive here; a resolver
  // block holds somewhere this surface is not.
  //
  // The reliability claim that used to belong to the policy mirror moves here
  // unchanged, and is stronger: `replaceFences` keeps the previous cache when a
  // push is malformed and applies an explicitly empty one, so a dead host cannot
  // lift a standing block and a fence taken down still comes down. The uncovered
  // case is the same as before — a fresh profile that has never been pushed to
  // blocks nothing until the relay first answers.
  const domains = standingBlockHosts(await fenceCache.getValue());

  const addRules = buildDnrRules(domains);
  try {
    await dnr.updateDynamicRules({
      removeRuleIds: [BLOCK_RULE_ID, COOLDOWN_RULE_ID],
      addRules,
    });
    console.info(`[zenborg fence] synced ${domains.length} fenced domain(s)`, domains);
  } catch (err) {
    console.error("[zenborg fence] updateDynamicRules failed:", err);
  }
}
