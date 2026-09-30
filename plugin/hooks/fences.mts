#!/usr/bin/env node
/**
 * fences — the garden's PreToolUse reader.
 *
 * Reads the fences the principal declared and puts friction on crossing one.
 * It decides nothing on its own: the policy is a `RuleSpec` in the `fences`
 * collection, the ladder is that rule's ordered `primitives`, and this file
 * only resolves which rung a crossing lands on and renders it.
 *
 * ── Why this lives in zenborg and not in keel ───────────────────────────
 *
 * keel's agent surface is standalone `// @ts-check` JS that "deploys on its
 * own" and imports no TypeScript, so a policy it enforced would have to be a
 * hand-kept copy of the one in the domain — which is how two sources of truth
 * drift apart, and keel has already lost that fight once (its `watches` against
 * zenborg's `phaseConfigs`). Here the domain is one import away, so there is no
 * copy to keep. `scripts/shadow.mts` proved the pattern: plain node, explicit
 * `.ts` extensions, no build step.
 *
 * Both plugins run side by side and that is the migration, not a collision.
 * keel's `PreToolUse` writes the dispatch record and allows; this one may ask.
 * Capability moves plugin by plugin, and at step 6 keel's is deleted.
 *
 * ── What it will not do ─────────────────────────────────────────────────
 *
 * Always `deny`. The principal asked for a wall, and `ask` was a rubber stamp:
 * 35 crossings, 0 declines. A prompt the person never refuses is not friction,
 * it is noise. `deny` blocks the tool call and shows the reason, which is the
 * whole point of declaring a fence.
 *
 * Never act on a derivation. Only `fences` is read. Nothing here opens
 * `discrepancy.json`, which is the guard the 2026-08-20 decision rests on:
 * declared rules may act while migration step 2 is open, derived ones may not.
 *
 * Fail open, always. A hook that throws must not trap the person whose machine
 * it is running on.
 *
 * ── Fences that ask (pitch 2026-09-30) ─────────────────────────────────
 *
 * A stream fence asks where the work sits and responds by what the departure
 * costs (decision 2026-09-30): the agent declares with `declare_drift`, read
 * here at PreToolUse; near is held to a capture, far waits for a breakpoint,
 * inside and away pass. The garden, tool loading and the question are always
 * allowed, and the gardener's `cross: <reason>` (UserPromptSubmit, also here)
 * opens a pass. The key stays in the house.
 */

import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DriftDistance } from "../domain/attention/Discrepancy.ts";
import { shouldDeliver } from "../domain/intervention/Delivery.ts";
import type {
  GateSpec,
  Primitive,
  ScheduleSpec,
  CooldownSpec,
} from "../domain/intervention/Primitive.ts";
import type { RuleSpec } from "../domain/intervention/RuleSpec.ts";
import { rungFor } from "../domain/intervention/rules/sessionFence.ts";

const VAULT =
  process.env.ZENBORG_HOME ||
  process.env.KAIROS_HOME ||
  join(homedir(), ".zenborg");
const FENCES = join(VAULT, "fences.json");
/** Plugin-owned runtime state. Not a kernel collection: `fences` stays
 * single-writer (zenborg the app), and a crossing tally is not policy. */
const STATE_DIR = join(VAULT, "plugin");
const STATE = join(STATE_DIR, "fences-state.json");
/** Per-session state, the path stepping stones reserved. One file per session
 * so concurrent sessions never write the same file. */
const SESSIONS = join(STATE_DIR, "sessions");
const DESKTOP_LOG_DIR = join(VAULT, "log");

/** The key stays in the house: the garden, tool loading and the question
 * channel always get through, or a fence can lock you out of taking it down. */
const EXEMPT = (tool: string): boolean =>
  tool.startsWith("mcp__zenborg__") ||
  tool === "ToolSearch" ||
  tool === "AskUserQuestion";

