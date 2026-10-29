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
import { LOCK_STALE_MS } from "../plugin/hooks/spend-refresh.ts";

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

const ABS_IN_COMMAND = /(?:~|\/)[\w.@-]*\/[^\s"'`;|&<>()]*/g;

/** Paths in an assistant record's tool_use inputs. Never tool results or text. */
function toolPaths(r: Record<string, any>): string[] {
  if (r.type !== "assistant" || !Array.isArray(r.message?.content)) return [];
  const out: string[] = [];
  for (const c of r.message.content) {
    if (c?.type !== "tool_use" || !c.input) continue;
    for (const k of ["file_path", "path", "notebook_path"])
      if (typeof c.input[k] === "string") out.push(c.input[k]);
    if (typeof c.input.command === "string")
      out.push(...(c.input.command.match(ABS_IN_COMMAND) ?? []));
  }
  return out;
}

/** One session transcript (plus its subagent files) as facts. */
export function readSession(file: string): SessionFacts {
  const s: SessionFacts = {
    id: path.basename(file, ".jsonl"),
    prUrls: [],
    turns: [],
    main: [],
    paths: [],
    subagents: [],
    agent: [],
  };
  const sidechain: number[] = [];
  for (const r of records(file)) {
    if (r.type === "pr-link" && typeof r.prUrl === "string")
      s.prUrls.push(r.prUrl);
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
    s.paths!.push(...toolPaths(r));
    if (r.type === "user" && !r.isMeta) {
      const text = userText(r.message?.content).replace(REMINDER, "").trim();
      if (text && !text.startsWith("<")) s.turns.push({ ts: t, text });
    }
  }
  s.agent.push(sidechain);
  const subDir = path.join(path.dirname(file), s.id, "subagents");
  if (fs.existsSync(subDir))
    for (const f of fs
      .readdirSync(subDir)
      .filter((f) => f.endsWith(".jsonl"))) {
      const rs = [...records(path.join(subDir, f))];
      s.agent.push(rs.map(ms).filter((t) => !Number.isNaN(t)));
      s.subagents!.push(
        rs.flatMap((r) => [...(r.cwd ? [r.cwd] : []), ...toolPaths(r)]),
      );
    }
  return s;
}

/** Sessions whose transcript was touched since the window opened. */
export function readSessions(
  projectsDir: string,
  fromMs: number,
): SessionFacts[] {
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

export const joinPath = (vault: string) =>
  path.join(vault, "cache", "linear-join.json");
export const spendCachePath = (vault: string) =>
  path.join(vault, "cache", "cycle-spend.json");

export function readJoin(vault: string): { join: LinearJoin; status: string } {
  try {
    const j = JSON.parse(fs.readFileSync(joinPath(vault), "utf8"));
    return {
      join: {
        generatedAt: j.generatedAt,
        issues: j.issues ?? {},
        prs: j.prs ?? {},
      },
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
    readSessions(
      opts.projectsDir ?? path.join(home, ".claude", "projects"),
      window.fromMs,
    ),
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
function shape(
  spend: Spend,
  allocations: readonly Allocation[],
  p: SpendParams,
  join: string,
) {
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
export function writeSpendCache(
  vault: string,
  cycleId: string,
  result: CycleSpendResult,
) {
  const file = spendCachePath(vault);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cycleId, ...result }));
}

export const today = () => dayOf(Date.now());

/**
 * Recompute the active cycle's spend and write the cache; returns a one-line
 * status. One refresh at a time: `cache/cycle-spend.lock`, stolen once stale.
 * Behind `zenborg-mcp refresh-spend` (the SessionStart hook) and
 * `pnpm spend:refresh`.
 */
export function refreshSpend(vault: string): string {
  const lock = path.join(vault, "cache", "cycle-spend.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch {
    if (Date.now() - fs.statSync(lock).mtimeMs < LOCK_STALE_MS)
      return "another refresh is running; skipping";
    fs.writeFileSync(lock, String(process.pid)); // steal the stale lock
  }
  try {
    let cycles: Record<
      string,
      {
        id: string;
        startDate: string;
        endDate: string | null;
        allocations?: Allocation[];
      }
    > = {};
    try {
      cycles = JSON.parse(
        fs.readFileSync(path.join(vault, "cycles.json"), "utf8"),
      );
    } catch {} // fail soft: no cycles.json = no active cycle
    const t = today();
    const c = Object.values(cycles)
      .filter((c) => c.startDate <= t && (c.endDate === null || c.endDate >= t))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (!c) return "no active cycle; nothing to refresh";
    const result = getCycleSpend(vault, c.allocations ?? [], {
      from: c.startDate,
      to: t,
    });
    writeSpendCache(vault, c.id, result);
    return `cycle-spend.json written: ${result.totalHours} h, ${result.allocations.length} allocations, join ${result.linearJoin}`;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
