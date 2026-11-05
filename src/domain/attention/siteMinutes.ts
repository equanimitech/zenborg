/**
 * Attended minutes per site, per machine-local day.
 *
 * Dwell is `bouts()`, the extension's one dwell methodology (vendored in
 * `./browser`): focus/idle-gated, 30-min segment cap, deduped by id. A bout's
 * minutes land on the local day the bout started, as the hand-built
 * transform-effects readout did. A host includes its subdomains.
 *
 * A day counts as tracked when the browser logged anything that day, even with
 * zero minutes on every host. An untracked day is missing, not zero.
 */
import type { ActivityEvent } from "./browser/activity";
import { bouts } from "./browser/bouts";
import { createDomain } from "./browser/value-objects";

export interface SiteDay {
  /** Machine-local `YYYY-MM-DD`. */
  readonly day: string;
  /** Attended minutes per requested host (unrounded). */
  readonly minutes: Readonly<Record<string, number>>;
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The requested host a domain belongs to (longest match), if any. */
export function hostOf(
  domain: string,
  hosts: readonly string[],
): string | undefined {
  return [...hosts]
    .sort((a, b) => b.length - a.length)
    .find((h) => domain === h || domain.endsWith(`.${h}`));
}

/**
 * Per tracked local day in `[from, to)`, attended minutes per host.
 *
 * Pass events past `to` so the last bouts can finish; only bouts that start
 * inside the range are counted.
 */
export function siteMinutes(
  events: readonly ActivityEvent[],
  opts: { hosts: readonly string[]; from: number; to: number },
): readonly SiteDay[] {
  const hosts = opts.hosts.map((h) => createDomain(h) as string);
  const days = new Map<string, Record<string, number>>();
  const row = (day: string) => {
    let r = days.get(day);
    if (!r) {
      r = Object.fromEntries(hosts.map((h) => [h, 0]));
      days.set(day, r);
    }
    return r;
  };

  for (const e of events) {
    if (e.ts >= opts.from && e.ts < opts.to) row(localDay(e.ts));
  }
  for (const bout of bouts(events)) {
    if (bout.startTs < opts.from || bout.startTs >= opts.to) continue;
    const r = row(localDay(bout.startTs));
    for (const [domain, ms] of bout.byDomain) {
      const host = hostOf(domain, hosts);
      if (host) r[host] += ms / 60_000;
    }
  }

  return [...days.keys()].sort().map((day) => ({ day, minutes: row(day) }));
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean and median minutes per host across tracked days, rounded to 0.1. */
export function siteSummary(
  days: readonly SiteDay[],
  hosts: readonly string[],
): Record<string, { mean: number; median: number }> {
  return Object.fromEntries(
    hosts.map((h) => {
      const host = createDomain(h) as string;
      const values = days.map((d) => d.minutes[host] ?? 0);
      return [
        host,
        { mean: round1(mean(values)), median: round1(median(values)) },
      ];
    }),
  );
}
