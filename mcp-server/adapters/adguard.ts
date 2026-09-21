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

import * as fs from "node:fs";
import * as path from "node:path";
import type { CooldownSpec, Primitive, ScheduleSpec } from "../../src/domain/intervention/Primitive.ts";
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
 * Whether a primitive (or a schedule wrapping one) contains a standing or
 * long cooldown — the kind that should fan out to the resolver. Unwraps
 * through `schedule` the same way `carriesExit` does (Primitive.ts:237-247).
 */
function hasBlockingCooldown(p: Primitive): boolean {
  if (p.kind === "schedule") return hasBlockingCooldown((p as ScheduleSpec).wraps);
  if (p.kind !== "cooldown") return false;
  const cd = p as CooldownSpec;
  return cd.duration.type === "standing";
}

/**
 * Walk all fences and collect hosts from browser-scoped rules carrying a
 * standing cooldown. Any such fence should be enforced at the resolver too —
 * "one rule, one enforcement point" is about delivery attribution, not about
 * limiting which surfaces hold the block.
 *
 * Returns the set of domains that should be blocked at the resolver level.
 */
export function collectResolverHosts(
  fences: Record<string, RuleSpec>,
): Set<string> {
  const hosts = new Set<string>();

  for (const rule of Object.values(fences)) {
    if (rule.scope.surface !== "browser") continue;
    const scope = rule.scope as Extract<RuleScope, { surface: "browser" }>;

    if (!rule.primitives.some(hasBlockingCooldown)) continue;

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

// ── Resolver health record ────────────────────────────────────────────

export interface ResolverHealth {
  readonly reachable: boolean;
  readonly at: string; // ISO-8601
  readonly error?: string;
}

const HEALTH_FILE = path.join("plugin", "resolver-health.json");

function healthPath(vaultRoot: string): string {
  return path.join(vaultRoot, HEALTH_FILE);
}

function writeHealth(vaultRoot: string, health: ResolverHealth): void {
  const dir = path.dirname(healthPath(vaultRoot));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(healthPath(vaultRoot), JSON.stringify(health, null, 2), "utf8");
}

/** Read the last resolver sync outcome. Fail-soft: missing/garbled = null. */
export function readResolverHealth(vaultRoot: string): ResolverHealth | null {
  try {
    const raw = JSON.parse(fs.readFileSync(healthPath(vaultRoot), "utf8"));
    if (typeof raw?.reachable !== "boolean" || typeof raw?.at !== "string") return null;
    return raw as ResolverHealth;
  } catch {
    return null;
  }
}

// ── Sync entry point ──────────────────────────────────────────────────

// ponytail: global lock via module-level state, per-account locks if throughput matters
let syncing = false;

/**
 * Sync resolver fences to AdGuard Home. Best-effort: logs a warning on
 * failure, never throws. Records the outcome to resolver-health.json so
 * `get_fence` can report enforcement reach.
 *
 * @param readAllFences - callback that returns all standing fences
 * @param vaultRoot - vault root for writing the health record
 */
export async function syncResolverFences(
  readAllFences: () => Record<string, RuleSpec>,
  vaultRoot?: string,
): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const adapter = createAdapter();

    const reachable = await adapter.checkReachable();
    if (!reachable) {
      console.error("[adguard] resolver unreachable, skipping fence sync");
      if (vaultRoot) writeHealth(vaultRoot, { reachable: false, at: new Date().toISOString() });
      return;
    }

    const fences = readAllFences();
    const desiredHosts = collectResolverHosts(fences);

    const existing = await getUserRules();
    const newRules = syncRules(existing, desiredHosts);

    await setUserRules(newRules);
    if (vaultRoot) writeHealth(vaultRoot, { reachable: true, at: new Date().toISOString() });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[adguard] fence sync failed:", msg);
    if (vaultRoot) writeHealth(vaultRoot, { reachable: false, at: new Date().toISOString(), error: msg });
  } finally {
    syncing = false;
  }
}
