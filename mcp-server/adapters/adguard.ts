/**
 * AdGuard Home resolver adapter.
 *
 * Actuates resolver-enforcement fences by adding/removing `||host^` filter
 * rules in AdGuard Home's user-rules list. Zenborg-managed rules are tagged
 * with a `! zenborg-fence` comment line so they never clobber manually-added
 * rules.
 *
 * Credentials: ADGUARD_USER, ADGUARD_PASS env vars.
 * Base URL: ADGUARD_URL env var, defaults to http://piaf.local.
 */

import type { CooldownSpec } from "../../src/domain/intervention/Primitive.ts";
import type { RuleSpec, RuleScope } from "../../src/domain/intervention/RuleSpec.ts";

// ── Types ─────────────────────────────────────────────────────────────

export interface AdGuardAdapter {
  blockHosts: (hosts: string[]) => Promise<void>;
  unblockHosts: (hosts: string[]) => Promise<void>;
  checkReachable: () => Promise<boolean>;
}

/** The comment line that tags a zenborg-managed filter rule. */
export const FENCE_TAG = "! zenborg-fence";

// ── Pure helpers (exported for testing) ───────────────────────────────

/** Turn a host into the AdGuard filter-rule line, e.g. `||chess.com^`. */
export function hostToFilterRule(host: string): string {
  return `||${host}^`;
}

/** Extract the host from an AdGuard filter rule, or null if not a host rule. */
export function filterRuleToHost(rule: string): string | null {
  const m = rule.match(/^\|\|(.+)\^$/);
  return m ? m[1] : null;
}

/**
 * True when a line is a zenborg-managed rule or its tag comment.
 */
export function isZenborgRule(line: string): boolean {
  return line === FENCE_TAG || line.startsWith("||") && isTaggedAt(line);
}

/**
 * Check if a line is the filter rule immediately after a tag.
 * This is a helper -- the real grouping is done by `parseTaggedRules`.
 */
function isTaggedAt(_line: string): boolean {
  // Individual lines can't tell; grouping is context-dependent.
  // This exists only to satisfy the union in `isZenborgRule` for the common
  // single-line check. Real identification uses `parseTaggedRules`.
  return false;
}

/**
 * Parse the full user_rules array and return:
 * - `userRules`: lines NOT managed by zenborg (preserved verbatim)
 * - `zenborgHosts`: set of hosts currently blocked by zenborg
 */
export function parseTaggedRules(lines: readonly string[]): {
  userRules: string[];
  zenborgHosts: Set<string>;
} {
  const userRules: string[] = [];
  const zenborgHosts = new Set<string>();
  let inFenceBlock = false;

  for (const line of lines) {
    if (line === FENCE_TAG) {
      inFenceBlock = true;
      continue;
    }
    if (inFenceBlock) {
      const host = filterRuleToHost(line);
      if (host) {
        zenborgHosts.add(host);
      }
      inFenceBlock = false;
      continue;
    }
    userRules.push(line);
  }

  return { userRules, zenborgHosts };
}

/**
 * Compose the full rules array from user rules + desired zenborg hosts.
 * Each zenborg host gets a `! zenborg-fence` tag line followed by `||host^`.
 */
export function composeRules(
  userRules: readonly string[],
  zenborgHosts: ReadonlySet<string>,
): string[] {
  const result = [...userRules];
  for (const host of zenborgHosts) {
    result.push(FENCE_TAG, hostToFilterRule(host));
  }
  return result;
}

/**
 * Given existing rules and desired hosts, produce the new rules array:
 * add hosts in `toBlock`, remove hosts in `toUnblock`, preserve user rules.
 */
export function mergeRules(
  existing: readonly string[],
  toBlock: readonly string[],
  toUnblock: readonly string[],
): string[] {
  const { userRules, zenborgHosts } = parseTaggedRules(existing);
  for (const h of toBlock) zenborgHosts.add(h);
  for (const h of toUnblock) zenborgHosts.delete(h);
  return composeRules(userRules, zenborgHosts);
}

