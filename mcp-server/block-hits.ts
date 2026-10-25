/**
 * get_block_hits: how often a hard-blocked site was attempted, per host per
 * machine-local day.
 *
 * Reads `block_hit` events (domain and fence ids, never a URL) from the browser
 * log. A count of attempts, not a score: block hits feed nothing else.
 */
import { localDay } from "../src/domain/attention/siteMinutes.ts";
import { readActivityLog } from "./activity-log.js";

export interface BlockHitsParams {
  days: number;
  host?: string;
}

const isHost = (domain: string, host: string) =>
  domain === host || domain.endsWith(`.${host}`);

export function getBlockHits(
  dir: string,
  params: BlockHitsParams,
  now: number = Date.now(),
) {
  const t = new Date(now);
  const start = new Date(
    t.getFullYear(),
    t.getMonth(),
    t.getDate() - (params.days - 1),
  ).getTime();
  const events = readActivityLog(dir, start, now + 1, ["browser"]);
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "block_hit" || seen.has(e.id)) continue;
    seen.add(e.id);
    const domain = (e.payload as { domain?: unknown } | undefined)?.domain;
    if (typeof domain !== "string") continue;
    if (params.host && !isHost(domain, params.host)) continue;
    const key = `${localDay(e.ts)}\t${domain}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const daily = [...counts]
    .map(([key, hits]) => {
      const [day, host] = key.split("\t");
      return { day, host, hits };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.host.localeCompare(b.host));
  return {
    unit: "blocked load attempts per host per local day",
    from: localDay(start),
    to: localDay(now),
    total: daily.reduce((n, d) => n + d.hits, 0),
    daily,
  };
}
