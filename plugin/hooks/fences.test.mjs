import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The hooks are .mts and read the vault at module load, so they are exercised
// as the hook runner exercises them: a fresh process, a payload on stdin, and
// the vault pointed somewhere disposable. This is also what proves the vendored
// `domain/` slice resolves from `hooks/`, which a unit test of the hook's
// helpers would not.
const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_ARGS = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];

function fenced() {
  const vault = mkdtempSync(join(tmpdir(), "zenborg-fences-"));
  const roots = mkdtempSync(join(tmpdir(), "zenborg-roots-"));
  const onStream = join(roots, "on-stream");
  mkdirSync(onStream, { recursive: true });

  // Built through the domain factory rather than hand-rolled, so the fixture
  // cannot drift from the shape the app writes.
  const rule = sessionFenceRule({
    id: "fence-test",
    label: "the merge",
    description: "a fence for the test",
    serves: { kind: "cycle", cycleId: "c1" },
    paths: [onStream],
    encloses: ["area-1"],
  });
  writeFileSync(join(vault, "fences.json"), JSON.stringify([rule]));
  return { vault, roots, onStream };
}

function runFences({ vault, roots }, filePath) {
  return execFileSync("node", [...NODE_ARGS, join(HERE, "fences.mts")], {
    input: JSON.stringify({
      session_id: "t",
      tool_name: "Read",
      tool_input: { file_path: filePath },
      cwd: filePath,
    }),
    env: { ...process.env, ZENBORG_HOME: vault, ZENBORG_FENCE_ROOTS: roots },
    encoding: "utf8",
  });
}

const { sessionFenceRule } = await import(
  "../domain/intervention/rules/sessionFence.ts"
);

test("a path inside the fence passes silently", () => {
  const f = fenced();
  assert.equal(runFences(f, join(f.onStream, "file.ts")), "");
});

test("a crossing asks, at the first rung, naming the stream", () => {
  const f = fenced();
  const out = runFences(f, join(f.roots, "elsewhere", "file.ts"));
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.equal(decision.hookEventName, "PreToolUse");
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /the merge/);
});

test("a path outside every root is not the fence's business", () => {
  const f = fenced();
  const outside = mkdtempSync(join(tmpdir(), "zenborg-outside-"));
  assert.equal(runFences(f, join(outside, "file.ts")), "");
});

test("no fences declared is silence, not a crash", () => {
  const vault = mkdtempSync(join(tmpdir(), "zenborg-empty-"));
  const roots = mkdtempSync(join(tmpdir(), "zenborg-roots-"));
  assert.equal(runFences({ vault, roots }, join(roots, "file.ts")), "");
});

// ── Watering hours ─────────────────────────────────────────────────────

/** Spawn the hook with a custom tool_name. */
function runFencesEx({ vault, roots }, filePath, toolName = "Read") {
  return execFileSync("node", [...NODE_ARGS, join(HERE, "fences.mts")], {
    input: JSON.stringify({
      session_id: "t",
      tool_name: toolName,
      tool_input: { file_path: filePath },
      cwd: filePath,
    }),
    env: { ...process.env, ZENBORG_HOME: vault, ZENBORG_FENCE_ROOTS: roots },
    encoding: "utf8",
  });
}

/** A minimal gate primitive for watering-hours tests. */
const CONFIRM_GATE = {
  kind: "gate",
  trigger: { type: "entry" },
  frictionType: { type: "confirmation" },
  proceedAffordance: { label: "Continue", action: { type: "continue" } },
  abortAffordance: { label: "Stop" },
};

const DELAY_GATE = {
  kind: "gate",
  trigger: { type: "entry" },
  frictionType: { type: "delay", seconds: 0 },
  proceedAffordance: { label: "Continue", action: { type: "continue" } },
};

/**
 * Build a watering-hours RuleSpec (match: "inside").
 * sessionFenceRule doesn't support match/tools, so hand-build.
 */
function wateringRule({ paths, tools, schedule } = {}) {
  const primitives = schedule
    ? [
        {
          kind: "schedule",
          window: schedule,
          wraps: CONFIRM_GATE,
          outsideWindow: "inactive",
        },
        DELAY_GATE,
      ]
    : [CONFIRM_GATE];

  return {
    id: "watering-test",
    name: "watering hours",
    description: "test watering",
    scope: {
      surface: "session",
      paths: paths ?? [],
      match: "inside",
      ...(tools ? { tools } : {}),
    },
    mechanism: "friction",
    fadeEligibility: "manual",
    outcome: {
      claim: "test",
      measure: { kind: "next_span_in", areaIds: ["a1"] },
      windowMs: 600_000,
    },
    serves: { kind: "cycle", cycleId: "c1" },
    deliveryProbability: 1,
    primitives,
  };
}

