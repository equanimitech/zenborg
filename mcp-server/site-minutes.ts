/**
 * get_site_minutes: attended browser minutes per host, per period.
 *
 * Reads `log/*.browser.jsonl` and hands it to the pure `siteMinutes`. With
 * `compare`, a second period runs through the same path, which makes the
 * before/after table that `.claude/attently/browser-transform-effects.md`
 * once built by hand.
 */
import {
  localDay,
  round1,
  type SiteDay,
  siteMinutes,
  siteSummary,
} from "../src/domain/attention/siteMinutes.ts";
import { readActivityLog } from "./activity-log.js";

const DAY_MS = 24 * 60 * 60_000;

export interface SiteMinutesParams {
  hosts: string[];
  from: string;
  to: string;
  compare?: { from: string; to: string };
}

/** Local midnight of `YYYY-MM-DD`, plus `addDays` (DST-safe). */
function midnight(day: string, addDays = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + addDays).getTime();
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 0; midnight(from, i) < midnight(to, 1); i++) {
    out.push(localDay(midnight(from, i)));
  }
  return out;
}

function period(dir: string, hosts: string[], from: string, to: string) {
  const start = midnight(from);
  const end = midnight(to, 1);
  // A day past the end lets bouts that start inside the range finish.
  const events = readActivityLog(dir, start, end + DAY_MS, ["browser"]);
  const days: readonly SiteDay[] = siteMinutes(events, {
    hosts,
    from: start,
    to: end,
  });
  const tracked = new Set(days.map((d) => d.day));
  return {
    from,
    to,
    trackedDays: days.length,
    missingDays: daysBetween(from, to).filter((d) => !tracked.has(d)),
    summary: siteSummary(days, hosts),
    daily: days.map((d) => ({
      day: d.day,
      ...Object.fromEntries(
        Object.entries(d.minutes).map(([h, m]) => [h, round1(m)]),
      ),
    })),
  };
}

export function getSiteMinutes(dir: string, params: SiteMinutesParams) {
  const main = period(dir, params.hosts, params.from, params.to);
  const cmp = params.compare
    ? period(dir, params.hosts, params.compare.from, params.compare.to)
    : undefined;
  const { summary: mainSummary, ...mainRest } = main;
  const table = Object.keys(mainSummary).map((host) => ({
    host,
    period: mainSummary[host],
    ...(cmp ? { compare: cmp.summary[host] } : {}),
  }));
  return {
    unit: "attended minutes per tracked day",
    period: mainRest,
    ...(cmp ? { compare: (({ summary: _, ...rest }) => rest)(cmp) } : {}),
    table,
  };
}

/** Concise drops the daily rows; the table and period metadata stay. */
export function conciseSiteMinutes(payload: unknown): unknown {
  const p = payload as ReturnType<typeof getSiteMinutes>;
  const strip = <T extends { daily: unknown }>({ daily: _, ...rest }: T) =>
    rest;
  return {
    ...p,
    period: strip(p.period),
    ...(p.compare ? { compare: strip(p.compare) } : {}),
  };
}
