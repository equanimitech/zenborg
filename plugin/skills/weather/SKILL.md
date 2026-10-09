---
name: weather
description: >-
  Catch up on recent unplanted days and look ahead at the next 48 hours, or
  read a whole week back. Day mode surfaces yesterday (or whichever days since
  the last check haven't been planted), lets the user correct or fill them in,
  then shows today and tomorrow's board. Week mode makes one get_footprints
  call and shows what was planted beside where attention went, with what each
  surface could not see, then asks one question. Use when the user says
  "weather", "catch me up", "what did I miss", "yesterday", "plan today and
  tomorrow", "what's coming up", or invokes "/weather"; for week mode, "/weather
  week", "weekly review", "how was my week", "last week", "where did my
  attention go", "compare what I planted with what I did". Do NOT trigger for
  single-moment capture (tend), the morning ritual (sunrise), day close
  (sunset), or cycle-level review (season).
---

# Weather

Catch up and look ahead. Two modes:

- **Day mode** (default): two beats — land what happened recently, then show
  what's coming.
- **Week mode**: read one Monday → Sunday week back in one call, then talk.
  See [Week mode](#week-mode).

## When to invoke

Trigger phrases:
- "/weather", "catch me up", "what did I miss"
- "what happened yesterday", "fill in yesterday"
- "plan today and tomorrow", "what's coming up"
- Week mode: "/weather week", "weekly review", "how was my week", "last week",
  "where did my attention go", "what did I plant this week"

Do NOT trigger for:
- Single moment capture (tend)
- Morning ritual (sunrise) or day close (sunset)
- Cycle-level review or planning (season)

## Workflow (day mode)

### Beat 1 — Look back (catch up)

#### 1. Determine the lookback window

Default: yesterday only. If today has zero moments, include today in the
lookback too. If the user names a wider window ("last 3 days", "since Monday"),
honor it. Never exceed 7 days. A whole week, or "where did my attention go",
is week mode.

#### 2. Fetch the lookback days

Call `mcp__zenborg__list_moments` with `{ "allocation": "allocated", "day": "<YYYY-MM-DD>" }` for each day in the window. Fire all calls in parallel.

In parallel, also fetch:
- `mcp__zenborg__list_areas` to resolve areaId → name/emoji

#### 3. Render each lookback day

For each day, one compact block:

```
### Yesterday — Mon Sep 8 (3)
  Morning:   🏃 recovery run · ☕️ specialty coffee
  Afternoon: 🛠️ build
  Evening:   (empty)
```

Empty days render as `(0)`. Group by phase. One line per phase.

#### 4. Offer corrections

After rendering, ask once: **"Anything to add or change?"**

The user might say:
- "I also went for a walk in the evening" → hand off to tend to plant it
- "The build was actually equanimi.tech, not Themia" → update the moment
- "Looks right" or silence → move on

Do not prompt more than once. One question, then move to beat 2.

### Beat 2 — Look ahead (next 48h)

#### 5. Fetch today and tomorrow

Call `mcp__zenborg__list_moments` for today and tomorrow in parallel.

Also fetch:
- `mcp__zenborg__list_habits` with `{ "health": "wilting" }` for wilting habits
- `mcp__zenborg__get_cycle_planning_proposals` with the running cycle's id, to know which habits have a budget

#### 6. Render today and tomorrow

Same compact format as the lookback:

```
### Today — Tue Sep 9 (2)
  Morning:   (empty)
  Afternoon: 🧾 free appointment (14:00) · 🤔 therapy (16:00)
  Evening:   (empty)

### Tomorrow — Wed Sep 10 (0)
  (nothing planted)
```

#### 7. Surface wilting habits as candidates

If there are wilting habits, list the top 3-5 as one-liners:

```
Wilting: 🏃 recovery run (5d silent, weekly×2) · 💪 gym (8d, weekly×2) · 💧 mobility (6d, weekly×2)
```

These are candidates, not prescriptions. The gardener picks.

#### 8. Offer to plant

If today or tomorrow have empty phases and there are wilting candidates:
**"Want to plant anything for today or tomorrow?"**

If the user names moments, hand off to the tend workflow. When planting via
`add_moment`, pass `fromPlan: true` for any habit whose `habitId` appears in
the cycle planning proposals. This links the moment to the cycle budget.

### Beat 3 — Things3 backlog scan (when planning extends beyond 48h)

When the session naturally extends into weekly planning (the user asks "what else
should we think about", "what's left", "route the inbox", or you've planted 3+
days ahead), scan Things3 as a GTD health check.

#### 9. Fetch Things3 state

Fire in parallel:
- `mcp__things-mcp__get_today` — flag items started > 3 days ago as stale
- `mcp__things-mcp__get_inbox` — count + oldest age = processing debt
- `mcp__things-mcp__get_areas` — map Things areas to zenborg areas
- `mcp__things-mcp__get_upcoming` — deadlines in the next 14 days

#### 10. Diagnose, don't list

Surface pressure signals only:
- **Inbox:** count + oldest. > 20 items or > 7 days old = debt.
- **Stale Today:** tasks sitting in Today for > 3 days. Check Linear — if done there, clear.
- **Deadlines:** anything due in the next 14 days.
- **Mis-routes:** recurring practices sitting as tasks (→ zenborg habit), product ideas (→ repo).

Render one compact table:

```
| Things area     | Anytime | Deadlines soon | Notes           |
|-----------------|---------|----------------|-----------------|
| 🏡 Home          | 6       | —              | 4 are shopping  |
| 🤦‍♂️ Admin        | 3       | passport Jun 27| —               |
```

#### 11. Offer to process

If inbox > 0: **"Want me to route the inbox items?"**

Route by shape:
- **Recurring practice** → zenborg habit
- **One-off action** → Things area/project
- **Product/work idea** → repo docs/ideas/
- **Reference material** → zenborg habit guidance or complete
- **Vent/no context** → cancel

Optionally scan Someday if the user wants to go deeper.

## Week mode

One call, then a conversation. The interpretation is the gardener's; this
mode lays the week out and asks.

#### W1. Pick the week

The week runs Monday → Sunday; days roll at 04:00. Default: the week holding
today. On a Monday, default to last week, since this one has barely begun.
Honor a named week ("last week", "the week of Sep 28").

#### W2. Fetch it — once

```
mcp__zenborg__get_footprints { "day": "<any YYYY-MM-DD in the week>" }
```

That one call carries everything: the board, planted per area (this week and
last), footprints per surface by area with coverage, wilting habits, and area
names. Do not call `list_moments`, `list_areas` or `list_habits` on top of it.
Call it again only when the gardener asks for another week.

#### W3. Render, gross → subtle

```
### Week of Mon Oct 5 – Sun Oct 11

| Area          | Planted | last week | Screen  | last week | Work      | last week | Body | last week |
|---------------|---------|-----------|---------|-----------|-----------|-----------|------|-----------|
| Studio        | 7       | 11        | 14 m    | 4 m       | 18 h 30 m | 19 h 24 m | —    | —         |
| Entertainment | 2       | 4         | 7 h 3 m | 4 h 43 m  | —         | —         | —    | —         |
| Movement      | 3       | 2         | —       | —         | —         | —         | 30 m | 1 h 10 m  |

Screen   this week  seen 31.9 h · 0 m through idle · 24 h 34 m unmapped (Terminal 11 h, Browser 8 h)
         last week  seen 33 h · 0 m through idle · 28 h 10 m unmapped
Work     this week  seen 18.5 h · 0 m through idle · 0 m unmapped
         last week  seen 19.4 h · 0 m through idle · 0 m unmapped
Body     this week  seen 4.7 h · 0 m through idle · 4 h 12 m unmapped (cycling 2 h 31 m, soccer 1 h 41 m)
         last week  seen 1.2 h · 0 m through idle · 0 m unmapped
Journal  not drawn · Comms not drawn

Blind spots: 18 moments are untraceable, not missed: their areas declare no
paths, hosts or apps and their habits have no Garmin mapping. Idle after
120 s ends a screen span, so a film watched without input counts its first
two minutes; embedded and DRM players emit no video events.

Wilting: Sit · Mobility
```

- Two numbers side by side, every time. Never a ratio, a percentage, an arrow,
  or a word like "doubled" or "halved". If the gardener asks "is that more?",
  give both numbers and the coverage behind each.
- Every surface carries its coverage for **both** weeks: this week's line and
  last week's. A footprint total without `seenHours` and `unmappedMin` beside
  it is the failure this mode exists to prevent; last week's number needs last
  week's coverage just as much.
- `seenHours` is the time the surface actually observed (the union of its
  spans), not the hours it was switched on.
- `—` means no minutes on that surface for that area. `"not drawn"` is not
  zero: no spring feeds that surface yet.
- `traceable: false` means no surface could ever see the moment: its area
  declares no paths, hosts or apps, and its habit has no Garmin mapping. It is
  untraceable, never missed. It does not mean "off screen": a run whose habit
  maps to a watch activity is traceable on body.
- The blind spots line comes from `plugin/surfaces/screen.md`. Name the ones
  that bear on this week's numbers; skip the rest.
- Surfaces overlap (an agent run while its terminal is in front). Never sum
  surfaces into one total.
- Areas render in the gardener's own order (as `planted` returns them), never
  sorted by count.

#### W4. Ask one question

> **What do you see?**

One open question, then follow the gardener. Likely turns:

- "Map Terminal to Studio" → `mcp__zenborg__map_area { kind: "app", key: "Terminal", area: "Studio" }`
- "Plant two runs next week" → hand off to tend.
- "Why is Entertainment so high?" → read the per-surface rows and the blind
  spots back. Do not speculate past what coverage saw.

Do not offer a verdict, a lesson, or a plan for next week unless asked.

## Rules

- Do NOT compute completion rates, streaks, scores, ratios or percentages.
- Do NOT gamify or rank: no badges, no "well done", no best or worst area, no
  ordering by count.
- Do NOT moralize. Silence is data, not failure.
- Do NOT call `list_moments` without a `day` filter.
- Day mode does not read footprints. Week mode reads them, through
  `get_footprints` only — never the JSONL log by hand.
- One correction prompt in the lookback, one planting offer in the lookahead. No nagging.
- The gardener decides what to tend. Surface context; never prescribe.

## Edge cases

- **User invokes on Monday morning with nothing planted over the weekend:** lookback covers Sat+Sun. Offer to fill them in.
- **Yesterday was fully planted:** render it, skip the correction prompt, go straight to beat 2.
- **Tomorrow has no moments and no wilting habits:** just show the empty board and close. Don't force a planting.
- **Week mode, the week crosses a cycle boundary:** read it as a week anyway.
  If the gardener wants the season itself, route to
  `mcp__zenborg__get_cycle_review` for the cycle that closed.
- **Week mode, an empty window** (nothing planted, no footprints on any drawn
  surface): still render the structure, lead with "Nothing planted and no
  footprints this week", and ask whether to look further back.