/** What a near departure may still do: note it and return. A short constant,
 * not a config — grow it when a real capture is denied. */
const CAPTURE_TOOLS = new Set([
  "mcp__claude_ai_Linear__save_issue",
  "mcp__things-mcp__add_todo",
]);
const CAPTURE_PATH = /\/docs\/ideas\/|\/\.claude\/projects\/[^/]+\/memory\//;

function isCapture(tool: string, filePath: string): boolean {
  if (tool.startsWith("mcp__zenborg__") || CAPTURE_TOOLS.has(tool)) return true;
  return (tool === "Write" || tool === "Edit") && CAPTURE_PATH.test(filePath);
}

/** How long a gardener's `cross: <reason>` holds for the session. */
const PASS_MS = 15 * 60_000;
/** ponytail: a guess, like `idleGapMs`. Calibrate from logged declarations. */
const SWITCH_HOLD_MS = 60_000;

/**
 * Where fences are in force. A machine fact, not a rule fact — that this
 * person's repos live under `~/Developer` would be wrong on the next laptop,
 * so the rule does not assert it and the reader supplies it.
 */
const ROOTS = (process.env.ZENBORG_FENCE_ROOTS || join(homedir(), "Developer"))
  .split(":")
  .map((s) => s.trim())
  .filter(Boolean);

const allow = (): never => process.exit(0);

function readStdin(): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      raw += c;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => resolve(null));
  });
}

const norm = (p: string): string =>
  String(p ?? "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();

/** At or under `base`. Prefix matching on a path boundary, so `/dev/themia-x`
 * is not inside `/dev/themia`. */
function under(path: string, base: string): boolean {
  const p = norm(path);
  const b = norm(base);
  return b !== "" && p !== "" && (p === b || p.startsWith(`${b}/`));
}

function loadFences(): RuleSpec[] {
  try {
    const raw = JSON.parse(readFileSync(FENCES, "utf8"));
    const records = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return records.filter(
      (r: any) =>
        r?.scope?.surface === "session" && Array.isArray(r?.primitives),
    ) as RuleSpec[];
  } catch {
    return []; // No fences, unreadable, or garbled — all mean "nothing declared".
  }
}

/** This fence's tally: gates the person actually saw, and decision points the
 * randomiser declined. One read, because two would let the pair disagree. */
function tally(id: string): {
  crossings: number;
  declined: number;
  at: number;
} {
  try {
    const rec = JSON.parse(readFileSync(STATE, "utf8"))?.[id];
    return {
      crossings: Number(rec?.crossings) || 0,
      declined: Number(rec?.declined) || 0,
      at: Number(rec?.at) || 0,
    };
  } catch {
    return { crossings: 0, declined: 0, at: 0 };
  }
}

/** Temp file then rename — several sessions cross fences at once, and a
 * reader must never catch a half-written file. */
function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

function updateState(edit: (all: Record<string, any>) => void): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    let all: Record<string, any> = {};
    try {
      all = JSON.parse(readFileSync(STATE, "utf8")) ?? {};
    } catch {
      /* first crossing */
    }
    edit(all);
    writeJson(STATE, all);
  } catch {
    /* a tally that cannot be written must not stop the person */
  }
}

function recordCrossing(id: string, next: number, nextDeclined: number): void {
  updateState((all) => {
    all[id] = { crossings: next, declined: nextDeclined, at: Date.now() };
  });
}

/** The gardener's `cross: <reason>`, kept with its reason. Under `passes`, a
 * key the app's tally reader drops because it carries no `crossings`. */
function recordPass(sessionId: string, why: string): void {
  const at = Date.now();
  updateState((all) => {
    all.passes = {
      ...all.passes,
      [sessionId]: { reason: why, at, until: at + PASS_MS },
    };
  });
}

function passOpen(sessionId: string): boolean {
  try {
    const until = JSON.parse(readFileSync(STATE, "utf8"))?.passes?.[sessionId]
      ?.until;
    return Number(until) > Date.now();
  } catch {
    return false;
  }
}

