/**
 * The on-page chip's text, pure. One line per budgeted pool that covers `host`
 * today: `12 / 60 min`. Excluded hosts and out-of-window days yield nothing,
 * because `fencesFor` already skips them. A stale `rationSpent` reads as zero.
 */

import { fencesFor } from "./parse";
import { localDay, type RationSpent } from "./ration";
import type { Fences } from "./types";

export function chipLines(fences: Fences, spent: RationSpent | null, host: string, now: number): string[] {
  const minutes = spent && spent.day === localDay(now) ? spent.minutes : {};
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of fencesFor(fences, host)) {
    const b = f.budget;
    if (!b || seen.has(b.pool)) continue;
    seen.add(b.pool);
    lines.push(`${Math.floor(minutes[b.pool] ?? 0)} / ${b.minutes} min`);
  }
  return lines;
}
