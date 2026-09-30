---
tag: pitch
appetite: small
status: draft
source: "conversation 2026-09-30: the DC data quality fence locked a session out of the garden and of its own clear_fence"
supersedes: []
decision: "docs/decisions/2026-09-30-regulate-drift-by-what-it-costs-attention-near-is-captured-f.md"
related: ["docs/pitches/2026-09-23-stepping-stones.md", "docs/ideas/2026-09-26-guest-override-for-fences.md", "docs/2026-08-20-evidence-check-on-graded-drift-and-the-premise-it-does-not-s.md"]
---

# Pitch -- Fences that ask: the fence reads the reason, not the path

**Bet:** A session fence stops judging by path and starts asking. The first tool call outside the fence gets a question: inside, near, far, or away? The agent answers with one declaration, and the decision's table sets the response: **near** = capture only, **far** = waits for the next breakpoint, **away** is out of the hook. The garden, the fence's own key, and a gardener's `cross:` always get through.

**Why it matters:** On 2026-09-30 the "DC data quality" fence (`themia/leggia`, `themia/docs`) blocked *every* call from a session in `~/Developer/themia`: tending the garden, loading tools, and `clear_fence` itself. `fences.mts:252` checks `tool_input.file_path || cwd`, so any call without a file path is judged by cwd, and the workspace root sits *above* the fence. It always denies. Its "Cross anyway" is text an agent cannot click, and nothing said in chat unlocks it. It was bypassed by setting `deliveryProbability` to 0 in the app, 11 crossings in. A fence that can lock you out of taking it down fails the garden's own rule: walls hold when the key is not in the room, and the key must stay *in the house*. And a path cannot say what the fence means: **no substantial work outside the stream; at worst, capture the idea.**

---

## Boundaries

**JBTD:** As the gardener fenced on "DC data quality", when a session wanders toward another stream, I want the agent to name the departure and hold near work to a capture, so that my attention stays in the stream without the fence ever standing between me and the garden.

**Baseline today:** `plugin/hooks/fences.mts:252` path = `file_path || cwd`; no tool exemptions; `permissionDecision: "deny"` on every rung; the `unlock_with_intention` prompt ("What changed?") has no channel for an answer.

**Out (no-gos):**
- **No second model.** The session's own model declares; it holds the whole conversation.
- **No transcript parsing.** Probed 2026-09-30: while a tool runs, the current assistant message (text *and* `tool_use`) is not yet in `transcript_path`, so a declaration written as text before a call cannot be read by that call's `PreToolUse`.
- **No `away` handling in the hook.** Away lives on browser, DNS, and phone surfaces. The rest/feed split and its vocabulary are the gardener's to set (see the decision's consequences).
- **No change to `RuleSpec` or the primitives schema.** The ladder, `deliveryProbability`, and the tally stay as they are.
- Signed docs are not edited.

## Elements

Slices ship in order A → B → C. Must-have = A, B. Should-have = C.

- **A. The key stays in the house** (`plugin/hooks/fences.mts`, `plugin/hooks/hooks.json` `UserPromptSubmit`).
  - Always allow: `mcp__zenborg__*`, `ToolSearch`, `AskUserQuestion`.
  - A cwd that is an **ancestor** of a fence path is neutral, not outside. Only a `file_path` outside the fence, or a cwd genuinely elsewhere, counts.
  - `cross: <reason>` at the start of the gardener's message: a `UserPromptSubmit` hook (it receives the prompt and `session_id` directly) opens a ~15 min pass for that session and records the crossing *with its reason* in `fences-state.json`. This is the channel `unlock_with_intention` never had.
  - Fixes today's lockout on its own.

