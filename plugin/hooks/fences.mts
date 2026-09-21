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
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { shouldDeliver } from "../domain/intervention/Delivery.ts";
import type {
  GateSpec,
  Primitive,
  ScheduleSpec,
  CooldownSpec,
} from "../domain/intervention/Primitive.ts";
import type { RuleSpec } from "../domain/intervention/RuleSpec.ts";
import { rungFor } from "../domain/intervention/rules/sessionFence.ts";

const VAULT = process.env.ZENBORG_HOME || process.env.KAIROS_HOME || join(homedir(), ".zenborg");
const FENCES = join(VAULT, "fences.json");
/** Plugin-owned runtime state. Not a kernel collection: `fences` stays
 * single-writer (zenborg the app), and a crossing tally is not policy. */
const STATE_DIR = join(VAULT, "plugin");
const STATE = join(STATE_DIR, "fences-state.json");

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

function recordCrossing(id: string, next: number, nextDeclined: number): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    let all: Record<string, unknown> = {};
    try {
      all = JSON.parse(readFileSync(STATE, "utf8")) ?? {};
    } catch {
      /* first crossing */
    }
    all[id] = { crossings: next, declined: nextDeclined, at: Date.now() };
    // Temp file then rename — several sessions cross fences at once, and a
    // reader must never catch a half-written tally.
    const tmp = `${STATE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2));
    renameSync(tmp, STATE);
  } catch {
    /* a tally that cannot be written must not stop the person */
  }
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
  if (fences.length === 0) allow();

  const path = String(input?.tool_input?.file_path || input?.cwd || "").trim();
  const toolName = String(input?.tool_name || "").trim();
  if (path === "" && toolName === "") allow();

  // In force only inside a declared root. Outside them — a temp dir, a config
  // file in $HOME — nothing is being crossed, and imposing friction on a path
  // the fence was never about is how a commitment device turns into noise.
  if (path && !ROOTS.some((r) => under(path, r))) allow();

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

  const wait = dwellMs(effective);
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
        permissionDecisionReason: reason(fence, effective, path),
      },
    }),
  );
  process.exit(0);
};

main().catch(() => process.exit(0)); // fail-open
