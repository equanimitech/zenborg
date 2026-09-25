---
tag: pitch
appetite: big
status: draft
source: "conversation 2026-09-23: activation as a side effect of starting work; wiki notes lull-n-learn/.claude/attently/zenborg-event-stream.md, zenborg-lull-connection.md"
supersedes: []
hard_dependency: "PR #215 (get_day_trace fix) merged before slice D"
related: ["#151", "#168", "#199", "#202", "#209", "docs/analytics-bridge.md", "docs/ideas/2026-05-31-connect-prompts-to-habits.md"]
---

# Pitch -- Stepping stones: activation as a side effect of starting work

**Bet:** A habit declares its stepping stones (`/lesson`, a cwd, a host, an app). Stepping on one activates that habit for *this session* and stamps every event with it. The gardener stops announcing intention; the trace stops guessing. Alongside, the agent log shrinks from 539 MB of tool payloads to the ten fields anyone reads.

**Why it matters:** Today one global `activeMoment.json` serves many parallel sessions, agents ignore the session-start proposal (~26 `set_active_moment` calls in three months), and cwd is the only classifier -- so a 22-minute Code de la route study at 09:21Z was logged as "build" in equanimi.tech. The garden cannot answer "where did my attention go" until the trace carries intention. Stepping stones are the rule change that makes attribution structural; more reminder text is a parameter tweak on a lever nobody pulls.

---

## Boundaries

**JBTD:** As the gardener running four sessions at once, when I type `/lesson code-de-la-route` or open `~/Developer/themia`, I want the garden to know which habit that is without my saying so, so that sunset can read back where attention went and the moment-awareness hook stops asking. Baseline today: `plugin/hooks/moment-awareness.mts:141-200` injects "Propose activating..." at SessionStart; the agent mostly does not; stale pointers only warn at >120 m; the log records `tool_input`/`tool_response` up to 2 KB per field (`plugin/observe.mjs:38-51`) and 188 lines carry secret-shaped strings.