/**
 * Full sync: given the desired set of hosts, produce rules that have exactly
 * those hosts blocked (adding new ones, removing stale ones).
 */
export function syncRules(
  existing: readonly string[],
  desiredHosts: ReadonlySet<string>,
): string[] {
  const { userRules } = parseTaggedRules(existing);
  return composeRules(userRules, desiredHosts);
}

// ── Fence-to-host extraction ──────────────────────────────────────────

/**
 * Walk all fences and collect hosts from resolver-enforced cooldown primitives.
 * Returns the set of domains that should be blocked at the resolver level.
 */
export function collectResolverHosts(
  fences: Record<string, RuleSpec>,
): Set<string> {
  const hosts = new Set<string>();

  for (const rule of Object.values(fences)) {
    if (rule.scope.surface !== "browser") continue;
    const scope = rule.scope as Extract<RuleScope, { surface: "browser" }>;

    const hasResolverCooldown = rule.primitives.some(
      (p) =>
        p.kind === "cooldown" &&
        (p as CooldownSpec).enforcement?.at === "resolver",
    );

    if (!hasResolverCooldown) continue;

    const domains = Array.isArray(scope.domain)
      ? scope.domain
      : [scope.domain];
    for (const d of domains) {
      if (d.trim()) hosts.add(d);
    }
  }

  return hosts;
}

// ── HTTP adapter ──────────────────────────────────────────────────────

function baseUrl(): string {
  return process.env.ADGUARD_URL ?? "http://piaf.local";
}

function authHeader(): string {
  const user = process.env.ADGUARD_USER ?? "";
  const pass = process.env.ADGUARD_PASS ?? "";
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function adguardFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...((init?.headers as Record<string, string>) ?? {}),
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });
}

async function getUserRules(): Promise<string[]> {
  const res = await adguardFetch("/control/filtering/status");
  if (!res.ok) throw new Error(`AdGuard status ${res.status}`);
  const body = (await res.json()) as { user_rules?: string[] };
  return body.user_rules ?? [];
}

async function setUserRules(rules: string[]): Promise<void> {
  const res = await adguardFetch("/control/filtering/set_rules", {
    method: "POST",
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(`AdGuard set_rules ${res.status}`);
}

// ── Adapter factory ───────────────────────────────────────────────────

export function createAdapter(): AdGuardAdapter {
  return {
    async blockHosts(hosts: string[]): Promise<void> {
      if (hosts.length === 0) return;
      const existing = await getUserRules();
      const merged = mergeRules(existing, hosts, []);
      await setUserRules(merged);
    },

    async unblockHosts(hosts: string[]): Promise<void> {
      if (hosts.length === 0) return;
      const existing = await getUserRules();
      const merged = mergeRules(existing, [], hosts);
      await setUserRules(merged);
    },

    async checkReachable(): Promise<boolean> {
      try {
        const res = await adguardFetch("/control/status");
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

// ── Sync entry point ──────────────────────────────────────────────────

// ponytail: global lock via module-level state, per-account locks if throughput matters
let syncing = false;

/**
 * Sync resolver fences to AdGuard Home. Best-effort: logs a warning on
 * failure, never throws.
 *
 * @param readAllFences - callback that returns all standing fences
 */
export async function syncResolverFences(
  readAllFences: () => Record<string, RuleSpec>,
): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const adapter = createAdapter();

    const reachable = await adapter.checkReachable();
    if (!reachable) {
      console.error("[adguard] resolver unreachable, skipping fence sync");
      return;
    }

    const fences = readAllFences();
    const desiredHosts = collectResolverHosts(fences);

    const existing = await getUserRules();
    const newRules = syncRules(existing, desiredHosts);

    await setUserRules(newRules);
  } catch (e) {
    console.error("[adguard] fence sync failed:", (e as Error).message);
  } finally {
    syncing = false;
  }
}
