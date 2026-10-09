/**
 * Arming a cooldown over the watched tier — the one gesture, shared by every
 * surface that offers it (popup button, keyboard shortcut, later the tray).
 *
 * Lives apart from `store.ts` so the popup and the service worker arm through
 * exactly the same path. A second arming path would be a second place for the
 * write-forward-only rule to be got wrong.
 *
 * Until modes land, the covered set is the observe tier — the domains zenborg
 * already watches for this user. zenborg ships no domains of its own (the drogue
 * seed is the lone consented exception), so an empty observe tier means this
 * covers nothing, and callers must say so rather than imply a lock that isn't
 * there.
 */

import { buildBrowserEvent } from "@/modules/activity/events";
import { appendEvent } from "@/modules/activity/log";
import { deriveObserveSet } from "@/modules/watchlist/derived";
import { areaMap, breakTarget, type BreakTarget } from "@/modules/friction/policy/store";
import { fenceableHosts } from "@/modules/fence/parse";
import { fenceCache } from "@/modules/fence/store";
import { DEFAULT_COOLDOWN_MS, armCooldown } from "./store";

export type { BreakTarget };

/** Rule id used until modes declare their own. */
export const WATCHED_COOLDOWN_RULE = "watched-cooldown";
export const BREAK_RULE = "content-break";

export interface ArmResult {
  readonly until: number;
  readonly domainCount: number;
}

/**
 * Take a break — pause the areas the break rule names.
 *
 * Areas, not domains: the rule says "Entertainment", the host resolves that to
 * whatever domains currently sit in it. A rule naming domains would go stale
 * the first time a new site appeared; one naming an area keeps working.
 */
export async function armBreak(
  source: "popup" | "keyboard" | "tray"
): Promise<ArmResult> {
  const target = await breakTarget.getValue();
  if (target === null || target.domains.length === 0) {
    // Nothing sorted into an area yet — say so rather than arm an empty lock.
    return { until: 0, domainCount: 0 };
  }
  const until = await armCooldown({
    ruleId: BREAK_RULE,
    domains: target.domains,
    durationMs: target.durationMs,
  });
  await appendEvent(
    buildBrowserEvent({
      id: crypto.randomUUID(),
      kind: "cooldown_set",
      ts: Date.now(),
      sessionId: "",
      payload: {
        source,
        rule: BREAK_RULE,
        durationMs: target.durationMs,
        domainCount: target.domains.length,
        areas: target.areas.map((a) => a.name).join(","),
      },
    })
  );
  return { until, domainCount: target.domains.length };
}

/**
 * Arm the watched-tier cooldown and log it.
 *
 * The log entry is the honest record of how often the lock gets reached for:
 * if arming climbs while watched dwell stays flat, it has become a coping
 * ritual rather than a boundary, and the design has failed. That ratio only
 * exists if every arming is recorded.
 */
export async function armWatchedCooldown(
  source: "popup" | "keyboard" | "tray",
  durationMs: number = DEFAULT_COOLDOWN_MS
): Promise<ArmResult> {
  // Prefer what the rules declare; fall back to the derive tier so the button
  // still does something before the first push lands.
  //
  // The declaration comes off the fence cache since migration step 5. It used to
  // come off the policy mirror, projected host-side from
  // `~/.zenborg/keel/rules/*.json`; that store is retired, and the candidate set
  // is the same question asked of the one that replaced it.
  //
  // The fallback leaves out the vault's mapped hosts on purpose: those join the
  // observe tier so embedded players are sensed, and every area's hosts — work
  // ones included — must not become a lock nobody declared.
  const fences = await fenceCache.getValue();
  const declared = [...fenceableHosts(fences)];
  const domains =
    declared.length > 0 ? declared : [...deriveObserveSet(fences, await areaMap.getValue())];
  const until = await armCooldown({
    ruleId: WATCHED_COOLDOWN_RULE,
    domains,
    durationMs,
  });
  await appendEvent(
    buildBrowserEvent({
      id: crypto.randomUUID(),
      kind: "cooldown_set",
      ts: Date.now(),
      sessionId: "",
      payload: { source, durationMs, domainCount: domains.length },
    })
  );
  return { until, domainCount: domains.length };
}