function watered(overrides = {}) {
  const vault = mkdtempSync(join(tmpdir(), "zenborg-water-"));
  const roots = mkdtempSync(join(tmpdir(), "zenborg-roots-"));
  const restricted = join(roots, "restricted-project");
  mkdirSync(restricted, { recursive: true });

  const rule = wateringRule({ paths: [restricted], ...overrides });
  writeFileSync(join(vault, "fences.json"), JSON.stringify([rule]));
  return { vault, roots, restricted };
}

test("match:inside fires when path IS inside the restricted paths", () => {
  const w = watered();
  const out = runFencesEx(w, join(w.restricted, "src", "app.ts"));
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /watering hours/);
});

test("match:inside is silent for paths outside the restricted paths", () => {
  const w = watered();
  const elsewhere = join(w.roots, "other-project", "file.ts");
  assert.equal(runFencesEx(w, elsewhere), "");
});

test("scope.tools skips a tool not in the list", () => {
  const w = watered({ tools: ["Edit", "Write"] });
  // Read is not in the list → silent
  assert.equal(runFencesEx(w, join(w.restricted, "file.ts"), "Read"), "");
});

test("scope.tools fires for a matching tool", () => {
  const w = watered({ tools: ["Edit", "Write"] });
  const out = runFencesEx(w, join(w.restricted, "file.ts"), "Edit");
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
});

test("schedule window covering all hours fires inside restricted path", () => {
  const w = watered({ schedule: { fromHour: 0, toHour: 24 } });
  const out = runFencesEx(w, join(w.restricted, "file.ts"));
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
});

test("schedule window on a different weekday is silent", () => {
  const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const otherDay = WEEKDAYS[(new Date().getDay() + 3) % 7];
  const w = watered({
    schedule: { fromHour: 0, toHour: 24, weekdays: [otherDay] },
  });
  assert.equal(runFencesEx(w, join(w.restricted, "file.ts")), "");
});

test("windowed tally resets when the last crossing was on a different day", () => {
  const vault = mkdtempSync(join(tmpdir(), "zenborg-water-"));
  const roots = mkdtempSync(join(tmpdir(), "zenborg-roots-"));
  const restricted = join(roots, "restricted");
  mkdirSync(restricted, { recursive: true });

  const rule = wateringRule({
    paths: [restricted],
    schedule: { fromHour: 0, toHour: 24 },
  });
  rule.id = "watering-daily";
  writeFileSync(join(vault, "fences.json"), JSON.stringify([rule]));

  // Pre-write state: 5 crossings from yesterday
  const stateDir = join(vault, "plugin");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "fences-state.json"),
    JSON.stringify({
      "watering-daily": {
        crossings: 5,
        declined: 0,
        at: Date.now() - 86_400_000,
      },
    }),
  );

  // With daily reset, effectiveCrossings → 0 → rung 0 (schedule wrapping
  // confirmation gate).  Without reset it would be 5 → rung 1 (delay gate,
  // whose reason contains "sat ... for this one").
  const out = runFencesEx({ vault, roots }, join(restricted, "file.ts"));
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  assert.doesNotMatch(
    decision.permissionDecisionReason,
    /sat.*for this one/,
    "should have reset to rung 0 (confirmation), not stayed at rung 1 (delay)",
  );
});

// ── ScheduleSpec-wrapped gates (outside-match fences) ─────────────────

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const OTHER_DAY = WEEKDAYS[(new Date().getDay() + 3) % 7];

