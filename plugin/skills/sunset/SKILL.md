---
name: sunset
description: >-
  Close the day in Zenborg: reflect on what grew, capture anything unrecorded,
  and seed tomorrow. This skill should be used when the user says "good night",
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

### 0. Fleet close-up

Before reading the day, close the sessions still running.

```
ToolSearch  query: "select:SendMessage"
ListAgents
```

Show peers as a table (name, state, age). Skip self. Then send **every** peer one
message, all in one turn (parallel SendMessage calls):

> Rafa is closing the day: please run /close-up once your current turn is done.

Fire-and-forget: don't wait for replies. Report which sends failed. A failed send
usually means that session already exited; say so plainly, it is not an error.

### 1. Materialize bedtime routine

Then, call `mcp__zenborg__materialize_routine { boundary: "EVENING->NIGHT" }` to plant any bedtime routine entries that haven't been planted yet today. Report what was created vs. already planted.

### 2. Read the day's record

Fetch today's state in parallel:
- `mcp__zenborg__list_moments` with `{ "day": "YYYY-MM-DD", "allocation": "allocated" }` for today
- `mcp__zenborg__list_areas` to map area names and emoji
- `mcp__zenborg__get_active_moment` to check if an intention is still set
- `mcp__garmin__get_sleep_summary` with today's date for last night's sleep (the night that opened this day)

### 3. Render the day summary

Present a compact reflection:

```
## Today (YYYY-MM-DD)

Morning:   Running, Coffee with Ada
Afternoon: Themia work, Meeting
Evening:   Reading
Night:     (empty)

4 areas touched: Fitness, Social, Themia, Mindfulness
```

#### Tomorrow starts with

Read today's journal through the oracle chain (`routes.journal` read). Collect the
« Left » and « Next » bullets from today's close-up entries, de-duplicate, and render
a short list:

```
Tomorrow starts with
- <bullet>
- <bullet>
```

It is a list, not a triage: never rank, bucket or file issues (§8). It goes into the
Sunset journal section (§10) so `/agenda` can pick it up tomorrow. No close-ups, skip
silently.

### 4. Ask about unrecorded moments

Prompt gently:
- "Anything that happened today that isn't on the board?"
- "Any moments to capture before the day closes?"

If the user names activities, hand off to the tend workflow to decompose, resolve, and plant them.

### 5. One reflection

Ask exactly one question about the day, rotating between « What surprised you today? »
and « What would you do differently? » (or pick one). If there is an answer, keep it
verbatim for the Sunset section. If the user skips it or just says good night, skip it.
No follow-up.

### 6. Clear the active moment

If `get_active_moment` shows a stale intention, offer to clear it:
- "Your intention is still set to [moment]. Clear it for the night?"

On confirmation, call `mcp__zenborg__clear_active_moment`.

### 7. Sleep bookend

If sleep data is available, close the body loop that sunrise opened. Include last night's
sleep as context for how the day went. The gardener already lived the day; the observation
is for their own pattern recognition.

### 8. Work triage

Sunset does not triage work. The DONE · TOMORROW · THIS CYCLE · LATER triage lives in the morning stand-up (leadership-lab `/agenda` in Themia).

### 9. Seed tomorrow (optional)

If the user wants to look ahead:
- "Want to plant anything for tomorrow?"
- Check if there are already moments allocated for tomorrow

If the user names tomorrow's plans, use tend with `day = tomorrow`.

To arrange tomorrow, tell the gardener once to type `/phase tomorrow morning`: the moving happens in the pane, the conversation stays the ritual. Then go on.

If today is a Friday, add one line: `/appetite-check` closes the week. Sunset never plans the week itself (appetite-check and season own that).

### 10. Write the day to journal oracle

Read `~/.zenborg/oracles.json` → `routes.journal`. Walk the oracle chain
(same protocol as close-up §3b): `check` → `read` (if present) → `write`.

Append a `## Sunset` section with §3's summary and areas touched, the « Tomorrow
starts with » list, and the reflection answer if any. Keep it brief — close-up
entries already hold the session detail.

**`hey` replaces, it does not append.** `hey journal write` overwrites the whole day's
entry, so:

1. `hey journal read --markdown --quiet` returns JSON; `content` is the entry's HTML.
2. Append the Sunset section as HTML to that `content`.
3. Write the whole thing back: `hey journal write --content-html "<existing + new>"`.
4. Read it back and check the earlier entries are still there.

`--html` can't be combined with `--quiet`. Writing empty content deletes the entry:
abort if the read failed, or came back empty when an entry was expected.

For the penceive oracle, keep its append-only write as is.

If no oracle is reachable, skip silently — the day lives in the garden only.

### 11. Close

End with a natural close. No summary statistics, no scores, no "well done." The day is complete because the gardener says it is.

## Rules

- Do NOT compute daily scores, completion rates, or streaks.
- Do NOT moralize about empty phases or unplanted areas.
- Clearing the active moment is optional, offered, never forced.
- If the user just says "good night" with no elaboration, render the summary and close. No interrogation.
- Reflective, not exhortative. The garden rests; the gardener rests.
