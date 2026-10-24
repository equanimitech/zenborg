/**
 * Rule efficacy for browser gates: outcome-loop slice 3, browser side.
 *
 * Each `decision_point` is one chance for a rule to fire, delivered or
 * withheld by a draw at `p`. Because the draw is random, the difference
 * between the delivered and withheld arms in what happened next estimates the
 * rule's effect at that kind of moment (a micro-randomised trial).
 *
 * Proximal outcome: attended minutes on the point's host (subdomains included)
 * in `[ts, ts + windowMs)`, by the bout method. Lower means attention left.
 * Secondary: whether the next span to start inside the window is on another
 * host. A point settles only once its window has closed.
 *
 * Per rule only, never per person (docs/principles.md; the outcome-loop
 * pitch's no-gos). No statistics library: n per arm and the days they span.
 */
import type { ActivityEvent } from "../attention/browser/activity";
import { BOUT_GAP_MS, bouts, runs } from "../attention/browser/bouts";
import { createDomain } from "../attention/browser/value-objects";
import { hostOf, localDay, mean, round1 } from "../attention/siteMinutes";

export type Trigger = "dwell" | "entry" | "click";

/** The `decision_point` payload, plus the event's id and ts. */
export interface DecisionPoint {
  readonly id: string;
  readonly ts: number;
  readonly ruleId: string;
  readonly domain: string;
  readonly trigger: Trigger;
  readonly delivered: boolean;
  readonly p: number;
  readonly draw: number;
  readonly rung?: number | string;
  readonly windowMs: number;
  readonly servesAreaId?: string;
  /** Why a point was withheld: lost the draw, or another cue had it. */
  readonly reason?: "draw" | "superseded";
}