function scheduleFenced(outsideWindow = "inactive", inWindow = true) {
  const vault = mkdtempSync(join(tmpdir(), "zenborg-fences-"));
  const roots = mkdtempSync(join(tmpdir(), "zenborg-roots-"));
  const onStream = join(roots, "on-stream");
  mkdirSync(onStream, { recursive: true });

  const window = inWindow
    ? { fromHour: 0, toHour: 24 }
    : { fromHour: 0, toHour: 24, weekdays: [OTHER_DAY] };

  const rule = {
    id: "fence-sched",
    name: "scheduled merge",
    description: "a scheduled fence",
    scope: { surface: "session", paths: [onStream] },
    mechanism: "friction",
    fadeEligibility: "manual",
    outcome: {
      claim: "test",
      measure: { kind: "next_span_in", areaIds: ["area-1"] },
      windowMs: 600000,
    },
    serves: { cycleId: "c1", areaId: "area-1" },
    deliveryProbability: 1,
    primitives: [
      {
        kind: "schedule",
        window,
        outsideWindow,
        wraps: {
          kind: "gate",
          trigger: { type: "entry" },
          frictionType: { type: "confirmation" },
          proceedAffordance: {
            label: "Cross anyway",
            action: { type: "continue" },
          },
          abortAffordance: { label: "Stay" },
        },
      },
    ],
  };
  writeFileSync(join(vault, "fences.json"), JSON.stringify([rule]));
  return { vault, roots, onStream };
}

test("a schedule-wrapped gate fires when the current hour is inside the window", () => {
  const f = scheduleFenced("inactive", true);
  const out = runFences(f, join(f.roots, "elsewhere", "file.ts"));
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /scheduled merge/);
});

test("a schedule-wrapped gate is silent when outside the window and outsideWindow is inactive", () => {
  const f = scheduleFenced("inactive", false);
  assert.equal(runFences(f, join(f.roots, "elsewhere", "file.ts")), "");
});

test("a schedule-wrapped gate fires when outside the window but outsideWindow is passthrough", () => {
  const f = scheduleFenced("passthrough", false);
  const out = runFences(f, join(f.roots, "elsewhere", "file.ts"));
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
});

// ── Fences that ask (pitch 2026-09-30) ───────────────────────────────────

const { existsSync: exists, readFileSync: read } = await import("node:fs");

/** Run the hook with a full Claude Code payload. */
function hook(f, payload) {
  return execFileSync("node", [...NODE_ARGS, join(HERE, "fences.mts")], {
    input: JSON.stringify({
      session_id: "s1",
      hook_event_name: "PreToolUse",
      ...payload,
    }),
    env: {
      ...process.env,
      ZENBORG_HOME: f.vault,
      ZENBORG_FENCE_ROOTS: f.roots,
    },
    encoding: "utf8",
  });
}
const decide = (out) => (out ? JSON.parse(out).hookSpecificOutput : null);
const elsewhere = (f) => join(f.roots, "zenborg", "src", "x.ts");
const edit = (f, file = elsewhere(f)) =>
  hook(f, { tool_name: "Edit", tool_input: { file_path: file }, cwd: f.roots });
const declare = (f, distance) =>
  hook(f, {
    tool_name: "mcp__zenborg__declare_drift",
    tool_input: { distance, reason: "because" },
    cwd: f.roots,
  });
const prompt = (f, text = "go on") =>
  hook(f, { hook_event_name: "UserPromptSubmit", prompt: text, cwd: f.roots });
const sessionPath = (f) => join(f.vault, "plugin", "sessions", "s1.json");

/** A far declaration made `ago` ms back, plus today's desktop log. */
function farWithLog(events, ago = 300_000) {
  const f = fenced();
  mkdirSync(join(f.vault, "plugin", "sessions"), { recursive: true });
  const at = Date.now() - ago;
  writeFileSync(
    sessionPath(f),
    JSON.stringify({ distance: "far", reason: "billing", at }),
  );
  if (events) {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    mkdirSync(join(f.vault, "log"), { recursive: true });
    const lines = events.map(([dt, kind, app]) =>
      JSON.stringify({
        id: String(dt),
        surface: "desktop",
        kind,
        ts: at + dt,
        sessionId: "",
        payload: app ? { app_name: app } : {},
      }),
    );
    writeFileSync(
      join(f.vault, "log", `${day}.desktop.jsonl`),
      `${lines.join("\n")}\n`,
    );
  }
  return f;
}

test("1. the garden, tool loading and clear_fence pass from an ancestor cwd", () => {
  const f = fenced();
  for (const tool_name of [
    "mcp__zenborg__add_moment",
    "ToolSearch",
    "mcp__zenborg__clear_fence",
    "AskUserQuestion",
  ])
    assert.equal(
      hook(f, { tool_name, tool_input: {}, cwd: f.roots }),
      "",
      tool_name,
    );
  // A pathless call from above the fence is neutral too; from elsewhere it crosses.
  assert.equal(
    hook(f, { tool_name: "Bash", tool_input: {}, cwd: f.roots }),
    "",
  );
  assert.equal(
    decide(
      hook(f, {
        tool_name: "Bash",
        tool_input: {},
        cwd: join(f.roots, "other"),
      }),
    ).permissionDecision,
    "deny",
  );
});

