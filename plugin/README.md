# zenborg — Claude Code plugin

The garden's Claude Code surface. Three concerns, each its own file:

| File | Hook | What it does |
|---|---|---|
| `observe.mjs` | all 13 events | Append-only activity log to `~/.zenborg/keel/log/*.agent.jsonl` |
| `hooks/fences.mts` | PreToolUse | Fence enforcement — reads vault fences, escalation ladder |
| `hooks/gap-practice.mts` | UserPromptSubmit | Breath practice offered in the AI-wait gap |

Plus 9 skills that drive the garden from any session (sunrise, sunset, tend, weather, season, recap, close-up, onboarding, weekly-moments-review).

## Privacy

Everything stays on your machine. Events carry domains and timings, never prompts or content. Fail-open: if a hook errors, Claude keeps working.

## Install

Registered as a Claude Code plugin via `.claude-plugin/plugin.json`. No symlinks, no manual hook config.

## Dev

```bash
node --test plugin/observe.test.mjs plugin/hooks/fences.test.mjs plugin/hooks/gap-practice.test.mjs
```

Domain types live in `domain/intervention/` — shared with `src/domain/intervention/` (to be deduplicated).

Moment band: when the active moment is stale or none is set, a line above the prompt offers this phase's moments to tend, or routines to plant. The status line carries the active moment. Needs a Claude Code build that loads mods.