/** Pull decision points out of the log, deduped by id. Malformed ones are skipped. */
export function decisionPointsOf(
  events: readonly ActivityEvent[],
): DecisionPoint[] {
  const seen = new Set<string>();
  const out: DecisionPoint[] = [];
  for (const e of events) {
    if (e.kind !== "decision_point" || seen.has(e.id)) continue;
    const p = e.payload as Record<string, unknown>;
    if (
      typeof p.ruleId !== "string" ||
      typeof p.domain !== "string" ||
      typeof p.delivered !== "boolean" ||
      typeof p.windowMs !== "number" ||
      p.windowMs <= 0
    ) {
      continue;
    }
    seen.add(e.id);
    out.push({ ...(p as unknown as DecisionPoint), id: e.id, ts: e.ts });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

const MARK = "window_mark";

/**
 * Attended ms on `host` before `t`, exactly as `bouts()` counts the full stream.
 *
 * `bouts()` credits the gap after an event to the domain in flight, unless the
 * gap ends the bout (over `BOUT_GAP_MS`), in which case it credits nothing.
 * Cutting the stream at `t` and adding a domain-less mark there credits the
 * straddling gap up to `t`, which is right only when the full gap is credited
 * at all, so the mark goes in only then.
 */
function attendedBefore(
  sorted: readonly ActivityEvent[],
  t: number,
  host: string,
): number {
  const before = sorted.filter((e) => e.ts < t);
  const prev = before[before.length - 1];
  const next = sorted.find((e) => e.ts >= t);
  const mark: ActivityEvent[] =
    prev && next && next.ts - prev.ts <= BOUT_GAP_MS
      ? [
          {
            id: MARK,
            surface: "browser",
            kind: MARK,
            ts: t,
            sessionId: "",
            payload: {},
          },
        ]
      : [];
  let ms = 0;
  for (const bout of bouts([...before, ...mark])) {
    for (const [domain, v] of bout.byDomain) {
      if (hostOf(domain, [host])) ms += v;
    }
  }
  return ms;
}

const LOOKBACK_MS = 24 * 60 * 60_000;

export interface SettledPoint {
  readonly point: DecisionPoint;
  readonly minutesOnHost: number;
  readonly nextSpanElsewhere: boolean;
}

/**
 * Settle one point once its window has closed (`ts + windowMs <= asOf`),
 * else null. `events` are browser events, sorted by ts.
 */
export function settleBrowserPoint(
  point: DecisionPoint,
  events: readonly ActivityEvent[],
  asOf: number,
): SettledPoint | null {
  const end = point.ts + point.windowMs;
  if (end > asOf) return null;
  const host = createDomain(point.domain) as string;
  // ponytail: a 24h lookback rebuilds the walk's state at the window start
  // (domain in flight, focus). Widen it if a focus state ever outlives a day.
  const slice = events.filter(
    (e) => e.ts >= point.ts - LOOKBACK_MS && e.ts < end + BOUT_GAP_MS,
  );
  const ms =
    attendedBefore(slice, end, host) - attendedBefore(slice, point.ts, host);
  const next = runs(slice).find(
    (r) => r.startTs >= point.ts && r.startTs < end,
  );
  return {
    point,
    minutesOnHost: ms / 60_000,
    nextSpanElsewhere: next !== undefined && !hostOf(next.domain, [host]),
  };
}

export interface Arm {
  readonly n: number;
  /** Mean attended minutes on host in the window; null for an empty arm. */
  readonly meanMin: number | null;
  /** Points whose next span inside the window was on another host. */
  readonly nextSpanElsewhere: number;
}

export interface Comparison {
  readonly delivered: Arm;
  readonly withheld: Arm;
  /** delivered − withheld; null when either arm is empty. */
  readonly diffMin: number | null;
}

export interface RuleEfficacy extends Comparison {
  readonly ruleId: string;
  readonly domains: readonly string[];
  readonly windowMin: readonly number[];
  /** Withheld because another cue had the moment: outside the comparison. */
  readonly superseded: number;
  /** Randomised points whose window has not closed yet. */
  readonly unsettled: number;
  /** Distinct local days among the settled randomised points. */
  readonly days: number;
  /** Settled points whose window overlaps another point's window. */
  readonly overlapping: number;
  readonly byRung: Readonly<Record<string, Comparison>>;
  readonly byTrigger: Readonly<Record<string, Comparison>>;
  readonly line: string;
}

function arm(settled: readonly SettledPoint[]): Arm {
  return {
    n: settled.length,
    meanMin:
      settled.length === 0
        ? null
        : round1(mean(settled.map((s) => s.minutesOnHost))),
    nextSpanElsewhere: settled.filter((s) => s.nextSpanElsewhere).length,
  };
}

function compare(settled: readonly SettledPoint[]): Comparison {
  const delivered = arm(settled.filter((s) => s.point.delivered));
  const withheld = arm(settled.filter((s) => !s.point.delivered));
  return {
    delivered,
    withheld,
    diffMin:
      delivered.meanMin === null || withheld.meanMin === null
        ? null
        : round1(delivered.meanMin - withheld.meanMin),
  };
}

function splitBy(
  settled: readonly SettledPoint[],
  key: (p: DecisionPoint) => string,
): Record<string, Comparison> {
  const groups = new Map<string, SettledPoint[]>();
  for (const s of settled) {
    const k = key(s.point);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return Object.fromEntries([...groups].map(([k, g]) => [k, compare(g)]));
}

const signed = (n: number) =>
  n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function lineFor(
  ruleId: string,
  c: Comparison,
  domains: readonly string[],
  windowMin: readonly number[],
  days: number,
  overlapping: number,
): string {
  const on = `on ${domains.join(" / ")}`;
  const within =
    windowMin.length === 1 ? `in ${windowMin[0]} min` : "in each window";
  const over = `over ${plural(days, "day")}`;
  const overlap = overlapping > 0 ? `; ${overlapping} windows overlap` : "";
  const { delivered: d, withheld: w } = c;
  if (d.n === 0 && w.n === 0) return `${ruleId}: no settled points yet.`;
  if (w.n === 0) {
    return `${ruleId}: ${d.meanMin} min ${on} ${within} after a cue, n = ${d.n} ${over}; nothing withheld yet, so no comparison${overlap}.`;
  }
  if (d.n === 0) {
    return `${ruleId}: ${w.meanMin} min ${on} ${within} with the cue withheld, n = ${w.n} ${over}; nothing delivered yet, so no comparison${overlap}.`;
  }
  return `${ruleId}: ${signed(c.diffMin ?? 0)} min ${on} ${within} after a cue, n = ${d.n} / ${w.n} ${over}${overlap}.`;
}

function overlapCount(settled: readonly SettledPoint[]): number {
  const w = settled.map((s) => [s.point.ts, s.point.ts + s.point.windowMs]);
  return w.filter(([a, b], i) =>
    w.some(([c, d], j) => j !== i && a < d && c < b),
  ).length;
}

/**
 * Per rule, the delivered vs withheld comparison over points in `[from, to)`.
 *
 * `to` doubles as the settle clock: a point whose window runs past it is
 * unsettled. Pass `min(range end, now)`. Superseded points are counted but
 * kept out of the comparison: they were not randomised.
 */
export function ruleEfficacy(
  points: readonly DecisionPoint[],
  events: readonly ActivityEvent[],
  opts: { from: number; to: number },
): RuleEfficacy[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const sorted = [...byId.values()].sort((a, b) => a.ts - b.ts);
  const byRule = new Map<string, DecisionPoint[]>();
  for (const p of points) {
    if (p.ts < opts.from || p.ts >= opts.to) continue;
    byRule.set(p.ruleId, [...(byRule.get(p.ruleId) ?? []), p]);
  }

  return [...byRule.keys()].sort().map((ruleId) => {
    const all = byRule.get(ruleId) ?? [];
    const randomised = all.filter((p) => p.reason !== "superseded");
    const settled = randomised
      .map((p) => settleBrowserPoint(p, sorted, opts.to))
      .filter((s): s is SettledPoint => s !== null);
    const domains = [
      ...new Set(all.map((p) => createDomain(p.domain) as string)),
    ];
    const windowMin = [
      ...new Set(randomised.map((p) => round1(p.windowMs / 60_000))),
    ];
    const days = new Set(settled.map((s) => localDay(s.point.ts))).size;
    const overlapping = overlapCount(settled);
    const c = compare(settled);
    return {
      ruleId,
      domains,
      windowMin,
      ...c,
      superseded: all.length - randomised.length,
      unsettled: randomised.length - settled.length,
      days,
      overlapping,
      byRung: splitBy(settled, (p) => String(p.rung ?? "none")),
      byTrigger: splitBy(settled, (p) => p.trigger ?? "unknown"),
      line: lineFor(ruleId, c, domains, windowMin, days, overlapping),
    };
  });
}
