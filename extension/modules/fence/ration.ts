/**
 * Rationed watering, the pure half: count a pool's attended minutes today and
 * decide whether its budget is spent.
 *
 * The count is `bouts()`, the one dwell methodology, so it agrees with
 * `get_site_minutes`. A bout's minutes land on the local day it started.
 * An unspent pool drops its fences out of the live set, the way a lift does;
 * a missing or stale count reads as zero, so a budget that cannot count never walls.
 */

import type { ActivityEvent } from "../domain/activity";
import { bouts } from "../domain/bouts";
import { isScheduleActive } from "./parse";
import type { Fence, Fences } from "./types";

export interface RationSpent {
  readonly day: string;
  readonly minutes: Readonly<Record<string, number>>;
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const covers = (domain: string, host: string) => host === domain || host.endsWith(`.${domain}`);

function budgeted(fences: Fences): Fence[] {
  return Object.values(fences).filter((f) => f.budget !== undefined);
}

export function poolMinutes(events: readonly ActivityEvent[], fences: Fences, now: number): Record<string, number> {
  const today = localDay(now);
  const pools = budgeted(fences);
  const out: Record<string, number> = {};
  for (const bout of bouts(events)) {
    if (localDay(bout.startTs) !== today) continue;
    for (const [domain, ms] of bout.byDomain) {
      const fence = pools.find(
        (f) => f.domains.some((d) => covers(d, domain)) && !f.budget!.exclude.some((x) => covers(x, domain)),
      );
      if (fence) out[fence.budget!.pool] = (out[fence.budget!.pool] ?? 0) + ms / 60_000;
    }
  }
  return out;
}

export function withRations(fences: Fences, spent: RationSpent | null, now: number): Fences {
  const minutes = spent && spent.day === localDay(now) ? spent.minutes : {};
  return Object.fromEntries(
    Object.entries(fences).filter(([, f]) => !f.budget || (minutes[f.budget.pool] ?? 0) >= f.budget.minutes),
  );
}

export function rationBlocks(
  fences: Fences,
): { pool: string; domains: string[]; except: string[]; reach?: "navigation" }[] {
  const byPool = new Map<string, { pool: string; domains: string[]; except: string[]; reach?: "navigation" }>();
  for (const f of budgeted(fences)) {
    if (f.enforcement.kind !== "block" || f.enforcement.enforcement !== "browser") continue;
    if (f.schedule && !isScheduleActive(f.schedule)) continue;
    const b = f.budget!;
    const entry = byPool.get(b.pool) ?? {
      pool: b.pool,
      domains: [],
      except: [],
      ...(f.enforcement.reach ? { reach: f.enforcement.reach } : {}),
    };
    entry.domains.push(...f.domains.filter((d) => !entry.domains.includes(d)));
    entry.except.push(...b.exclude.filter((x) => !entry.except.includes(x)));
    byPool.set(b.pool, entry);
  }
  return [...byPool.values()];
}

export function hasOpenRation(fences: Fences, now: Date): boolean {
  return budgeted(fences).some((f) => !f.schedule || isScheduleActive(f.schedule, now));
}
