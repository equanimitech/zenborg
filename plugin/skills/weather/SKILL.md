---
name: weather
description: >-
  Catch up on recent unplanted days and look ahead at the next 48 hours.
  Primarily surfaces yesterday (or whichever days since the last check haven't
  been planted), lets the user correct or fill them in, then shows today and
  tomorrow's board. Use when the user says "weather", "catch me up", "what did I
  miss", "yesterday", "plan today and tomorrow", "what's coming up", or invokes
  "/weather". Do NOT trigger for single-moment capture (tend), the morning
  ritual (sunrise), day close (sunset), cycle-level review (season), or the
  heavy evidence-based lookback (recap).
---

# Weather

Catch up and look ahead. Two beats: land what happened recently, then show
what's coming.

## When to invoke

Trigger phrases:
- "/weather", "catch me up", "what did I miss"
- "what happened yesterday", "fill in yesterday"
- "plan today and tomorrow", "what's coming up"

Do NOT trigger for:
- Single moment capture (tend)
- Morning ritual (sunrise) or day close (sunset)
- Cycle-level review or planning (season)
- Heavy evidence-based lookback with git/keel/garmin (recap)

## Workflow

### Beat 1 — Look back (catch up)

#### 1. Determine the lookback window

Default: yesterday only. If today has zero moments, include today in the
lookback too. If the user names a wider window ("last 3 days", "since Monday"),
honor it. Never exceed 7 days — route to recap for longer.

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

## Rules

- Do NOT compute completion rates, streaks, or scores.
- Do NOT moralize. Silence is data, not failure.
- Do NOT call `list_moments` without a `day` filter.
- Do NOT reconcile against git, keel, or garmin — that is recap's job.
- One correction prompt in the lookback, one planting offer in the lookahead. No nagging.
- The gardener decides what to tend. Surface context; never prescribe.

## Edge cases

- **User invokes on Monday morning with nothing planted over the weekend:** lookback covers Sat+Sun. Offer to fill them in.
- **Yesterday was fully planted:** render it, skip the correction prompt, go straight to beat 2.
- **Tomorrow has no moments and no wilting habits:** just show the empty board and close. Don't force a planting.