// ── Declarations ────────────────────────────────────────────────────────

type Distance = "inside" | DriftDistance;
const DISTANCES: readonly Distance[] = ["inside", "near", "far", "away"];

interface Declaration {
  readonly fenceId?: string;
  readonly distance: Distance;
  readonly reason: string;
  readonly at: number;
  /** Set when the gardener's next message arrived after a `far`: that
   * message is the breakpoint, and the pass holds for the turn it opens. */
  readonly promptAt?: number;
}

const sessionFile = (sessionId: string): string =>
  join(SESSIONS, `${sessionId.replace(/[^\w-]/g, "")}.json`);

function readDeclaration(sessionId: string): Declaration | null {
  try {
    const d = JSON.parse(readFileSync(sessionFile(sessionId), "utf8"));
    return DISTANCES.includes(d?.distance) ? d : null;
  } catch {
    return null;
  }
}

function writeDeclaration(sessionId: string, d: Declaration | null): void {
  try {
    if (!d) return rmSync(sessionFile(sessionId), { force: true });
    mkdirSync(SESSIONS, { recursive: true });
    writeJson(sessionFile(sessionId), d);
  } catch {
    /* must not stop the person */
  }
}

// ── Breakpoints: the first one after a `far` declaration opens its pass ──

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Today's desktop events, from the tail of the file the observer writes
 * (local-date bucketed, like the writer). Missing log → none. */
function desktopEvents(): any[] {
  try {
    const fd = openSync(
      join(DESKTOP_LOG_DIR, `${localDay(new Date())}.desktop.jsonl`),
      "r",
    );
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, 512 * 1024);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n");
      if (len < size) lines.shift(); // a cut first line
      return lines.flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
}

/** Going idle, or leaving the app that was frontmost at declaration for at
 * least `SWITCH_HOLD_MS`. No area resolution: "left the task" is enough. */
function desktopBreakpoint(since: number, now: number): boolean {
  const events = desktopEvents().sort((a, b) => a.ts - b.ts);
  const app = (e: any): string => String(e?.payload?.app_name ?? "");
  const front = events
    .filter((e) => e.kind === "app_switched" && e.ts <= since)
    .pop();
  let awaySince: number | null = null;
  for (const e of events) {
    if (!(e.ts > since)) continue;
    if (e.kind === "idle_start") return true;
    if (e.kind !== "app_switched" || !front) continue;
    if (app(e) === app(front)) {
      if (awaySince !== null && e.ts - awaySince >= SWITCH_HOLD_MS) return true;
      awaySince = null;
    } else if (awaySince === null) awaySince = e.ts;
  }
  return awaySince !== null && now - awaySince >= SWITCH_HOLD_MS;
}

/** A planned cut: a phase start hour passed since the declaration. */
function phaseEdge(since: number, now: number): boolean {
  try {
    const raw = JSON.parse(
      readFileSync(join(VAULT, "phaseConfigs.json"), "utf8"),
    );
    return Object.values(raw ?? {}).some((c: any) => {
      if (!Number.isFinite(c?.startHour)) return false;
      const edge = new Date(now);
      edge.setHours(c.startHour, 0, 0, 0);
      if (edge.getTime() > now) edge.setDate(edge.getDate() - 1);
      return edge.getTime() > since;
    });
  } catch {
    return false;
  }
}

function farPassOpen(d: Declaration): boolean {
  const now = Date.now();
  return (
    Boolean(d.promptAt) || desktopBreakpoint(d.at, now) || phaseEdge(d.at, now)
  );
}

/** How long this rung asks the person to wait, in ms.
 *
 * Both shapes can hold a wait: a gate's `delay` friction and a cooldown's
 * `seconds` duration. A `standing` cooldown has no seconds and is not something
 * a session fence builds — it would be a wall, and the key is in the room. */
