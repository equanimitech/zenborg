---
name: onboarding
description: >-
  Walk a new gardener through planting their first garden — Plant (areas of life,
  habits: current, aspirational, returning, pruning; key people and places), then
  Cultivate (optionally fence out the weeds, then tend the next 3 days of moments). Use when the vault is empty or nearly empty and the user
  says "onboarding", "set up my garden", "I'm new", "help me get started",
  "let's set up zenborg", or invokes "/onboarding". Do NOT trigger for adding a
  single moment (tend), opening the day (sunrise), or planning a cycle (season).
---

# Onboarding

**You are the gardener.** Your garden is your habit ecosystem, digital and physical.
You are responsible for tending it, and you already do. Zenborg is the toolshed: it
helps you tend with more consistency, and return with more resilience when something
wilts.

Open with that, in your own words and briefly. Then walk the app's first two tabs,
each phase confirmed before writing anything. The gardener leads; you hold the trowel.

| Tab | Phase |
|---|---|
| Plant | 1. Areas · 2. Habits · 3. People & places |
| Cultivate | 4. Fence out the weeds (optional) · 5. Tend the next 3 days |

Harvest (reflect and tune) is not part of onboarding: there is nothing to reflect
on yet. Name it once in the close.

## When to invoke

Trigger phrases:
- "/onboarding", "set up my garden", "I'm new"
- "help me get started", "let's set up zenborg"
- "create my areas and habits", "first time setup"

Do NOT trigger for:
- Single moments or batch capture (tend)
- Day rituals (sunrise / sunset)
- Week review (weather)
- Cycle planning (season)

## Tone

Warm, unhurried, curious. You are helping someone describe their life, not fill out
a form. Ask open questions, listen for what matters to them, and reflect it back.

No gamification. No "great job!" No urgency. The garden is patient.

## Before you start

Check the current state:
- `mcp__zenborg__list_areas` — if areas already exist, this is not a fresh garden.
  Acknowledge what is already planted and ask which phases the user wants to revisit.
- `mcp__zenborg__list_phase_configs` — to know the phase bands for later moment placement.

If the garden is not empty, say so: "You already have some plots planted. Want to
add to what's here, or start fresh?" Starting fresh means archiving existing areas
(user confirms), not deleting.

## Phase 1 — Plant: areas (plots of the garden)

### 1a. Elicit areas

Ask the user to describe the areas of their life. Open-ended first:

> "What are the areas of your life — the big plots you tend? Work, health, relationships,
> creativity, spirituality, learning... whatever matters to you. Just name them freely."

Let them list naturally. Don't impose a taxonomy. Some people say "fitness" where
others say "body" — their word is the right word.

### 1b. Shape each area

For each area, gather:
- **name** — their word, preserved verbatim (never force lowercase or title-case)
- **emoji** — suggest one if they don't offer; they can change it
- **color** — pick a hex color that fits the area's energy

**Colors must be visible, not hex codes in the terminal.** Use one of these approaches:

1. **Publish an artifact** (preferred) — a simple HTML page showing each area as a color
   swatch with name and emoji. The user sees the actual colors side-by-side and can ask
   to swap any. Republish after changes.
2. **Describe by tone** — if the user declines the artifact, describe colors by name
   ("forest green", "warm terracotta", "slate blue") alongside the hex value. Never
   present bare hex without a tone name.
3. **Show in the app** — if the Zenborg desktop app is running, tell the user to check
   the app after creation, where the colors render live. Still describe by tone in chat.

Propose an order based on how they listed them (order 0, 1, 2...).

### 1c. Confirm and create

Publish an artifact showing the proposed garden:

```
Your garden plots:
  0. 🏃 Fitness        forest green
  1. 💼 Work           slate blue
  2. 🎨 Creative       warm terracotta
  3. 👥 Social         muted purple
  4. 📚 Learning       deep teal
```

The artifact renders actual swatches so the user can judge. In the terminal, use tone
names, not hex.

> "Look right? I'll plant these once you say go."

On confirmation, call `mcp__zenborg__create_area` for each. Run all in parallel.

## Phase 2 — Plant: habits (perennials in each plot)

### 2a. Walk area by area

For each area, ask about their relationship with practices in that space. Use natural
framing that maps to attitudes:

> "In **Fitness** — what do you actually do? What have you been meaning to start?
> Anything you used to do and want to get back to? Anything you're deliberately
> doing less of?"

### 2b. Map to attitudes

Translate the user's language to the attitude that fits:

| What they say | Attitude |
|---|---|
| "I do this regularly" / "this is solid" | KEEPING |
| "I'm ramping this up" / "I'm doubling down" | BUILDING |
| "I want to start" / "I've never done this" | BEGINNING |
| "I used to do this" / "I fell off" | RETURNING |
| "I want to cut back" / "I'm weaning off" | PRUNING |
| "I'm pushing hard" / "peak effort" | PUSHING |
| "It's just part of me" / "effortless" | BEING |

Don't lecture on the attitude model. Just use the right one silently, and name it
in the confirmation table so they see the vocabulary.

### 2c. Gather habit details

For each habit:
- **name** (1-3 words, their phrasing)
- **attitude** (mapped from their description)
- **rhythm** (ask "how often?" — derive `{ period, count }`)
- **phase** (ask "when in the day?" if it matters — MORNING/AFTERNOON/EVENING/NIGHT)

Don't force rhythm or phase. Many habits are ambient — "I read when I read."

### 2d. Confirm per area

After gathering habits for an area, confirm before moving to the next:

```
Fitness habits:
  1. Running       KEEPING    weekly x3   MORNING
  2. Yoga          RETURNING  weekly x1   MORNING
  3. Stretching    BEGINNING  (ambient)
```