**Out:**
- **Auto-planting moments.** A stepping stone resolves to a *habit*; it never fills a slot (principles.md §9, Downstream Allocation). Unplanted attention is reported, not planted.
- **Scoring, streaks, alignment %.** `get_day_trace` already says "no score"; this keeps it.
- **Week/season summaries, DNS querylog surface, study credits for reddit/youtube, lull-n-learn as oracle.** Follow-ups (#199, #202).
- **A stepping-stone editor in the app UI.** Stepping stones are edited via MCP `update_habit` or the JSON. Form later, at stone #10.
- **Rust changes.** `fs.rs` preserves unknown fields; the per-session pointer is plugin-owned, not a vault collection.
- **Prompt text in the log.** Only the slash-command name is stamped. Never the prompt body.

## Elements

Slices ship in order A → B → C → D. Must-have = A, B, C. Should-have = D.

- **A. Trim the agent log and migrate it** (`plugin/observe.mjs:73-83`; readers `mcp-server/activity-log.ts:57`, `mcp-server/attention.ts:180`). The writer emits `{ id, ts, surface, kind, sessionId, cwd, tool_name, momentId?, habitId?, skill? }` -- nothing else. `capPayload` goes away. A one-shot `scripts/migrate-agent-log.mts` rewrites `~/.zenborg/log/*.agent.jsonl` to that shape after copying the originals to `~/.zenborg/log.bak-2026-09-23/` (the gardener deletes the backup; the script never does). Readers already use only these fields; `fences.mts:252` reads hook stdin, so it is untouched. Casualty: study-lock/unlock pairing from `tool_input.command` -- slice B replaces it with the `skill` stamp.

- **B. Stepping stones on habits, resolved by one function** (`src/domain/entities/Habit.ts:22`; `src/domain/attention/AreaMap.ts:124`, `:163`). `Habit` gains `stones?: { prompts?, paths?, hosts?, apps? }`; `update_habit` (`mcp-server/index.ts:646`) accepts it. `indexSurfaces` grows a sibling `indexStepping stones(habits)`; `resolveArea` gets `resolveIntention(index, event) → { habitId?, areaId? }` with order **stepping stone habit > area surface > unclassified**. Longest path prefix wins, as today. Behavioral lever: the stepping stone is an implementation intention ("when I open X, I am doing Y") declared once on data (BCT 1.4), read by the trace as self-monitoring with no feedback score (BCT 2.3).

- **C. Per-session activation and release, as side effects** (`plugin/hooks/moment-awareness.mts:141`; `plugin/hooks/hooks.json` `UserPromptSubmit`, `SessionEnd`). A new hook `stones.mts` runs on SessionStart and UserPromptSubmit: it reads `cwd` and the leading `/command` from the prompt, resolves through `resolveIntention`, and writes `~/.zenborg/plugin/sessions/<sessionId>.json` = `{ habitId, momentId?, source: "stepping stone"|"manual", at }`. `momentId` is today's moment for that habit on the board if one exists (via `wakingDayKey`), else absent. `observe.mjs` reads that file per event and stamps `momentId`/`habitId`/`skill`. Release is also a side effect: SessionEnd deletes the file; a later prompt that matches a different stepping stone re-resolves; a pointer older than 2 h or from a past phase is dropped on the next event and one `intention_released { reason }` event is logged. No warning text, no ask. `activeMoment.json` stays the gardener's declared singleton (app + `set_active_moment`) and is the fallback for a session no stepping stone matched; a manual set inside a session writes `source: "manual"` and outranks stepping stones for that session. `moment-awareness.mts` shrinks to one line: `tentative: "revision code" via /lesson -- say otherwise`.

- **D. Sunset reads the day from one reader; garmin resumes** (`mcp-server/index.ts:4058` `get_attention`, `:4235` `get_day_trace`; `plugin/skills/sunset/SKILL.md:39`). Merge `getAttention` and `getDayTrace` into one `get_day_trace` that groups spans by `momentId` → `habitId` → area, per surface, and lists unplanted habit attention ("revision code, 22 m, not on today's board"). Sunset calls it and offers to plant the unplanted rows -- the gardener says yes or no. Fix the garmin interval job (`src-tauri/src/scheduler/mod.rs:143`; last file `2026-09-19.garmin.jsonl`). Browser and desktop events get their habit at read time through the same resolver -- no extension or Tauri writer change.

- **E. Name the doc contradiction, let Rafa decide.** `CLAUDE.md:80-82` says oracles live outside the vault because "oracles are about the gardener's tools, not the garden's data"; `torchbearer/docs/2026-05-31-the-boat.md:43` says the Sail "sets intention only; it does not store the passage". The code already stores the passage at `~/.zenborg/log` and exposes it through `get_day_trace`. Rafa's call this week: "the garden is everything -- the trace is garden data." Recommended edit: CLAUDE.md gains a "Trace" subsection (the log is garden data, written by surfaces, read by rituals, never mutated); the boat doc notes the Sail keeps its own logbook, the Wake reads it. Alternative: keep the docs and move the log out of `~/.zenborg`. Decision, not a silent resolve.

## Risks

**Rabbit holes:**
- Migrating 539 MB line by line in Node: stream per file, never load a day into memory; 17.8 MB days exist.
- Fuzzy matching prompt names to habits. Exact `/command` token match only; `aliases` already exist for names.
- Desktop `app_name` stepping stones for terminals and editors: skip, they are area-agnostic (analytics-bridge §A.1).
- Reconciling manual `set_active_moment` across sessions. Rule is one line: session file outranks the global pointer; do not build a merge.

**Off-sides:**
- `exits` on stepping stones (a `/study-unlock` that releases). Re-resolution on the next prompt covers it; add only if a session shows a wrong tail.
- Default `refs` carried from habit to moment (#209) -- adjacent, separate.
- Cross-session interruption accounting (#168 items 2-3).

**Fat cut:**
- A `sessions` vault collection. It would cost the registry, `fs.rs`, `vault.ts` and the parity test. A plugin sidecar costs one file per session and a `rm` on SessionEnd.
- Stamping browser/desktop events at write time. Read-time resolution through the same function is one implementation, not three.

**Domain knowledge:**
- Does `UserPromptSubmit` stdin carry `prompt` in every Claude Code version in use? Verify before B; the observe log shows `session_id` and `cwd` today.
- `wakingDayKey` (04:00 roll) governs "today's moment"; a NIGHT-phase session after midnight must resolve to the same day the board shows.
- `Moment.refs` must be URLs -- do not use `refs` to carry the stepping stone.

## Acceptance

1. After migration, every `*.agent.jsonl` line parses to the ten-field shape; `rg` for the secret-shaped patterns found this session returns 0 lines; `~/.zenborg/log.bak-2026-09-23/` holds the originals; a full day is under 1 MB.
2. `habits.json` carries `stones.prompts: ["/lesson","/read","/study"]` on habit `4a211aa5…` (revision code). Typing `/lesson code-de-la-route` in a session under `~/Developer/equanimitech/lull-n-learn` stamps that habit's id on every event of the session; `get_day_trace` attributes the span to Saperene, not equanimi.tech.
3. Two sessions in the same minute, one through `/lesson`, one in `~/Developer/themia`, carry different `habitId`s in the log. No global pointer changed.
4. SessionEnd removes the session file. A session idle 2 h then resumed logs one `intention_released` event and re-resolves on the next prompt. Nothing is printed to the gardener.
5. `moment-awareness.mts` output is one line when a stepping stone resolved, and contains no "Propose" when the session is already attributed.
6. `get_attention` is gone; `get_day_trace` returns per-surface spans grouped by moment → habit → area plus an `unplanted` list; sunset renders it and offers, never plants.
7. `2026-09-2X.garmin.jsonl` exists for the day slice D ships.
8. `CLAUDE.md:80-82` is amended or a decision is recorded declining to.

---

_Drafted by Claude (scribe)._