function dwellMs(rung: Primitive): number {
  if (rung.kind === "gate") {
    const f = (rung as GateSpec).frictionType;
    return f.type === "delay" ? Math.max(0, f.seconds) * 1000 : 0;
  }
  if (rung.kind === "cooldown") {
    const d = (rung as CooldownSpec).duration;
    return d.type === "seconds" ? Math.max(0, d.seconds) * 1000 : 0;
  }
  return 0;
}

function reason(fence: RuleSpec, rung: Primitive, at: string): string {
  const head = `[garden] ⌗ outside "${fence.name}"${at ? ` — ${at}` : ""}`;

  if (rung.kind === "cooldown") {
    const u = (rung as CooldownSpec).unlockPath;
    // The exit is the whole point of showing it: teeth that name no way out are
    // a punishment, and invariant 6 exists so this branch always has one.
    if (u.type === "unlock_with_intention") return `${head}. ${u.prompt}`;
    if (u.type === "out_of_band") return `${head}. ${u.note}`;
    return `${head}. The wait is the unlock.`;
  }

  const gate = rung as GateSpec;
  const f = gate.frictionType;
  const exit = gate.proceedAffordance?.label ?? "Cross anyway";
  if (f.type === "intention") return `${head}. ${f.prompt} (${exit}.)`;
  if (f.type === "delay")
    return `${head}. You sat ${f.seconds}s for this one. ${exit}, or take the fence down.`;
  return `${head}. You fenced this stream yourself. ${exit}.`;
}

const CAPTURES =
  "a zenborg moment, a Linear issue, a Things to-do, or a note under docs/ideas/";

/** A stream fence asks instead of naming a button nobody can click. The
 * ladder still escalates: its last rung adds its own question. */
function ask(
  fence: RuleSpec,
  rung: Primitive,
  d: Declaration | null,
  at: string,
): string {
  const head = `[garden] ⌗ outside "${fence.name}"${at ? ` — ${at}` : ""}`;
  const u = rung.kind === "cooldown" ? (rung as CooldownSpec).unlockPath : null;
  const again = u?.type === "unlock_with_intention" ? ` ${u.prompt}` : "";
  if (d?.distance === "near")
    return `${head}. Declared near: capture it and return (${CAPTURES}).${again}`;
  if (d?.distance === "far")
    return `${head}. Declared far: the work waits for a breakpoint (the gardener's next message, going idle, or leaving for another app). Capture it now if it helps (${CAPTURES}).${again}`;
  return `${head}. Declare with declare_drift: inside, near, far, or away? Near means capture only. (The gardener can also start a message with "cross: <reason>".)${again}`;
}

/** Stream fences — the classic `outside` match — in force for this cwd. */
function streamFencesFor(fences: RuleSpec[], cwd: string): RuleSpec[] {
  if (!cwd || !ROOTS.some((r) => under(cwd, r))) return [];
  return fences.filter(
    (f) =>
      ((f.scope as any).match ?? "outside") === "outside" &&
      f.primitives[0] !== undefined &&
      unwrapSchedule(f.primitives[0]) !== null,
  );
}

/** UserPromptSubmit: the gardener's channel. Ends the last turn's
 * declaration, takes `cross: <reason>`, and keeps the fence in view. */
