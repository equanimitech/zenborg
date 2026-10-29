# zenborg — Claude Code plugin

The garden's Claude Code surface. Three concerns, each its own file:

| File | Hook | What it does |
|---|---|---|
| `observe.mjs` | all 13 events | Append-only activity log to `~/.zenborg/keel/log/*.agent.jsonl` |
| `hooks/fences.mts` | PreToolUse | Fence enforcement — reads vault fences, escalation ladder |
| `hooks/gap-practice.mts` | UserPromptSubmit | Breath practice offered in the AI-wait gap |
| `hooks/spend-warnings.mts` | UserPromptSubmit | Warns once per session at 70 % and 100 % of the allocation's appetite |
| `hooks/moment-awareness.mts` | SessionStart | Names the active moment, with the cycle spend line (`hooks/spend-line.ts`) |

Plus 9 skills that drive the garden from any session (sunrise, sunset, tend, weather, season, recap, close-up, onboarding, weekly-moments-review).

## Privacy

Everything stays on your machine. Events carry domains and timings, never prompts or content. Fail-open: if a hook errors, Claude keeps working.

## Install

Registered as a Claude Code plugin via `.claude-plugin/plugin.json`. No symlinks, no manual hook config.

## Dev

```bash
node --test plugin/observe.test.mjs plugin/hooks/fences.test.mjs plugin/hooks/gap-practice.test.mjs plugin/hooks/spend-warnings.test.mjs plugin/hooks/moment-awareness.test.mjs
```

Domain types live in `domain/intervention/` — shared with `src/domain/intervention/` (to be deduplicated).

Moment band: when the active moment is stale or none is set, a line above the prompt offers this phase's moments to tend, or routines to plant. The status line carries the active moment. Needs a Claude Code build that loads mods.

Phase pane: `/phase [day] [phase]` (`/phase tomorrow morning`, `/phase thu`) opens a phase's moments beside the chat, grouped by area, the drawing board below. `h`/`l` step the phase (and day), `0` returns to now, `j`/`k` walk the rows; on the focused row `p`/`n` move it a phase back or on, `t` to tomorrow, `b` to the board, `a` makes it active (today), and a board moment takes `i` to plant it in the shown phase. The line at the bottom asks Haiku for changes: it shows a preview, and nothing is written until Enter on the empty line (or `y`); `x` discards. Every write goes through the zenborg MCP tools.