test("2. `cross: <reason>` opens a pass and records the reason", () => {
  const f = fenced();
  const ctx = decide(
    prompt(f, "cross: fixing the fence hook"),
  ).additionalContext;
  assert.match(ctx, /Crossing recorded/);
  assert.equal(edit(f), "");
  const state = JSON.parse(
    read(join(f.vault, "plugin", "fences-state.json"), "utf8"),
  );
  assert.equal(state.passes.s1.reason, "fixing the fence hook");
  assert.ok(state.passes.s1.until - state.passes.s1.at >= 14 * 60_000);
});

test("3. outside and undeclared is denied with the question", () => {
  const f = fenced();
  const d = decide(edit(f));
  assert.equal(d.permissionDecision, "deny");
  assert.match(d.permissionDecisionReason, /the merge/);
  assert.match(d.permissionDecisionReason, /declare_drift/);
});

test("the standing notice names the fence and the rule", () => {
  const f = fenced();
  const ctx = decide(prompt(f)).additionalContext;
  assert.match(ctx, /Session fence "the merge"/);
  assert.match(ctx, /a fence for the test/);
  assert.match(ctx, /declare_drift/);
});

test("4. near: a Linear issue passes, an Edit to src/ is told to capture and return", () => {
  const f = fenced();
  assert.equal(declare(f, "near"), "");
  const s = JSON.parse(read(sessionPath(f), "utf8"));
  assert.equal(s.distance, "near");
  assert.equal(s.fenceId, "fence-test");
  assert.equal(
    hook(f, {
      tool_name: "mcp__claude_ai_Linear__save_issue",
      tool_input: {},
      cwd: join(f.roots, "other"),
    }),
    "",
  );
  assert.equal(edit(f, join(f.roots, "themia", "docs", "ideas", "x.md")), "");
  const d = decide(edit(f));
  assert.equal(d.permissionDecision, "deny");
  assert.match(d.permissionDecisionReason, /capture it and return/);
});

test("near work repeated climbs the ladder without dwells", () => {
  const f = fenced();
  declare(f, "near");
  const t0 = Date.now();
  edit(f);
  edit(f);
  const third = decide(edit(f));
  assert.ok(Date.now() - t0 < 8_000, "a 10s or 30s dwell ran");
  assert.match(third.permissionDecisionReason, /What changed\?/);
});

test("inside and away pass; the next prompt ends the declaration", () => {
  const f = fenced();
  declare(f, "inside");
  assert.equal(edit(f), "");
  prompt(f);
  assert.equal(exists(sessionPath(f)), false);
  declare(f, "away");
  assert.equal(edit(f), "");
});

test("5. far, no desktop log: denied until the gardener's next message", () => {
  const f = fenced();
  declare(f, "far");
  assert.match(decide(edit(f)).permissionDecisionReason, /breakpoint/);
  prompt(f);
  assert.equal(edit(f), "");
  prompt(f);
  assert.equal(exists(sessionPath(f)), false);
});

test("5. far opens at idle_start", () => {
  const f = farWithLog([
    [-100_000, "app_switched", "cmux"],
    [100_000, "idle_start"],
  ]);
  assert.equal(edit(f), "");
});

test("5. far opens after a 90 s switch to HEY", () => {
  const f = farWithLog([
    [-100_000, "app_switched", "cmux"],
    [50_000, "app_switched", "HEY"],
    [140_000, "app_switched", "cmux"],
  ]);
  assert.equal(edit(f), "");
});

test("5. far stays shut after a 10 s switch to Slack", () => {
  const f = farWithLog([
    [-100_000, "app_switched", "cmux"],
    [50_000, "app_switched", "Slack"],
    [60_000, "app_switched", "cmux"],
  ]);
  assert.equal(decide(edit(f)).permissionDecision, "deny");
});

test("5. far opens at a phase edge", () => {
  const f = farWithLog(null);
  const hour = new Date().getHours();
  writeFileSync(
    join(f.vault, "phaseConfigs.json"),
    JSON.stringify({ p: { phase: "MORNING", startHour: hour } }),
  );
  // Declared an hour and a bit ago: this hour's start passed since.
  const s = JSON.parse(read(sessionPath(f), "utf8"));
  writeFileSync(
    sessionPath(f),
    JSON.stringify({ ...s, at: Date.now() - 3_700_000 }),
  );
  assert.equal(edit(f), "");
});
