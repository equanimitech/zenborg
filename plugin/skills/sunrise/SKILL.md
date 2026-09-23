---
name: sunrise
description: >-
  Open the day in Zenborg: survey the garden's state and plan what to plant today.
  This skill should be used when the user says "good morning", "bom dia",
  "what's on today", "open the day", "morning", or invokes "/sunrise".
  Do NOT trigger for moment capture (use tend), day close (use sunset),
  weekly review (use weather), or cycle planning (use season).
---

# Sunrise

Open the day. Survey the plots, see what is already planted, surface what the garden whispers, and help the user decide what to tend today.

## When to invoke

Trigger phrases:
- "/sunrise", "good morning", "bom dia", "morning"
- "what's on today", "open the day", "start the day"

Do NOT trigger for:
- "I did X" or moment capture (tend)
- "good night" or day close (sunset)
- "review the week" (weather)
- "plan the cycle" (season)

## Workflow

### 0. Materialize morning routine

Before reading the board, call `mcp__zenborg__materialize_routine { boundary: "NIGHT->MORNING" }` to plant any wakeup routine entries that haven't been planted yet today. Report what was created vs. already planted.

### 1. Read today's board

Fetch today's state in parallel:
- `mcp__zenborg__list_moments` with `{ "day": "YYYY-MM-DD", "allocation": "allocated" }` for today
- `mcp__zenborg__get_running_cycle` for the active cycle, intention, and per-habit health
- `mcp__zenborg__list_wilting_habits` for habits that need attention
- `mcp__zenborg__get_active_moment` to see if an intention is already set
- `mcp__zenborg__list_phase_configs` to know the phase bands
- `mcp__garmin__get_sleep_summary` with today's date for last night's sleep

### 2. Render the day view

Present a compact overview:

```
## Today (YYYY-MM-DD) -- Season: [cycle name] ([intention])

Sleep:     [last night's summary from Garmin]

Morning:   [moment1] [moment2]
Afternoon: [moment3]
Evening:   (empty)
Night:     (hidden or empty)
```

Include last night's sleep as context for the day ahead. Use the data naturally; the gardener
reads their own body. If Garmin returned no data (watch off, travel), say so briefly.

Show each moment with its emoji and habit name. Empty phases are visible silence.

### 3. Surface whispers

From the wilting habits, cycle health, and sleep:
- List 3-5 habits that are wilting or approaching their rhythm threshold
- Note the cycle's elapsed/remaining days
- If `list_people_to_reach` returns overdue contacts, mention the top 2-3

Keep observations neutral. "Reading has been quiet for 5 days" not "you should read more."

### 4. Offer the next move

Close with an open question. The everyday one is the default:
- "What will you tend to today?"
- "Want to plant something for today?"
- "Should we tend to any of these?"
- "Ready to set an intention?"

If the user responds with moments to plant, hand off to the tend workflow (decompose, resolve, plant).

## Rules

- Do NOT auto-plant or auto-suggest moments. Surface context; the user decides.
- Do NOT compute completion rates or streaks.
- Silence is data. An empty phase is a signal, not a failure.
- Keep the overview scannable. One line per phase, emoji-prefixed moments.
- Reflective tone, not exhortative. The gardener visits the garden; the garden does not chase the gardener.
