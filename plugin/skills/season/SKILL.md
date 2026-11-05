---
name: season
description: >-
  Review and plan the cycle (season) in Zenborg: reflect on the garden's health
  across the whole season and set intentions for the next one. This skill should
  be used when the user says "plan the cycle", "review the cycle", "new season",
  "how's the garden", "cycle review", "cycle planning", or invokes "/season".
  Do NOT trigger for moment capture (use tend), day rituals (use sunrise/sunset),
  or week-level review (use weather).
---

# Season

The whole garden. One skill, two halves: review the season that was (or is), then plan the season to come. Attitudes, intentions, budgets, and the honest state of every plot.

## When to invoke

Trigger phrases:
- "/season", "plan the cycle", "review the cycle"
- "new season", "how's the garden"
- "cycle review", "cycle planning"
- "open a new cycle", "close this cycle"

Do NOT trigger for:
- Single moments (tend)
- Day-level rituals (sunrise, sunset)
- Week-level review (weather)

## Workflow

### Review half (look back)

#### 1. Read the current or most recent cycle

Call `mcp__zenborg__get_running_cycle` for the active cycle. If none is running, call `mcp__zenborg__list_cycles` to find the most recent completed one.

Also fetch in parallel:
- `mcp__zenborg__list_areas` for area names and emoji
- `mcp__zenborg__list_habits` for the full habit registry
- `mcp__zenborg__list_wilting_habits` for the current health picture
- `mcp__zenborg__get_cycle_review` if the cycle has ended

#### 2. Render the season overview

```
## Season: [name] ([startDate] to [endDate or "ongoing"])
Intention: [intention]
Elapsed: [N] days | Remaining: [M] days

Per-area moment counts:
| Area      | Moments | Habits active |
|-----------|---------|---------------|
| Fitness   | 24      | 3             |
| Themia    | 18      | 2             |
```

#### 3. Surface habit health across the cycle

For each area, show habits with their attitude, rhythm, and health status:
```
Fitness:
  Running (KEEPING, weekly x3) -- blooming
  Yoga (BEGINNING, weekly x1) -- wilting (12 days)
```

#### 4. Reflect on the intention

Read the cycle's intention and surface how the allocation pattern relates to it. Neutral observation only:
- "The intention was 'settle into Arcadia.' Social and Exploration areas saw the most growth."
- If `reflection` exists on the cycle, surface it.

#### 4a. Area and person intentions, beside their moments

`get_running_cycle` returns `areaIntentions` and `people` with names resolved (for an ended cycle, read them off `get_cycle`). For each area with an intention, list the intention next to that area's moments in the cycle (`list_moments` with `filter.cycleId` and `filter.areaId`). For each person with an intention, do the same with the moments that mention them (match the person key against each moment's `personIds`; a legacy moment holding the person's record id there still counts, so map id to key via `list_people`). A person with empty text was on the roster only: show their moments, no sentence.
```
Fitness: "get back to running outdoors"
  Moments: Run x9, Swim x2, Yoga x1

Ada: "weekly call"
  Moments: Call Ada x3, Dinner x1
```
Plain observation, two columns of fact. No score, no verdict on whether the season honoured the words, no "you meant X but". If an area or person had no intention, show their moments without comment.

#### 4b. Browser rules, as information

Call `mcp__zenborg__get_rule_efficacy` with the cycle's `from`/`to`. If `rules` is empty, skip this step without mentioning it. Otherwise print each rule's `line` verbatim under one heading, one line per rule, and add nothing: no verdict, no advice to keep or drop a rule, no "you".
```
Browser rules this season:
  chess-ladder: −2.1 min on chess.com in 10 min after a cue, n = 14 / 6 over 5 days.
```

### Plan half (look ahead)

#### 5. Transition to planning

If the user wants to plan a new cycle:
- "Ready to plan the next season?"
- "Want to open a new cycle?"

#### 6. Set the season's shape

Gather from the user:
- **Name** for the cycle (a season name, a theme)
- **Dates** (start, end or template duration)
- **Intention** (one sentence: what this season is about)
- **Places** (where the season is lived, for the outreach queue's `far` signal)
- **Area intentions**: ask which areas the gardener wants to name for this season (they choose; never walk all areas). Then one question per named area: "What does [area] mean this season?" Answer in their own words, 1 to 12 words.
- **People**: ask who they want to see this season. One question per person: "What do you want with [person] this season?" 1 to 12 words, or leave it empty to put them on the roster only. Resolve names with `mcp__zenborg__search` (`type: "person"`) and pass the returned `personKey` as the key of `people`.

#### 7. Review attitudes

For each active habit, surface the current attitude and ask if it should change:
```
Running is KEEPING. Stay, or shift?
Yoga is BEGINNING. Keep exploring, or commit to RETURNING?
```

Attitudes are: BEGINNING, RETURNING, KEEPING, BUILDING, PUSHING, PRUNING, BEING.

Present the current attitude; the user decides any changes. Update via `mcp__zenborg__update_habit` if changed.

#### 8. Get cycle planning proposals

Call `mcp__zenborg__get_cycle_planning_proposals` to see what rhythm + health signals suggest for budgets.

Present proposals as suggestions, not prescriptions:
```
Proposals based on rhythm and health:
  Running: 12 moments (weekly x3, 28-day cycle)
  Reading: 4 moments (weekly x1)
  Yoga: 4 moments (weekly x1, currently wilting)
```

#### 9. Create the cycle

On user confirmation, call `mcp__zenborg__plan_cycle` with the agreed parameters, including every answer in one call: `areaIntentions: { "<areaId>": "text" }` and `people: { "<personKey>": "text" }`. This creates the cycle only; it does not create budget plans (those are authored in the app's cycle deck). To add intentions to an existing cycle, send both maps together in a single `mcp__zenborg__update_cycle`; each map replaces the stored one, so include entries to keep.

#### 10. Seed the first week

Optionally, offer to plant the first week's moments using the tend workflow or `mcp__zenborg__allocate_from_plan`.

## Rules

- Never call `plan_cycle` without the user confirming the proposals.
- Attitudes are the user's honest relationship with a practice. Do not recommend attitudes.
- No scoring, streaks, or completion tracking.
- A cycle's reflection, if written by an agent, is stamped `reflectionSource: "machine"`.
- Intentions are set by the gardener, not derived by the tool. Area and person intentions are the gardener's own words; never draft or suggest them.
- PRUNING is a legitimate attitude. A habit being pruned is a conscious choice, not a failure.

## Edge cases

- **No active cycle:** offer to create one. Show the last completed cycle for context.
- **Overlapping cycles:** list all active cycles (date-derived), let the user pick which to review.
- **Ending a cycle early:** call `mcp__zenborg__end_cycle` with the user's chosen end date.
- **Reflection capture:** if the user shares a reflection, write it to the cycle via `mcp__zenborg__update_cycle` with `reflection`. The source stamps automatically as `"machine"`.
