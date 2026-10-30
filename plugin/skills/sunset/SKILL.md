---
name: sunset
description: >-
  Close the day in Zenborg: reflect on what grew, capture anything unrecorded,
  triage the day's work into DONE / TOMORROW / THIS CYCLE / LATER, and seed
  tomorrow. This skill should be used when the user says "good night",
  "boa noite", "I'm done for the day", "calling it", "wrapping up", or invokes
  "/sunset". Do NOT trigger for moment capture (use tend), day open (use sunrise),
  weekly review (use weather), or cycle planning (use season).
---

# Sunset

Close the day. Look at what was planted and what grew, capture anything that happened but was not recorded, and optionally seed tomorrow's intentions.

## When to invoke

Trigger phrases:
- "/sunset", "good night", "boa noite"
- "I'm done for the day", "calling it", "wrapping up"
- "close the day", "end of day"

Do NOT trigger for:
- "good morning" or day open (sunrise)
- "I did X" mid-day (tend)
- "review the week" (weather)
- "plan the cycle" (season)

## Workflow

### 0. Materialize bedtime routine

Before reading the day, call `mcp__zenborg__materialize_routine { boundary: "EVENING->NIGHT" }` to plant any bedtime routine entries that haven't been planted yet today. Report what was created vs. already planted.

### 1. Read the day's record

Fetch today's state in parallel:
- `mcp__zenborg__list_moments` with `{ "day": "YYYY-MM-DD", "allocation": "allocated" }` for today
- `mcp__zenborg__list_areas` to map area names and emoji
- `mcp__zenborg__get_active_moment` to check if an intention is still set
- `mcp__garmin__get_sleep_summary` with today's date for last night's sleep (the night that opened this day)

### 2. Render the day summary

Present a compact reflection:

```
## Today (YYYY-MM-DD)

Morning:   Running, Coffee with Ada
Afternoon: Themia work, Meeting
Evening:   Reading
Night:     (empty)

4 areas touched: Fitness, Social, Themia, Mindfulness
```

### 3. Ask about unrecorded moments

Prompt gently:
- "Anything that happened today that isn't on the board?"
- "Any moments to capture before the day closes?"

If the user names activities, hand off to the tend workflow to decompose, resolve, and plant them.

### 4. Clear the active moment

If `get_active_moment` shows a stale intention, offer to clear it:
- "Your intention is still set to [moment]. Clear it for the night?"

On confirmation, call `mcp__zenborg__clear_active_moment`.

### 5. Sleep bookend

If sleep data is available, close the body loop that sunrise opened. Include last night's
sleep as context for how the day went. The gardener already lived the day; the observation
is for their own pattern recognition.

### 6. Triage the day's work

Sort everything worked on during the day into four buckets. Gather evidence, not memory:
- commits in each repo touched: `git log --all --since="<day> 00:00" --until="<day+1> 04:00"` (the waking day rolls at 04:00)
- open PRs in those repos: `gh pr list --state open`
- the tracker: in Themia repos, Linear issues updated that day, with their status and cycle. Anywhere else, the day's close-up journal entries.
- work merged but not released: `git rev-list --count origin/main..origin/develop`

| Bucket | Rule |
|---|---|
| DONE | Merged or closed. Merged to `develop` counts: Linear **Staging = DONE**. |
| TOMORROW | The next working day after the day being closed: after a Friday or a Saturday, that is **Monday**. Includes open PRs ready to merge, a promote when `develop` is ahead of `main`, a tracker status that contradicts the code, and an ask whose deadline falls before the next cycle. |
| THIS CYCLE | Still open and in the running cycle. In cooldown (no cycle running), use the next cycle. |
| LATER | In the backlog with no cycle, including anything filed that day. |

Render one table, one row per bucket, with issue IDs inline. Below it, list each status that contradicts the code (merged, but the tracker still says Backlog). Report only: never move an issue, change its status or reassign its cycle. The gardener decides. If nothing was worked on, skip the step.

### 7. Seed tomorrow (optional)


If the user wants to look ahead:
- Offer §6's TOMORROW bucket as seeds
- "Want to plant anything for tomorrow?"
- Check if there are already moments allocated for tomorrow

If the user names tomorrow's plans, use tend with `day = tomorrow`.

To arrange tomorrow, tell the gardener once to type `/phase tomorrow morning`: the moving happens in the pane, the conversation stays the ritual. Then go on.

### 8. Write the day to journal oracle

Read `~/.zenborg/oracles.json` → `routes.journal`. Walk the oracle chain
(same protocol as close-up §3b): `check` → `read` (if present) → `write`.

Append a `## Sunset` section with §2's summary, the areas touched and §6's TOMORROW row.
Keep it brief — close-up entries already hold the session detail.

If no oracle is reachable, skip silently — the day lives in the garden only.

### 9. Close

End with a natural close. No summary statistics, no scores, no "well done." The day is complete because the gardener says it is.

## Rules

- Do NOT compute daily scores, completion rates, or streaks.
- Do NOT moralize about empty phases or unplanted areas.
- Clearing the active moment is optional, offered, never forced.
- If the user just says "good night" with no elaboration, render the summary and close. No interrogation.
- Reflective, not exhortative. The garden rests; the gardener rests.