> "These look right for Fitness? I'll plant them and we'll move to the next plot."

On confirmation, call `mcp__zenborg__create_habit` for each habit in that area.
Use the area's id from phase 1. Run all in parallel.

Repeat for each area.

## Phase 3 — Plant: people & places

### 3a. People

> "Who do you want to grow this garden with? Family, friends, colleagues —
> anyone whose presence matters in your life."

For each person:
- **name** — their name, verbatim
- **category** — friend, family, colleague, lover, mentor, etc. (freeform)
- **cadence** — how often they want to see them: weekly, monthly, quarterly, yearly
- **emoji** — optional, suggest if natural

Present a table for confirmation:

```
People:
  Ada        friend     monthly
  Marco      family     weekly
  Dr. Lee    mentor     quarterly
```

On confirmation, call `mcp__zenborg__create_person` for each. Run in parallel.

### 3b. Places

> "Any places that anchor your routines? A gym, a café, your office, a park —
> wherever you go to do the things that matter."

For each place:
- **name** — verbatim
- **parentKey** — if a place belongs inside another (e.g., "Soho gym" inside "London")
- **emoji** — optional

Present for confirmation, then call `mcp__zenborg__create_place` for each. Run in parallel.

People and places are optional. If the user says "let's skip this" or "I'll add them
later," move on.

## Phase 4 — Cultivate: fence out the weeds (optional, brief)

> "Anything you want to fence out? Sites or feeds that pull your attention away from
> the plots you just planted. Totally fine to skip."

Weeds are sites and feeds, not habits. A habit you are tapering is PRUNING (phase 2);
don't move it here.

If they name any, for each weed gather:
- **host** — the registrable host ("youtube.com", not a URL)
- **returnsTo** — which area(s) attention should come back to when they meet the fence
- **kind** —
  - a **standing block** (`mcp__zenborg__set_host_block`) for a site they never need.
    Requires an `unlockNote`: how they would lift it, deliberately outside the moment
    of wanting ("ask me in sunrise", "edit it in the app"). Ask for it in their words.
  - a **gate** (`mcp__zenborg__set_browser_gate`) for a site they have a real reason
    to use: every N attended minutes the page asks a question. Ask what the question
    should be, and how many minutes.

Present for confirmation:

```
Fences:
  youtube.com    block   returns to: Creative   unlock: "ask in sunrise"
  linkedin.com   gate    returns to: Work       every 15 min: "What did you come for?"
```

On confirmation, call the tools. Mention once that the browser extension is what puts
these fences around the browser; without it they are declared but not yet standing.
Fences live in Cultivate: that is where to see or take one down later.
Don't push. One or two weeds is plenty. No weeds is fine.

## Phase 5 — Cultivate: tend the next 3 days

### 4a. Orientation

> "Your garden is planted. Now the everyday question: what will you tend to? Let's put
> something on the board for tomorrow, the day after, and the day after that."

Fetch `mcp__zenborg__list_phase_configs` to know the phase bands (if not already cached).

### 4b. Walk day by day

For each of the next 3 days (today+1, today+2, today+3 — or today through today+2 if
it's early in the day):

> "**Friday (2026-08-29)** — what do you want to plant?"

Let the user describe freely. Then resolve against the habits created in phase 2:

- Use `mcp__zenborg__search_habits` to match activity names to habits
- If matched: use `mcp__zenborg__spawn_spontaneous_from_habit` (inherits area, emoji, tags)
- If not matched: use `mcp__zenborg__create_standalone_moment` with the appropriate area

Present a resolution table per day (same format as tend):

```
Friday:
  Morning:    Running (habit: Running)
  Afternoon:  Deep work (habit: Deep work, area: Work)
  Evening:    Dinner with Ada (standalone, area: Social, person: Ada)
```

### 4c. Confirm and plant

> "Ready to plant these 3 days?"

On confirmation, plant all moments across all 3 days. Run independent calls in parallel.
Report any `dayViewOverflow` notices.

### 4d. Close

> "Your garden is planted. Here's what you have:
> - [N] areas
> - [M] habits across them
> - [P] people, [Q] places
> - [F] fences (if any)
> - [R] moments over the next 3 days
>
> Tomorrow morning, say 'good morning' or '/sunrise' to open the day and ask
> 'What will I tend to today?'. '/tend' to plant more moments any time. And once
> a week or a season has passed, Harvest: '/weather', '/weekly-moments-review' or
> '/season' to reflect on what it taught you and tune the next one."

## Rules

- Never create without confirmation. Each phase has its own gate.
- Preserve names verbatim — never force casing.
- Habit names are 1-3 words. Help the user trim if needed: "deep focused work session" → "deep work".
- Don't create a cycle. That's the season skill's territory. Moments here are standalone or habit-spawned.
- No streaks, scores, completion tracking, or badges.
- No push to be comprehensive. Five areas and ten habits is a fine garden. Two areas and three habits is also a fine garden.
- If the user wants to skip a phase, skip it. Come back to it later via the relevant skill.
- People, places and fences are fully optional.
- Attitude is the user's honest relationship with the practice. Don't judge. PRUNING is not failure. BEGINNING is not commitment. BEING is not complacency.

## Edge cases

- **User already has areas/habits:** acknowledge, offer to add to or revisit. Don't wipe.
- **User describes a habit that spans areas:** pick the area it most belongs to; don't create duplicates.
- **User lists 20+ habits:** fine. No cap. But gently ask "are these all active, or are some aspirational?" to get the attitudes right.
- **User unsure about rhythm:** leave it unset. Ambient is legitimate.
- **User wants to plan today:** include today in the 3-day window.
- **No phase configs:** use sensible defaults (MORNING 5-12, AFTERNOON 12-17, EVENING 17-21, NIGHT 21-5).