function onPrompt(input: any, fences: RuleSpec[]): void {
  const sid = String(input?.session_id || "");
  const lines: string[] = [];

  if (sid) {
    const d = readDeclaration(sid);
    // A `far` still waiting: this message is its breakpoint. Anything else
    // lasted until now.
    if (d?.distance === "far" && !d.promptAt)
      writeDeclaration(sid, { ...d, promptAt: Date.now() });
    else if (d) writeDeclaration(sid, null);

    const m = /^\s*cross:\s*([\s\S]+)/i.exec(String(input?.prompt ?? ""));
    if (m) {
      const why = m[1].trim().slice(0, 500);
      recordPass(sid, why);
      lines.push(
        `[garden] Crossing recorded ("${why}"): the fence lets this session through for 15 minutes.`,
      );
    }
  }

  const streams = streamFencesFor(fences, String(input?.cwd || ""));
  for (const f of streams) {
    const desc = String(f.description ?? "").trim();
    const short = desc.length > 200 ? `${desc.slice(0, 199)}…` : desc;
    const paths = ((f.scope as { paths?: readonly string[] }).paths ?? []).join(
      ", ",
    );
    lines.push(
      `[garden] ⌗ Session fence "${f.name}" is up${short ? `: ${short}` : ""}. Inside: ${paths}.`,
    );
  }
  if (streams.length > 0)
    lines.push(
      "Before working outside it, declare with declare_drift (inside, near, far, or away). Near = capture only; far waits for a breakpoint.",
    );

  if (lines.length > 0)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: lines.join("\n"),
        },
      }),
    );
  process.exit(0);
}

// ── Schedule window evaluation ──────────────────────────────────────────

const WEEKDAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function currentWeekday(): string {
  return WEEKDAY_NAMES[new Date().getDay()];
}

function isInWindow(window: ScheduleSpec["window"]): boolean {
  const now = new Date();
  const hour = now.getHours();

  if (window.weekdays && window.weekdays.length > 0) {
    if (!window.weekdays.includes(currentWeekday() as any)) return false;
  }

  const { fromHour, toHour } = window;
  if (toHour <= fromHour) {
    // Wraps midnight: e.g. 22→06 means [22,24) ∪ [0,6)
    return hour >= fromHour || hour < toHour;
  }
  return hour >= fromHour && hour < toHour;
}

/** Unwrap a schedule primitive: if the current hour is inside the window,
 * return the wrapped primitive. If outside, return null for "inactive" or
 * the wrapped primitive for "passthrough". Recurses for nested schedules. */
function unwrapSchedule(p: Primitive): Primitive | null {
  if (p.kind !== "schedule") return p;
  const s = p as ScheduleSpec;
  if (!isInWindow(s.window)) {
    return s.outsideWindow === "passthrough" ? unwrapSchedule(s.wraps) : null;
  }
  return unwrapSchedule(s.wraps);
}

/** Is `path` inside ANY classic (outside-match) fence's enclosure? */
function inside(allFences: RuleSpec[], path: string): boolean {
  if (!path) return false;
  return allFences
    .filter((f) => (f.scope as any).match !== "inside")
    .some((f) =>
      ((f.scope as { paths: readonly string[] }).paths ?? []).some((p) =>
        under(path, p),
      ),
    );
}

