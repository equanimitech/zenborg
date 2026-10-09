/**
 * Springs that draw into the activity log, run by the daemon via `jobs.json`.
 *
 *   zenborg-mcp spring git    [--days N]   → log/<day>.git.jsonl
 *
 * Each run rewrites every day file it covers (the last N calendar days, today
 * included, default 7), so a rerun replaces a day and never appends a
 * duplicate. The MCP server only ever reads these files; it never calls a
 * spring live.
 *
 * Privacy tier, settled with the gardener: git records repo + commit count.
 * No commit messages or diffs are ever requested, let alone written.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ActivityEvent } from "../src/domain/attention/ActivityEvent.ts";
import {
  localDate,
  wakingDay,
  wakingDayWindow,
} from "../src/domain/attention/GardenClock.ts";
import { logDir } from "./activity-log.ts";
import { readCollection } from "./vault.ts";

const DEFAULT_DAYS = 7;

/** The last `n` calendar days ending at `now`'s date, oldest first. */
export function recentDays(now: Date, n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(localDate(d.getTime()));
  }
  return days;
}

/**
 * Rewrite `log/<day>.<surface>.jsonl` for every day in `days` from `events`.
 * A day with no events loses its file, so a rerun is a replacement, not an
 * append. Events outside `days` are ignored.
 */
export function writeDays(
  dir: string,
  surface: "git",
  days: readonly string[],
  events: readonly ActivityEvent[],
): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const day of days) {
    const file = path.join(dir, `${day}.${surface}.jsonl`);
    const lines = events
      .filter((e) => localDate(e.ts) === day)
      .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
      .map((e) => JSON.stringify(e));
    if (lines.length === 0) {
      fs.rmSync(file, { force: true });
      continue;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${lines.join("\n")}\n`);
    fs.renameSync(tmp, file);
  }
}

// ── git ────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules"]);

/**
 * Repos at or beneath `roots`, at most `depth` levels down. A directory with a
 * `.git` directory is a repo and is not descended into. A `.git` file marks a
 * linked worktree or submodule: skipped, since its commits are its main
 * repo's. Hidden directories and unreadable ones are skipped.
 */
// ponytail: fixed depth 2 covers "area path = folder of repos"; raise it if a plot nests deeper.
export function discoverRepos(roots: readonly string[], depth = 2): string[] {
  const found = new Set<string>();
  const walk = (dir: string, left: number) => {
    const dotGit = path.join(dir, ".git");
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(dotGit);
    } catch {
      stat = undefined;
    }
    if (stat?.isDirectory()) {
      found.add(dir);
      return;
    }
    if (stat || left === 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), left - 1);
    }
  };
  for (const root of roots) walk(path.resolve(root), depth);
  return [...found].sort();
}

/**
 * The environment minus every `GIT_*` variable. Run from inside a git hook,
 * an inherited `GIT_DIR` / `GIT_INDEX_FILE` would override `-C` and point
 * every command at the hook's repo instead of the one being counted.
 */
export function gitFreeEnv(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !k.startsWith("GIT_")),
  );
}

function git(repo: string, args: readonly string[]): string {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: gitFreeEnv(),
    });
  } catch {
    return "";
  }
}

/**
 * Author times (epoch-ms) of the repo's own non-merge commits on any ref,
 * authored in `[from, to)`. "Own" is the repo's `user.email`; a repo without
 * one counts every author. Only `%at` is asked for: no message, no diff.
 */
export function commitTimes(repo: string, from: number, to: number): number[] {
  const email = git(repo, ["config", "user.email"]).trim();
  const out = git(repo, [
    "log",
    "--all",
    "--no-merges",
    // --since filters on committer date, which is never before author date.
    `--since=@${Math.floor(from / 1000)}`,
    ...(email ? ["--fixed-strings", `--author=${email}`] : []),
    "--format=%at",
  ]);
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => Number(l) * 1000)
    .filter((t) => t >= from && t < to);
}

/**
 * One event per (repo, waking day) with commits. `ts` is the waking day's
 * 04:00 start, so the line lands in that day's file and in that day's window.
 */
export function gitDayEvents(
  repo: string,
  times: readonly number[],
): ActivityEvent[] {
  const perDay = new Map<string, number>();
  for (const t of times) {
    const day = wakingDay(new Date(t));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return [...perDay.entries()].sort().map(([day, commits]) => ({
    id: `git:${day}:${repo}`,
    surface: "git",
    kind: "commits_counted",
    ts: wakingDayWindow(day).from,
    sessionId: "",
    payload: { repo: path.basename(repo), cwd: repo, commits },
  }));
}

/** Count commits per repo per day over the areas' paths and rewrite the days. */
export function drawGit(
  vaultRoot: string,
  areas: readonly { surfaces?: { paths?: readonly string[] } }[],
  days: readonly string[],
): number {
  const repos = discoverRepos(areas.flatMap((a) => a.surfaces?.paths ?? []));
  const from = wakingDayWindow(days[0]).from;
  const to = wakingDayWindow(days[days.length - 1]).to;
  const events = repos.flatMap((repo) =>
    gitDayEvents(repo, commitTimes(repo, from, to)),
  );
  writeDays(logDir(vaultRoot), "git", days, events);
  return events.length;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function daysArg(args: readonly string[]): number {
  const i = args.indexOf("--days");
  const n = i >= 0 ? Number(args[i + 1]) : DEFAULT_DAYS;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAYS;
}

/**
 * `zenborg-mcp spring <name> [--days N]`. Returns the exit code. Non-zero
 * means "didn't draw this time" (no key, vault unreadable, API down); the
 * daemon logs it as info. A missing key exits 1 without a word.
 */
export async function runSpring(
  vaultRoot: string,
  args: readonly string[],
  _env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<number> {
  const days = recentDays(now, daysArg(args));
  switch (args[0]) {
    case "git": {
      let areas: { surfaces?: { paths?: readonly string[] } }[];
      try {
        areas = Object.values(readCollection(vaultRoot, "areas"));
      } catch {
        return 1; // half-written areas.json: keep yesterday's files, try next run
      }
      drawGit(vaultRoot, areas, days);
      return 0;
    }
    default:
      process.stderr.write("usage: zenborg-mcp spring <git> [--days N]\n");
      return 2;
  }
}
