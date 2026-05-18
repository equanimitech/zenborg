---
name: weekly-moments-review
description: Conduct a weekly review of allocated moments in Zenborg by querying the zenborg MCP day-by-day, aggregating per area, computing habit health, comparing to the prior week, and surfacing wilting habits. Use whenever the user asks for a "weekly moments review", "weekly review", "last week review", "review this week", "how was my week", "where did my attention go", or invokes `/weekly-moments-review` / `/weekly-review`. Also trigger when the user asks to look back across the past 7 days of moments, habits, or areas in Zenborg, even without using the word "review" — e.g. "let's check what I did this week", "what did I plant", "how is the garden doing".
---

# Weekly Moments Review

A reflection ritual: pull the past week's moments from Zenborg, see where consciousness actually landed, compare to the prior week, and surface what's drifting.

This is not task accounting. It's a mirror — the question is "where did I place my attention?", not "what got done."

## When to invoke

Trigger phrases — explicit:
- "weekly review", "last week review", "review this week", "review the week"
- "/weekly-review"
- "how was my week", "where did my attention go"

Trigger phrases — implicit (also trigger):
- "let's look at this past week in Zenborg"
- "what did I plant"
- "how's the garden doing"
- "compare this week to last week"

Do NOT trigger for:
- A single-day review (use ad-hoc `mcp__zenborg__list_moments` with a `day` filter).
- A cycle review (use `mcp__zenborg__get_cycle_review` directly).
- Code review of the Zenborg repo (that's `code-review`, not this).

## Workflow

### 1. Determine the window

Default window: the **most recent 7 days ending today** (today inclusive). Today = the system date.

If the user names a different window ("the week of May 4", "the past two weeks"), honor it. For a multi-week window, walk one week at a time and concatenate, but keep the per-week breakdown.

For a 7-day window starting Monday: if today is Monday, the window is Mon–today (1 day so far); otherwise it's the most recent full week ending today. Don't pad past today — the future hasn't been planted.

### 2. Fetch moments day-by-day

Use `mcp__zenborg__list_moments` with `{"allocation": "allocated", "day": "YYYY-MM-DD"}` — **one call per day, all 7 in parallel** in a single message.

Do NOT call `list_moments` without a day filter — the global list typically exceeds the response token budget. Day-scoped queries stay small.

In parallel, also fetch:
- `mcp__zenborg__list_areas` — to map `areaId` → `{name, color, emoji}`.
- `mcp__zenborg__list_habits` — to map `habitId` → `{name, attitude, rhythm}` and compute health context.
- `mcp__zenborg__list_wilting_habits` — to get the current wilting set with `daysSinceLast`.

### 3. Render the per-day breakdown

For each day in the window, render a compact section:

```
## <DayName> <YYYY-MM-DD> (<count>)
- 🌅 <morning moments, area-emoji prefixed if not redundant with moment emoji>
- ☀️ <afternoon moments>
- 🌙 <evening moments>
```

Group moments within a day by phase (MORNING → AFTERNOON → EVENING → NIGHT). Show each moment as just its name + an emoji glyph. If the day has zero moments, render `## <DayName> <YYYY-MM-DD> (0)` — silence is data.

Mark today with `— today` and the release/milestone day with a short label if context makes it obvious.

### 4. Tally by area

Count moments per area across the window. Render a small table sorted by descending count:

```
## Tally by area
| Area | Count |
|---|---|
| <Area> | <n> |
```

### 5. Surface patterns

Pull out 3–5 short observations. Examples of useful patterns:
- A spike or drop in a particular area vs. the user's typical baseline (if known).
- A clustering of one habit on consecutive days or in a single phase.
- An area with zero moments all week.
- A habit allocated unusually often (potential overcommitment).
- A "tag cluster" worth noting (e.g. `bcn` tag on multiple Friends moments = social tissue active).

Keep each observation to one line. Avoid value judgments — "Family appeared once" is data; "you neglected family" is not.

### 6. Compare to the prior week

Run the same fetch for the prior 7-day window (day-by-day in parallel). Render a compact comparison table for the areas the user cares about most (Themia work, Fitness, Mindfulness, Friends, Family, Emotional, plus anything that changed materially):

```
## Week-over-week
| Area | Prior | This week | Δ |
|---|---|---|---|
| <Area> | <n> | <m> | +/-<diff> |
```

Also note:
- Total moments prior vs. this week.
- Empty days in either window (silence is data).
- Habits allocated last week but not this one (drift candidates).

### 7. Surface wilting habits

From `list_wilting_habits`, show the top 5–8 by ratio `daysSinceLast / silenceThreshold` rather than raw days. Monthly habits have a 30-ish-day threshold; weekly habits have ~7–14. Sorting by raw days makes the monthly ones dominate; ratio normalizes.

For each wilting habit show: emoji + name + days silent + rhythm + attitude. Keep to one line per habit.

If a habit is flagged wilting because its rhythm bar is genuinely high (e.g. Vipassana weekly × 14 means twice/day target), note that — it's a calibration story, not an absence story.

### 8. Offer a next move

Close with one open question: "Want to dig deeper on X, plan next week, or shape a response to Y?" Don't push — the user opened the review, the user closes it.

## Output style

- Use markdown headers (`##` for major sections, `###` only if needed inside).
- Tables for tallies and comparisons.
- Emoji prefixes on phase lines but no decoration beyond that.
- Caveman-style brevity is welcome if active.

## What NOT to do

- **Don't compute "completion rates" or "streaks"** — Zenborg is principle-bound against scoring. Counts and ratios are fine; rates that frame allocation as success/failure are not.
- **Don't gamify** — no badges, no "well done", no rankings.
- **Don't moralize** — surface gaps neutrally. "Family had one moment this week" not "you should call your mom."
- **Don't invent moments** — if the day returned `[]`, that's `(0)`. Don't fill it from memory.
- **Don't call `list_moments` without a `day` filter** — the response will exceed context budget.

## Edge cases

- **Window spans a cycle boundary**: still render per-day; if the user wants the cycle review specifically, route them to `mcp__zenborg__get_cycle_review`.
- **A moment has `habitId: null`** (spontaneous moment): show it normally; just no health data attached.
- **A moment's `areaId` doesn't resolve in `list_areas`**: render the moment with `area: ?` rather than dropping it — surface the data integrity issue.
- **No moments at all in the window**: still render the structure, but lead with "No allocated moments in this window" and ask if the user wants to look further back.
- **User asks for a multi-week window** (e.g. "past month"): walk one 7-day chunk at a time, render each chunk's per-day + tally, then a roll-up tally and a single wilting list at the end.

## Example invocation flow

User: "let's do a weekly review"

1. Determine window: today is 2026-05-18 → window is 2026-05-12 → 2026-05-18 (last 7 days ending today). Or, if user clearly means "the week that just ended" on a Monday, walk back Mon→Sun.
2. Fire 7 `list_moments` calls + `list_areas` + `list_habits` + `list_wilting_habits` in parallel.
3. Render: per-day → tally → patterns → week-over-week (fire 7 more `list_moments` for prior week in parallel) → wilting → next move.
4. Wait for user to redirect or dig in.

## Tone

Reflective, not exhortative. The user is reviewing where their attention landed — your job is to make the landing legible, not to grade it.
