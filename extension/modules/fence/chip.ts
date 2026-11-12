/**
 * The on-page chip's text, pure. One line per budgeted pool that covers `host`
 * today: `12 / 60 min`, then one closing line, `worth staying?`. Excluded hosts and out-of-window days yield nothing,
 * because `fencesFor` already skips them. A stale `rationSpent` reads as zero.
 */

import { fencesFor } from "./parse";
import { rationDay, type RationSpent } from "./ration";
import type { Fences } from "./types";

/** The closing line, static. The renderer sets it in sans: a sentence is never mono. */
export const CLOSING = "worth staying?";

export function chipLines(fences: Fences, spent: RationSpent | null, host: string, now: number): string[] {
  const minutes = spent && spent.day === rationDay(now) ? spent.minutes : {};
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of fencesFor(fences, host)) {
    const b = f.budget;
    if (!b || seen.has(b.pool)) continue;
    seen.add(b.pool);
    lines.push(`${Math.floor(minutes[b.pool] ?? 0)} / ${b.minutes} min`);
  }
  if (lines.length > 0) lines.push(CLOSING);
  return lines;
}
