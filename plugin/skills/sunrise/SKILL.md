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
- the same call for yesterday, to see what was recorded
- `mcp__zenborg__get_day_trace` with yesterday's date, for footprints: where attention actually went, per phase and area, including unplanted spans
- `mcp__zenborg__get_running_cycle` for the active cycle, intention, and per-habit health
- `mcp__zenborg__list_wilting_habits` for habits that need attention
- `mcp__zenborg__get_active_moment` to see if an intention is already set
- `mcp__zenborg__list_phase_configs` to know the phase bands
- `mcp__garmin__get_sleep_summary` with today's date for last night's sleep

### 2. Render the day view

Present a compact overview:

```
## Today (YYYY-MM-DD) -- Season: [cycle name] ([intention])

Yesterday: [moment1] [moment2] (or "nothing recorded")
Sleep:     [last night's summary from Garmin]

Morning:   [moment1] [moment2]
Afternoon: [moment3]
Evening:   (empty)
Night:     (hidden or empty)
```

Include last night's sleep as context for the day ahead. Use the data naturally; the gardener
reads their own body. If Garmin returned no data (watch off, travel), say so briefly.

Show each moment with its emoji and habit name. Empty phases are visible silence.

### 3. Close yesterday's gaps

Read yesterday's unplanted footprints from `get_day_trace` and suggest the moments they imply: map each sizeable span (area, phase, minutes) to the habit it most likely waters, e.g. 78 min of Themia agent work in the Afternoon → "Themia build, Afternoon". When the area is clear but the habit is not, ask which habit. Footprints only see screens, so also ask what happened off-screen (a run, a call, a walk). Hand the accepted suggestions to tend to plant on yesterday. If the days before yesterday are empty too, say how far back the silence goes and offer weather to backfill them.

### 4. Suggest what to plant

Cross-check the board against the habits the season's intention names and the wilting habits, and suggest concrete moments for today or tomorrow from the ones with nothing planted: habit, day, phase. Prefer a habit's scheduled phase, and keep it to 3-5 suggestions. Plant only the ones the user accepts.

Then call `mcp__zenborg__open_phase_pane` with `{ "day": "today" }` (add `"phase"` for the next phase when the current one is nearly over), so the gardener arranges the day in the pane while the conversation stays the ritual. If it answers that the pane waits undrawn, mention `/phase` once and go on.

### 5. Surface whispers

From the wilting habits, cycle health, and sleep:
- List 3-5 habits that are wilting or approaching their rhythm threshold
- Note the cycle's elapsed/remaining days
- If `list_people_to_reach` returns overdue contacts, mention the top 2-3
- Morning holds wellness and what recharges. If a moment already planted in Morning belongs to a `craft`-tagged area (check tags via `list_areas`), note it once and ask whether it would sit better in another phase. The gardener decides; never move it yourself.

Keep observations neutral. "Reading has been quiet for 5 days" not "you should read more."

### 6. Offer the next move

Close with an open question:
- "Want to plant something for today?"
- "Should we tend to any of these?"
- "Ready to set an intention?"

If the user responds with moments to plant, hand off to the tend workflow (decompose, resolve, plant).

## Rules

- Suggest moments; never plant one without the user's yes.
- Do NOT compute completion rates or streaks.
- Silence is data. An empty phase is a signal, not a failure.
- Keep the overview scannable. One line per phase, emoji-prefixed moments.
- Reflective tone, not exhortative. The gardener visits the garden; the garden does not chase the gardener.
