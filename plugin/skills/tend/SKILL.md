---
name: tend
description: >-
  Batch capture, update, or move moments in Zenborg with fuzzy entity resolution.
  This skill should be used when the user says "I did X", "tomorrow I have X",
  "plant this", "add a moment", "I ran, had coffee with Ada, then worked on Themia",
  or describes what happened or what is planned in natural language. Also trigger on
  "/tend" or any natural-language board update that implies planting one or more moments.
  Do NOT trigger for day-level rituals (use sunrise/sunset), week-level review (use weather),
  or cycle-level planning (use season).
---

# Tend

Batch capture moments from natural language with fuzzy entity resolution. The gardener says what happened or what is planned; this skill decomposes it into moments, resolves entities, and plants them after confirmation.

## When to invoke

Trigger phrases (explicit):
- "/tend", "plant this", "add a moment", "log this"
- "I did X", "I ran this morning", "tomorrow I have X"
- "I had coffee with Ada at the park"
- Any sentence describing activities to record as moments

Do NOT trigger for:
- "good morning" / "open the day" (sunrise)
- "good night" / "close the day" (sunset)
- "review the week" / "plan the week" (weather)
- "plan the cycle" / "review the cycle" (season)

## Workflow

### 1. Decompose the input

Parse the user's natural language into discrete moment candidates. Each candidate has:
- **name** (1-3 words, imperative)
- **day** (default: today, YYYY-MM-DD)
- **phase** (derive from context or time of day via `list_phase_configs`)

### 2. Resolve entities with fuzzy search

For each candidate, resolve entities using the MCP search tools:

**Habits:** Call `mcp__zenborg__search_habits` with the activity name.
- Match found: link the moment to the habit (inherit area, emoji, tags).
- No match: propose creating a new habit, or plant as a standalone moment.

**People:** Call `mcp__zenborg__search_people` with any person names mentioned.
- Match found: add to `personIds`.
- No match: propose "add X as a person?"

**Places:** Call `mcp__zenborg__search_places` with any place names mentioned.
- Match found: add to `placeIds`.
- No match: propose "add X as a place?"

Run all search calls in parallel for efficiency.

### 3. Present the resolution table

Render a compact summary for the user:

```
Resolved:
  1. Running       MORNING today  (habit: Running, area: Fitness)
  2. Coffee        MORNING today  (habit: Coffee, person: Ada)
  3. Themia work   AFTERNOON today (area: Themia)

Proposals:
  - "the new cafe" not found in places. Add as a place?
  - No habit matched for "lunch". Create a habit, or plant as standalone?

Plant all? [Y/n]
```

### 4. Plant on confirmation

On user confirmation, plant moments using the appropriate MCP tools:

- **Habit-linked moments:** `mcp__zenborg__spawn_spontaneous_from_habit` (inherits area, emoji, tags, schedule timing)
- **Standalone moments:** `mcp__zenborg__create_standalone_moment` (requires explicit areaId)
- **Unresolved entities:** Create new people/places first if the user approved proposals

Plant all moments in parallel when there are no dependencies between them.

### 5. Report what was planted

After planting, confirm with a compact summary:

```
Planted 3 moments on 2026-08-27:
  Running (MORNING), Coffee with Ada (MORNING), Themia work (AFTERNOON)
```

## Defaults

- **day:** today (system date)
- **phase:** derive from the current time using `list_phase_configs` startHour/endHour bands
- **area:** inherit from matched habit; if standalone, ask which area

## Entity resolution priority

The search tools rank matches: exact > prefix > substring > levenshtein (distance <= 2) > alias. Present the top match to the user; if multiple close matches exist, list them for disambiguation.

## Rules

- Moment names are **1-3 words**. Trim verbose descriptions to a short intention.
- Never plant without user confirmation. Present the resolution table first.
- Never create streaks, scores, or completion tracking.
- Never write to Google Calendar. Zenborg is the source of truth.
- Counts and history are information, not scores. "3rd time this week" is fine; "you're on a streak" is not.
- When a habit has a `schedule`, inherit `startTime` and `durationMin` into the moment.

## Edge cases

- **Ambiguous habit match:** list the top 2-3 candidates and let the user pick.
- **Multiple moments for the same (day, phase):** plant them all. The cap is a display concern, not a data invariant. Report `dayViewOverflow` if past 3 so the user is aware.
- **Past or future dates:** honor "yesterday I ran" or "Friday I have dinner with Bea". Derive the date, confirm it.
- **No area for standalone moment:** ask which area before planting.
- **Craft in Morning:** Morning holds wellness and what recharges. When a candidate lands in MORNING and its area is tagged `craft` rather than `wellness` (tags via `list_areas`), add a gentle line under Proposals: "Morning holds what recharges. Plant this in Afternoon instead?" Plant wherever the gardener chooses.
