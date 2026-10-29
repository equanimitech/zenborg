/**
 * Cycle spend: what a cycle's days were spent on, read off session transcripts.
 *
 * Pure. The caller reads transcripts into `SessionFacts` (mcp-server/spend.ts)
 * and supplies the Linear join; nothing here touches disk or the clock.
 *
 * Hours are MERGED: every main-loop timestamp of every session is put on one
 * line, and each gap between neighbours (capped at 5 min) is charged once, to
 * whoever acted next. Parallel sessions never double-count. Never sum per
 * session. Calibrated on cycle 22 (docs: themia/.claude/attently/work-inflow.md).
 */
import { type Allocation, isBugsOpsLane } from "../entities/Allocation.ts";

export const GAP_CAP_S = 300;
/** 6 merged hours = 1 day. */
export const HOURS_PER_DAY = 6;
/** The day turns over at 03:00 Paris (zenborg's Evening ends at 03:00). */
export const DAY_TZ = "Europe/Paris";

export interface SessionFacts {
  id: string;
  cwd?: string;
  /** Last non-HEAD branch the session reported. */
  branch?: string;
  prUrls: string[];
  /** User-typed turns only: system reminders and tool results stripped out. */
  turns: { ts: number; text: string }[];
  /** Main-loop record timestamps (ms). */
  main: number[];
  /** Sidechain streams (ms): in-file sidechain records, one per subagent file. */
  agent: number[][];
}

/** The Linear join, cached by the `season` skill. */
export interface LinearJoin {
  generatedAt?: string;
  issues: Record<
    string,
    {
      title?: string;
      labels?: string[];
      project?: { url?: string; name?: string } | null;
    }
  >;
  /** PR url -> head branch (`dev-NNNN-…`). */
  prs: Record<string, string>;
}

export interface Window {
  fromMs: number;
  toMs: number;
}

export interface Bucket {
  hours: number;
  turns: number;
  agentHours: number;
}

export interface Spend {
  totalHours: number;
  turns: number;
  agentHours: number;
  allocations: (Bucket & { id: string; days: number; pct: number })[];
  unattributed: Bucket & { pct: number };
  /** Paris day -> merged hours and turns. */
  days: Record<string, { hours: number; turns: number }>;
}

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Paris calendar day of a timestamp, the day turning over at 03:00. */
export const dayOf = (ms: number): string => dayFmt.format(ms - 3 * 3_600_000);

/** First instant of a Paris day (03:00 local). */
export function dayStartMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 3);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: DAY_TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(guess)
      .map((x) => [x.type, Number(x.value)]),
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return guess - (asUtc - guess);
}

const inWindow = (w: Window) => (t: number) => t >= w.fromMs && t < w.toMs;

/** Sum of gaps, each capped; one stream. */
function activeHours(ts: number[]): number {
  const s = [...ts].sort((a, b) => a - b);
  let sec = 0;
  for (let i = 1; i < s.length; i++)
    sec += Math.min((s[i] - s[i - 1]) / 1000, GAP_CAP_S);
  return sec / 3600;
}

// ── Attribution ─────────────────────────────────────────────────────────────

// Not P-DEV (those are Linear projects).
const ISSUE = /(?<![A-Za-z-])DEV-(\d+)\b/gi;
const BRANCH = /\bdev-(\d+)/i;

const expandHome = (p: string, home: string) =>
  p.startsWith("~/") ? `${home}${p.slice(1)}` : p;
const isPath = (link: string) => link.startsWith("/") || link.startsWith("~/");
const hasExtension = (p: string) =>
  /\.[A-Za-z0-9]+$/.test(p.split("/").pop() ?? "");
const under = (child: string, parent: string) =>
  child === parent ||
  child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);

function allocationOfIssue(
  issue: LinearJoin["issues"][string] | undefined,
  allocations: readonly Allocation[],
): Allocation | undefined {
  if (!issue) return undefined;
  const labels = (issue.labels ?? []).map((l) => l.toLowerCase());
  if (
    labels.includes("bug") ||
    labels.includes("backfill") ||
    /^\s*run\s*:/i.test(issue.title ?? "")
  )
    return allocations.find(isBugsOpsLane);
  const url = issue.project?.url?.replace(/\/$/, "");
  return url
    ? allocations.find((a) => a.link.replace(/\/$/, "") === url)
    : undefined;
}

