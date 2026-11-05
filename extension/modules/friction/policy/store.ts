/**
 * Policy mirror — the surrounding context the extension needs from the host.
 *
 * The host is the source of truth; extensions cannot read the filesystem, so
 * the relay pulls this on every flush.
 *
 * ── What left at migration step 5 ───────────────────────────────────────
 *
 * `standing`, `armable` and `gates` used to live here. They were a projection of
 * `~/.zenborg/keel/rules/*.json`, which was a second declared-rule store beside
 * the `fences` collection, and the extension had to union the two on every
 * actuation. That store is retired: what is in force now arrives once, as the
 * pushed fence record, and the questions those three answered are asked of it
 * instead — `standingBlockHosts`, `fenceableHosts`, `gatesFrom`.
 *
 * What remains is genuinely other: transforms still come
 * off rules the host projects, and areas, the area map and the moment's
 * allow/deny pair are kernel collections rather than rules at all.
 *
 * Deliberately a *cache*, not a store: nothing here is authoritative, and a
 * stale or empty cache must fail toward the previous state rather than toward
 * unblocked.
 */

import type { MomentFriction } from "../../domain";
import { storage } from "wxt/storage";

/**
 * A DOM transform as the extension sees it, projected host-side from a rule's
 * `transform` primitive. Selectors travel as data; the interpreter is
 * `modules/friction/transform/apply.ts`.
 *
 * `replace` never arrives here — the host degrades it to `hide` rather than
 * shipping a templateId the extension has no registry for.
 */
export interface PageTransform {
  readonly ruleId: string;
  readonly domains: readonly string[];
  readonly targets: { readonly primary: string; readonly fallbacks: readonly string[] };
  readonly replacement:
    | { readonly type: "hide" }
    | { readonly type: "restyle"; readonly style: Readonly<Record<string, string>> }
    | { readonly type: "text"; readonly content: string };
}

/** DOM transforms declared by rules. */
export const pageTransforms = storage.defineItem<PageTransform[]>("local:policy:transforms", {
  fallback: [],
});

/**
 * The allow/deny hostname pair scoped by the moment running right now, or null
 * when none is. `allow` is seeded host-side from the moment's refs; `deny` is
 * carried whether or not anything fills it yet.
 *
 * Hostnames only ever arrive here — the refs they came from are full URLs and
 * stay on the host side of the relay.
 */
export const momentFriction = storage.defineItem<MomentFriction | null>(
  "local:policy:momentFriction",
  { fallback: null }
);

export interface AreaInfo {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  /** Hex, from the kernel. The one sanctioned accent. */
  readonly color?: string;
  readonly tags: readonly string[];
}

/** Areas the user has defined (imported from zenborg). */
export const areas = storage.defineItem<AreaInfo[]>("local:policy:areas", { fallback: [] });

/** Domain (or domain/path) → areaId. */
export const areaMap = storage.defineItem<Record<string, string>>("local:policy:areaMap", {
  fallback: {},
});

/**
 * Replace the mirror from a host policy pull.
 *
 * Absent fields are left alone; explicitly-empty ones are written. The dead-host
 * case is already covered upstream — `replacePolicy` is only ever called from a
 * well-formed `type: "policy"` message, so an unreachable or erroring host never
 * reaches this function at all and the previous mirror simply persists.
 *
 * This used to additionally ignore empty arrays. That was belt over braces, and
 * it made a *deliberate* lift impossible: disabling the only rule behind a
 * mirror makes the host send an empty list, which was then discarded, so the
 * old state held with nothing behind it and no way to see why. The same rule now
 * governs the fence cache, one layer over — malformed keeps, empty lands.
 */
export async function replacePolicy(policy: {
  readonly transforms?: readonly PageTransform[];
  readonly areas?: readonly AreaInfo[];
  readonly areaMap?: Readonly<Record<string, string>>;
  readonly momentFriction?: MomentFriction | null;
}): Promise<void> {
  // Replaced wholesale including the empty case: a transform that no longer has
  // a rule must stop hiding things. A stale mirror that keeps part of a page
  // invisible is indistinguishable from the site being broken.
  if (policy.transforms !== undefined) {
    await pageTransforms.setValue([...policy.transforms]);
  }
  // Areas and their domain map. Replaced wholesale including the empty case:
  // an area archived in the editor must stop being offered, and a domain
  // un-assigned there must stop being blocked.
  if (policy.areas !== undefined) {
    await areas.setValue([...policy.areas]);
  }
  if (policy.areaMap !== undefined) {
    await areaMap.setValue({ ...policy.areaMap });
  }
  // Replaced wholesale including null: a moment that has ended must stop
  // scoping anything. Same reasoning as gates — a boundary that no longer
  // exists should not keep speaking. Failing toward the area's own policy is
  // the right direction here; it is neither "block" nor "allow everything".
  if (policy.momentFriction !== undefined) {
    await momentFriction.setValue(policy.momentFriction);
  }
}