- **B. Declare, then the table responds** (`mcp-server/index.ts`: new tool; `fences.mts`; `src/domain/attention/Discrepancy.ts` and its vendored copy).
  - New MCP tool `declare_drift { distance: "inside" | "near" | "far" | "away", reason, capture?: boolean }`. It is a `mcp__zenborg__*` tool, so it is exempt. The fence hook sees its `tool_input` and `session_id` at `PreToolUse` and writes the declaration to `~/.zenborg/plugin/sessions/<sessionId>.json`: the same path stepping stones reserved for per-session state, so the two converge rather than collide.
  - Standing notice: while a session fence is up, `UserPromptSubmit` adds context with the fence's name, description, and paths, plus the one rule: declare before working outside it.
  - Outside, undeclared → deny with the question as the reason: *Outside "DC data quality". Declare with `declare_drift`: inside, near, far, or away? Near means capture only.*
  - Response per the decision:
    | Declared | Hook response |
    |---|---|
    | `inside` | allow for this turn |
    | `near` | allow **capture tools only** (zenborg, Linear `save_issue`, Things `add_todo`, Write/Edit under `*/docs/ideas/` or the memory dir); deny the rest with "capture it and return" |
    | `far` | queued: the pass opens at the **first breakpoint** after the declaration (below). Until then, capture tools only |
    | `away` | allow; the hook does not regulate it |
  - **Breakpoints come from the log the garden already writes**, not a new sensor. `~/.zenborg/log/<day>.desktop.jsonl` records `app_switched` (207 on 2026-09-30: cmux, Slack, Brave, HEY…) and `idle_start`/`idle_end`. The first of these after a `far` declaration opens the pass:
    1. the gardener's next message;
    2. `idle_start`;
    3. an `app_switched` away from the session's terminal app that holds ≥ 60 s. Opening HEY or YouTube counts: focus has already left the task, so far work adds no new interruption;
    4. a phase edge from `phaseConfigs`, the same planned cut `deriveSpans` uses.
    The hook tails today's desktop log. No area resolution: "left the task" is enough, "left for which plot" is not needed. `ponytail:` the 60 s hold is a guess, like `idleGapMs`; calibrate from logged declarations. Upgrade to full span closes (`SpanDerivation`, area-resolved) if app switches prove too noisy.
  - A declaration lasts until the gardener's next message. Edit/Write outside the fence under `inside` still pass; nothing is re-asked mid-turn.
  - `DriftDistance = "near" | "far" | "away"` joins `Discrepancy.ts` in `src/domain/attention/` first, then the vendored copy, byte-identical, so `drift.test.mjs` stays green.
  - The ladder still applies: repeated near *work* attempts after a capture-only denial climb confirm → cooldown. Dwells are skipped for near and far per the decision.

- **C. Declarations become data** (`plugin/observe.mjs`; `mcp-server` trace reader).
  - Each declaration is logged as an event `{ sessionId, fenceId, distance, reason, at }`. Sunset can read "3 near departures today, all captured" without scoring them.
  - This is what makes the decision falsifiable: time-to-return after near-capture vs. near-work.

## Risks

**Rabbit holes:**
- *Breakpoint detection.* Read the desktop log's existing events only: no new writer, no commit watcher, no vendoring of `SpanDerivation` (its extensionless imports broke plain-node hooks before, per the 2026-08-20 decision). If the desktop writer is down, the next gardener message still opens the pass.
- *Reading a feed as a breakpoint is not endorsing it.* An app switch to YouTube is a feed drift on its own surface and stays under its own fence. The hook only notes that focus already left, so far work lands where it costs least (Iqbal & Bailey 2008: simple sensors predict interruptibility ~78%).
- *The capture-tool list.* A short constant, not a config. Grow it when a real capture is denied.
- *Self-declaration honesty.* The fenced agent classifies itself. Acceptable: the fence guards the gardener's attention, and every declaration is visible in chat and logged. Add a sampled audit only if the logs show mislabels.

**Off-sides:** keel's archived `PreToolUse` is gone, and nothing else writes `fences-state.json`. Stepping stones' session file is unbuilt; slice B creates the directory and the shape both use.

**Fat cut:** C can slip; A alone ends the lockout, A+B deliver the bet.

**Domain knowledge:** distance classifies commitment fit; the response is set by cost (decision 2026-09-30). Near is the costliest departure (interruption-similarity, attention residue), which is why it is held to capture.

## Acceptance

1. Under the DC fence, from `~/Developer/themia`: `mcp__zenborg__add_moment`, `ToolSearch`, and `clear_fence` all run with no denial and no declaration.
2. Gardener message `cross: fixing the fence hook` → tool calls outside the fence pass for ~15 min; `fences-state.json` holds the crossing with that reason.
3. Outside, undeclared → denied with the question naming the fence and `declare_drift`.
4. After `declare_drift { distance: "near" }`: `mcp__claude_ai_Linear__save_issue` passes; an `Edit` to `zenborg/src/...` is denied with "capture it and return".
5. After `declare_drift { distance: "far" }`: work tools are denied until a breakpoint, then pass. Tested with fixture desktop logs: `idle_start` → pass; a 90 s switch to HEY → pass; a 10 s switch to Slack → still denied; no desktop log → pass only after the next gardener message.
6. `plugin/domain/attention/Discrepancy.ts` is byte-identical to `src/domain/attention/Discrepancy.ts`; `drift.test.mjs` and `fences.test.mjs` pass.
7. (C) The day's trace lists each declaration with distance and reason.

---

_Drafted by Claude (scribe)._