/**
 * The allocation a session belongs to, or null (unattributed, never Bugs & ops).
 *
 * Evidence, strongest first: issue ids from the branch and from PR head
 * branches (via the join), issue ids and link strings typed in user turns.
 * Votes are summed per allocation. No votes: the working directory.
 * Never reads anything but user turns, branch and PR links: MEMORY.md injects
 * ids into every session.
 */
export function attribute(
  s: SessionFacts,
  allocations: readonly Allocation[],
  join: LinearJoin,
  home = "",
): string | null {
  const votes = new Map<string, number>();
  const vote = (a: Allocation | undefined, w: number) =>
    a && votes.set(a.id, (votes.get(a.id) ?? 0) + w);
  const issueVote = (n: string, w: number) =>
    vote(allocationOfIssue(join.issues[`DEV-${n}`], allocations), w);

  const b = s.branch && BRANCH.exec(s.branch);
  if (b) issueVote(b[1], 3);
  for (const url of new Set(s.prUrls)) {
    const head = join.prs[url] && BRANCH.exec(join.prs[url]);
    if (head) issueVote(head[1], 3);
  }
  for (const t of s.turns) {
    for (const m of new Set([...t.text.matchAll(ISSUE)].map((x) => x[1])))
      issueVote(m, 1);
    for (const a of allocations) if (t.text.includes(a.link)) vote(a, 2);
  }
  if (votes.size > 0) {
    // allocation order breaks ties
    return allocations
      .filter((a) => votes.has(a.id))
      .reduce((best, a) => (votes.get(a.id)! > votes.get(best.id)! ? a : best))
      .id;
  }

  if (!s.cwd) return null;
  // A worktree belongs to the repo it hangs off.
  const cwd = s.cwd.split("/.claude/worktrees/")[0];
  const paths = allocations
    .filter((a) => isPath(a.link))
    .map((a) => ({ a, p: expandHome(a.link, home).replace(/\/$/, "") }));
  // The link is that repo (or a folder of it): deepest wins.
  const inside = paths
    .filter(({ p }) => !hasExtension(p) && under(cwd, p))
    .sort((x, y) => y.p.length - x.p.length)[0];
  if (inside) return inside.a.id;
  // A pitch (a file) inside the cwd's repo: only when it is the only one.
  const pitches = paths.filter(({ p }) => hasExtension(p) && under(p, cwd));
  return pitches.length === 1 ? pitches[0].a.id : null;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export function computeSpend(
  sessions: readonly SessionFacts[],
  allocations: readonly Allocation[],
  join: LinearJoin,
  window: Window,
  home = "",
): Spend {
  const inW = inWindow(window);
  const UNATTRIBUTED = "";
  const buckets = new Map<string, Bucket>(
    [UNATTRIBUTED, ...allocations.map((a) => a.id)].map((k) => [
      k,
      { hours: 0, turns: 0, agentHours: 0 },
    ]),
  );
  const days: Spend["days"] = {};
  const dayRow = (d: string) => (days[d] ??= { hours: 0, turns: 0 });

  const points: { t: number; key: string }[] = [];
  for (const s of sessions) {
    const key = attribute(s, allocations, join, home) ?? UNATTRIBUTED;
    const bucket = buckets.get(key)!;
    for (const t of s.main) if (inW(t)) points.push({ t, key });
    for (const t of s.turns)
      if (inW(t.ts)) {
        bucket.turns++;
        dayRow(dayOf(t.ts)).turns++;
      }
    for (const stream of s.agent)
      bucket.agentHours += activeHours(stream.filter(inW));
  }

  points.sort((a, b) => a.t - b.t);
  for (let i = 1; i < points.length; i++) {
    const d = dayOf(points[i].t);
    if (d !== dayOf(points[i - 1].t)) continue;
    const h =
      Math.min((points[i].t - points[i - 1].t) / 1000, GAP_CAP_S) / 3600;
    buckets.get(points[i].key)!.hours += h;
    dayRow(d).hours += h;
  }

  const sum = (f: (b: Bucket) => number) =>
    [...buckets.values()].reduce((s, b) => s + f(b), 0);
  const totalHours = sum((b) => b.hours);
  const un = buckets.get(UNATTRIBUTED)!;
  return {
    totalHours,
    turns: sum((b) => b.turns),
    agentHours: sum((b) => b.agentHours),
    allocations: allocations.map((a) => {
      const b = buckets.get(a.id)!;
      const days = b.hours / HOURS_PER_DAY;
      return { ...b, id: a.id, days, pct: (days / a.appetiteDays) * 100 };
    }),
    unattributed: {
      ...un,
      pct: totalHours > 0 ? (un.hours / totalHours) * 100 : 0,
    },
    days,
  };
}
