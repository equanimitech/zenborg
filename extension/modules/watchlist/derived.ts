/**
 * The derived observe set — fence domains ∪ area surface domains ∪ the
 * vault's mapped hosts.
 *
 * The manual watchlist is retired: a domain is auto-observed the moment it
 * appears in any fence or gets assigned as an area surface. This is the pure
 * merge; `store.ts#derivedObserveDomains` is the storage-reading wrapper
 * that feeds it `fenceCache` and the surface host map.
 *
 * Pure, no chrome APIs — same discipline as `fence/types.ts`.
 */

import type { Fences } from "../fence/types";

/**
 * Fence domains ∪ area surface domains ∪ vault hosts, deduped. Order is not
 * significant.
 *
 * `vaultHosts` is what the native host pushes as `observe`: every host the
 * vault maps to an area (`map_area` kind=host → `areas[].surfaces.hosts`),
 * plus browser fence domains. Mapping a streaming site to Entertainment is
 * what puts it on the observe tier; there is no list to keep beside the map.
 */
export function deriveObserveSet(
  fences: Fences,
  areaMap: Readonly<Record<string, string>>,
  vaultHosts: readonly string[] = []
): readonly string[] {
  const domains = new Set<string>();
  for (const fence of Object.values(fences)) {
    for (const d of fence.domains) {
      domains.add(d);
    }
  }
  for (const d of [...Object.keys(areaMap), ...vaultHosts]) {
    if (d.trim() !== "") {
      domains.add(d);
    }
  }
  return [...domains];
}
