/**
 * The derived observe set — fence domains ∪ area surface domains.
 *
 * The manual watchlist is retired: a domain is auto-observed the moment it
 * appears in any fence or gets assigned as an area surface. This is the pure
 * merge; `store.ts#derivedObserveDomains` is the storage-reading wrapper
 * that feeds it `fenceCache` and the surface host map.
 *
 * Pure, no chrome APIs — same discipline as `fence/types.ts`.
 */

import type { Fences } from "../fence/types";

/** Fence domains ∪ area surface domains, deduped. Order is not significant. */
export function deriveObserveSet(
  fences: Fences,
  areaMap: Readonly<Record<string, string>>
): readonly string[] {
  const domains = new Set<string>();
  for (const fence of Object.values(fences)) {
    for (const d of fence.domains) {
      domains.add(d);
    }
  }
  for (const d of Object.keys(areaMap)) {
    if (d.trim() !== "") {
      domains.add(d);
    }
  }
  return [...domains];
}