const main = async (): Promise<void> => {
  const input = await readStdin();
  const fences = loadFences();
  if (input?.hook_event_name === "UserPromptSubmit") onPrompt(input, fences);

  const toolName = String(input?.tool_name || "").trim();
  const sid = String(input?.session_id || "");

  // The declaration is read here, at PreToolUse: the call's own message is not
  // in the transcript yet, so the tool call is the only channel that exists.
  if (toolName === "mcp__zenborg__declare_drift") {
    const t = input?.tool_input ?? {};
    if (sid && DISTANCES.includes(t.distance)) {
      const fenceId = streamFencesFor(fences, String(input?.cwd || ""))[0]?.id;
      writeDeclaration(sid, {
        ...(fenceId ? { fenceId } : {}),
        distance: t.distance,
        reason: String(t.reason ?? "").slice(0, 500),
        at: Date.now(),
      });
    }
    allow();
  }
  if (fences.length === 0 || EXEMPT(toolName)) allow();
  if (sid && passOpen(sid)) allow();

  const filePath = String(input?.tool_input?.file_path || "").trim();
  const cwd = String(input?.cwd || "").trim();
  const path = filePath || cwd;
  if (path === "" && toolName === "") allow();

  // In force only inside a declared root. Outside them — a temp dir, a config
  // file in $HOME — nothing is being crossed, and imposing friction on a path
  // the fence was never about is how a commitment device turns into noise.
  if (path && !ROOTS.some((r) => under(path, r))) allow();

  const aboveAFence =
    !filePath &&
    fences.some(
      (f) =>
        (f.scope as any).match !== "inside" &&
        ((f.scope as { paths?: readonly string[] }).paths ?? []).some((p) =>
          under(p, cwd),
        ),
    );

  let crossedFence: RuleSpec | null = null;

  for (const fence of fences) {
    const scope = fence.scope as {
      paths: readonly string[];
      match?: "outside" | "inside";
      tools?: readonly string[];
    };
    const matchDir = scope.match ?? "outside";

    // Tool filter: if the rule scopes to specific tools, skip non-matching
    if (scope.tools && scope.tools.length > 0) {
      if (!scope.tools.includes(toolName)) continue;
    }

    const insidePaths = path ? scope.paths.some((p) => under(path, p)) : false;

    if (matchDir === "outside") {
      // Classic session fence: friction when OUTSIDE the enclosed paths
      if (inside(fences, path)) continue; // inside any fence → no crossing
      // A cwd above the fence (the workspace root) says nothing about where
      // the call goes. Only a file path, or a cwd genuinely elsewhere, crosses.
      if (aboveAFence) continue;
      crossedFence = fence;
      break;
    }

    // match: "inside" — watering hours: friction when INSIDE the restricted paths
    if (insidePaths) {
      // Only fire if the schedule window is active
      const firstPrim = fence.primitives[0];
      if (firstPrim?.kind === "schedule") {
        if (!isInWindow((firstPrim as ScheduleSpec).window)) continue;
      }
      crossedFence = fence;
      break;
    }
  }

  if (!crossedFence) allow();
  const fence = crossedFence!;

  // A stream fence asks, and the declared distance sets the response.
  const stream = ((fence.scope as any).match ?? "outside") === "outside";
  const declared = stream && sid ? readDeclaration(sid) : null;
  if (stream) {
    if (declared?.distance === "inside" || declared?.distance === "away")
      allow();
    // Capture is allowed at every distance: the line is substantial work.
    if (isCapture(toolName, filePath)) allow();
    if (declared?.distance === "far" && farPassOpen(declared)) allow();
  }

  const { crossings: taken, declined: passed, at } = tally(fence.id);

  // Windowed tally reset: if last crossing is from a different day, reset
  // ponytail: daily reset; upgrade to per-window when phase boundaries matter
  let effectiveCrossings = taken;
  if (fence.primitives[0]?.kind === "schedule" && at > 0) {
    const lastDate = new Date(at).toDateString();
    if (lastDate !== new Date().toDateString()) effectiveCrossings = 0;
  }

  // The randomised decision point. A rule shipped below probability 1 must do
  // nothing at some eligible crossings, or its proximal outcome has nothing to be
  // read against.
  if (!shouldDeliver(Number(fence.deliveryProbability), Math.random())) {
    recordCrossing(fence.id, taken, passed + 1);
    allow();
  }

  const rung = rungFor(fence, effectiveCrossings);
  if (!rung) allow();

  const effective = unwrapSchedule(rung!);
  if (
    !effective ||
    (effective.kind !== "gate" && effective.kind !== "cooldown")
  )
    allow();

  // Near and far are already the question and the capture: no dwell on top
  // (decision 2026-09-30). The tally still climbs the ladder.
  const wait = declared ? 0 : dwellMs(effective);
  if (wait > 0) {
    // Real time, sat through. A message about waiting is not a wait.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  }
  recordCrossing(fence.id, effectiveCrossings + 1, passed);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: stream
          ? ask(fence, effective!, declared, path)
          : reason(fence, effective, path),
      },
    }),
  );
  process.exit(0);
};

main().catch(() => process.exit(0)); // fail-open
