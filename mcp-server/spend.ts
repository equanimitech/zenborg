/**
 * get_cycle_spend: reads Claude Code transcripts into `SessionFacts`, joins
 * them with the cached Linear join, and hands both to the pure `computeSpend`.
 *
 * Linear join: this process has no Linear API access, so the join is a JSON
 * file the `season` skill refreshes: `<vault>/cache/linear-join.json`
 * (shape: `LinearJoin`). Without it, issue-based attribution finds nothing
 * and the unattributed share says so.
 *
 * The result is cached at `<vault>/cache/cycle-spend.json` so hooks read it
 * without recomputing.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Allocation } from "../src/domain/entities/Allocation.ts";
import {
  computeSpend,
  dayOf,
  dayStartMs,
  HOURS_PER_DAY,
  type LinearJoin,
  type SessionFacts,
  type Spend,
  type Window,
} from "../src/domain/spend/CycleSpend.ts";

const REMINDER =
  /<system-reminder>[\s\S]*?<\/system-reminder>|<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g;

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ");
}

function* records(file: string): Generator<Record<string, any>> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

const ms = (r: Record<string, any>) =>
  typeof r.timestamp === "string" ? Date.parse(r.timestamp) : Number.NaN;

/** One session transcript (plus its subagent files) as facts. */
export function readSession(file: string): SessionFacts {
  const s: SessionFacts = {
    id: path.basename(file, ".jsonl"),
    prUrls: [],
    turns: [],
    main: [],
    agent: [],
  };
  const sidechain: number[] = [];
  for (const r of records(file)) {
    if (r.type === "pr-link" && typeof r.prUrl === "string") s.prUrls.push(r.prUrl);
    if (r.cwd && !s.cwd) s.cwd = r.cwd;
    if (r.gitBranch && r.gitBranch !== "HEAD") s.branch = r.gitBranch;
    const t = ms(r);
    if (Number.isNaN(t)) continue;
    // Headless runs (sdk-*) are not the gardener at the keyboard.
    if (String(r.entrypoint ?? "").startsWith("sdk")) continue;
    if (r.isSidechain) {
      sidechain.push(t);
      continue;
    }
    if (r.type !== "user" && r.type !== "assistant") continue;
    s.main.push(t);
    if (r.type === "user" && !r.isMeta) {
      const text = userText(r.message?.content).replace(REMINDER, "").trim();
      if (text && !text.startsWith("<")) s.turns.push({ ts: t, text });
    }
  }
  s.agent.push(sidechain);
  const subDir = path.join(path.dirname(file), s.id, "subagents");
  if (fs.existsSync(subDir))
    for (const f of fs.readdirSync(subDir).filter((f) => f.endsWith(".jsonl")))
      s.agent.push([...records(path.join(subDir, f))].map(ms).filter((t) => !Number.isNaN(t)));
  return s;
}

/** Sessions whose transcript was touched since the window opened. */
export function readSessions(projectsDir: string, fromMs: number): SessionFacts[] {
  if (!fs.existsSync(projectsDir)) return [];
  const out: SessionFacts[] = [];
  for (const dir of fs.readdirSync(projectsDir)) {
    const d = path.join(projectsDir, dir);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith(".jsonl"))) {
      const file = path.join(d, f);
      if (fs.statSync(file).mtimeMs >= fromMs) out.push(readSession(file));
    }
  }
  return out;
}

export const joinPath = (vault: string) => path.join(vault, "cache", "linear-join.json");
export const spendCachePath = (vault: string) => path.join(vault, "cache", "cycle-spend.json");

export function readJoin(vault: string): { join: LinearJoin; status: string } {
  try {
    const j = JSON.parse(fs.readFileSync(joinPath(vault), "utf8"));
    return {
      join: { generatedAt: j.generatedAt, issues: j.issues ?? {}, prs: j.prs ?? {} },
      status: `loaded${j.generatedAt ? ` (generated ${j.generatedAt})` : ""}`,
    };
  } catch {
    return {
      join: { issues: {}, prs: {} },
      status: `missing: ${joinPath(vault)} (the season skill refreshes it); issue-based attribution found nothing`,
    };
  }
}

export interface SpendParams {
  /** Paris days, inclusive. */
  from: string;
  to: string;
}

const round = (n: number, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

/** Pure spend run against disk. `to` is inclusive. */
export function getCycleSpend(
  vault: string,
  allocations: readonly Allocation[],
  params: SpendParams,
  opts: { projectsDir?: string; home?: string } = {},
) {
  const window: Window = {
    fromMs: dayStartMs(params.from),
    toMs: dayStartMs(addDay(params.to)),
  };
  const { join, status } = readJoin(vault);
  const home = opts.home ?? os.homedir();
  const spend = computeSpend(
    readSessions(opts.projectsDir ?? path.join(home, ".claude", "projects"), window.fromMs),
    allocations,
    join,
    window,
    home,
  );
  return shape(spend, allocations, params, status);
}

function addDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Rounded, named, hook-ready. */
function shape(spend: Spend, allocations: readonly Allocation[], p: SpendParams, join: string) {
  const byId = new Map(allocations.map((a) => [a.id, a]));
  return {
    from: p.from,
    to: p.to,
    computedAt: new Date().toISOString(),
    method: `merged main-loop hours (union across sessions, gaps capped at 5 min), ${HOURS_PER_DAY} h = 1 day; agent hours apart, not charged`,
    linearJoin: join,
    totalHours: round(spend.totalHours),
    turns: spend.turns,
    agentHours: round(spend.agentHours),
    allocations: spend.allocations.map((a) => ({
      id: a.id,
      name: byId.get(a.id)!.name,
      kind: byId.get(a.id)!.kind,
      appetiteDays: byId.get(a.id)!.appetiteDays,
      hours: round(a.hours),
      days: round(a.days),
      pct: Math.round(a.pct),
      turns: a.turns,
      agentHours: round(a.agentHours),
    })),
    unattributed: {
      hours: round(spend.unattributed.hours),
      pct: Math.round(spend.unattributed.pct),
      turns: spend.unattributed.turns,
      agentHours: round(spend.unattributed.agentHours),
    },
    days: Object.fromEntries(
      Object.entries(spend.days)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, v]) => [d, { hours: round(v.hours), turns: v.turns }]),
    ),
  };
}

export type CycleSpendResult = ReturnType<typeof getCycleSpend>;

/** What a hook needs, written beside the join. */
export function writeSpendCache(vault: string, cycleId: string, result: CycleSpendResult) {
  const file = spendCachePath(vault);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cycleId, ...result }));
}

export const today = () => dayOf(Date.now());
