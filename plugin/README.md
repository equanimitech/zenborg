# zenborg — Claude Code plugin

A garden for your attention. Plant what you want to grow, grow it with the people and
places you care about, fence out the weeds, and return to tend it every day.

**You are the gardener.** Your garden is your habit ecosystem, digital and physical. You
are responsible for tending it, and you already do. Zenborg is the toolshed; this plugin
is the part of it you reach from a Claude Code session. The everyday question is
*"What will I tend to today?"*

It is not a habit tracker, not a task manager, not a screen-time app. No streaks, no
scores, no notifications.

## Skills

| Gesture | Skills |
|---|---|
| 🌱 Plant | `onboarding` (first garden), `tend` (plant and move moments), `season` (plan and review a cycle) |
| 🤝 Companion | people and places, woven through `onboarding` and `tend` |
| 🚧 Fence | the fences hook below; declare fences in `onboarding` or with the MCP fence tools |
| 🪴 Tend | `sunrise`, `sunset`, `weather`, `weekly-moments-review`, `close-up` |

Plus `oracle-wizard` and `oracle-probe`, for connecting the garden to the tools you
already use (journal, body, tasks).

## Hooks

Each concern is its own file:

| File | Hook | What it does |
|---|---|---|
| `observe.mjs` | all 13 events | Append-only activity log to `~/.zenborg/keel/log/*.agent.jsonl` |
| `hooks/fences.mts` | PreToolUse | A gentle fence: reads the fences you declared and asks before a session wanders past one, with an exit on every rung |
| `hooks/gap-practice.mts` | UserPromptSubmit | A breath practice offered in the gap while the agent works |
| `hooks/moment-awareness.mts` | SessionStart | Names the moment you are tending, so the session starts with your intention |

## Privacy

Everything stays on your machine. Events carry domains and timings, never prompts or content. Fail-open: if a hook errors, Claude keeps working.

## Install

Registered as a Claude Code plugin via `.claude-plugin/plugin.json`. No symlinks, no manual hook config.

## Dev

```bash
node --test plugin/observe.test.mjs plugin/hooks/fences.test.mjs plugin/hooks/gap-practice.test.mjs
```

Domain types live in `domain/intervention/` — shared with `src/domain/intervention/` (to be deduplicated).
