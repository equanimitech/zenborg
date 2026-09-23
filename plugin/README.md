# zenborg — Claude Code plugin

A garden for your attention. Plant what you want to grow, with the people and places you
care about. Cultivate it every day: tend what matters, fence out the weeds. Harvest what
it teaches you, and tune the next season.

**You are the gardener.** Your garden is your habit ecosystem, digital and physical. You
are responsible for tending it, and you already do. Zenborg is the toolshed; this plugin
is the part of it you reach from a Claude Code session. The everyday question is
*"What will I tend to today?"*

It is not a habit tracker, not a task manager, not a screen-time app. No streaks, no
scores, no notifications.

## Skills

Grouped by the app's three tabs:

| Tab | Skills |
|---|---|
| Plant | `onboarding` (your first garden: areas, habits, people, places) |
| Cultivate | `sunrise`, `tend`, `sunset`, `close-up`, plus the fences hook below |
| Harvest | `weather`, `weekly-moments-review`, `season` |

Plus `oracle-wizard` and `oracle-probe`, for connecting the garden to the tools you
already use (journal, body, tasks).

## Hooks

Each concern is its own file:

| File | Hook | What it does |
|---|---|---|
| `observe.mjs` | all 13 events | Append-only activity log to `~/.zenborg/keel/log/*.agent.jsonl` |
| `hooks/fences.mts` | PreToolUse | A gentle fence (fences live in Cultivate): reads the fences you declared and asks before a session wanders past one, with an exit on every rung |
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
