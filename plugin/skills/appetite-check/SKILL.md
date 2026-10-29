---
name: appetite-check
description: Weekly appetite check for the cycle's betting table - days spent against appetite for every allocation, the unattributed share, Bugs & ops against a quarter of capacity, days left to bet; asks what was cut this week; drafts a Themia-only extract for a Linear doc and Slack and posts nothing without approval. Use when Rafa says "/appetite-check", "appetite check", "weekly check", "how are the bets doing", "where did the week go", "close the week" (Friday), or after `season` sets the betting table. Do NOT trigger for planning the cycle or the betting table itself (season), the day-close (sunset), or a session-close (close-up).
user-invocable: true
allowed-tools: [Read, mcp__zenborg__get_cycle_spend, mcp__zenborg__list_cycle_allocations, mcp__plugin_linear_linear__save_document, mcp__plugin_linear_linear__list_documents, mcp__claude_ai_Slack__slack_send_message_draft]
---

# Appetite check

The weekly look at the betting table: did the days go where I bet them? Pitch:
`equanimitech/docs/pitches/2026-10-28-shape-up-for-one.md`.

Read-only until the last beat. **Draft, show, wait.** Nothing reaches Linear or
Slack before an explicit yes.

## 1. Read the meter

Call `mcp__zenborg__get_cycle_spend` with no arguments (active cycle, fresh
numbers). Use `check` in the result; do not recompute. If it errors with no
active cycle, say so and stop.

## 2. Print the table, every allocation

One row per `check.rows`, most-spent first. Personal allocations are shown here
(this is private to the session):

```
| Allocation | Area | Kind | Spent / appetite | % |
|---|---|---|---|---|
| Data trust | Themia | lane | 2.0 / 3 d | 67 % |
```

Mark a row `OVER` at 100 % or more and `watch` from 70 %. Then the cycle line,
each figure on its own line, large first:

- **Unattributed**: `check.unattributedPct` % of merged time, matched no
  allocation. It never counts as Bugs & ops. If it is above a third, say that
  the meter is mostly fiction and attribution comes before anything else.
- **Bugs & ops**: `check.bugsOps.days` d = `pctOfCapacity` % of capacity against
  the 25 % limit; say `over` when `over` is true.
- **Left to bet**: `check.daysLeftToBet` d of `check.capacityDays` d capacity.

Add one sentence on the pace if it is obvious (the cycle is x % elapsed and the
most-spent bet is at y %). No advice, no verdict.

## 3. Ask what was cut

There is no data source for "cut"; only the gardener knows. Ask one question:
**"What did you cut this week to land what you bet?"** Per allocation if he
wants, "nothing" is a fine answer. Wait.

## 4. Draft the Themia-only extract

Build it **only from `check.themiaExtract`**, the tool's own filter: Themia
allocations, the Themia unattributed note, the Bugs & ops figure when that lane
is Themia. Never add a row from `check.rows`, never mention a personal
allocation, equanimitech repo, total hours or days left to bet. Include the
cuts he named, for Themia allocations only.

Two drafts, shown in full, each in a code block:

**Linear document body** (French is not required; the team reads English or
French, keep his language of the day). Title
`Appetite check S<nn> (dd/mm → dd/mm)`:

```
## Appetite check
| Allocation | Spent / appetite | % | Cut this week |
|---|---|---|---|
...
Unattributed: x % of merged time matched no allocation.
Bugs & ops: x d = y % of capacity (limit 25 %).
```

**Slack message**, short (`smart-brevity`), **no `|` characters and no
markdown tables** (he pastes these); one allocation per line:

```
Appetite check S<nn>
- Data trust: 2.0/3 d (67 %), cut: ...
- ...
Unattributed x %. Bugs & ops y % of capacity (limit 25 %).
```

## 5. Wait, then post

Ask: "Post this to Linear and Slack?" Only an explicit yes in his message
counts. Then, as he approves each:

- **Linear**: `mcp__plugin_linear_linear__save_document` with `team: Engineering`,
  the title and body above. If a document with that title already exists
  (`list_documents`), update it by `id` rather than adding a second.
- **Slack**: `mcp__claude_ai_Slack__slack_send_message_draft` (a draft he
  sends). Ask which channel if he has not named one.

If a tool is missing or unauthenticated, skip that beat, name it in the close
line, and hand him the draft to paste. Never fall back to posting elsewhere.

## Rules

- **No writes without a yes.** Not the doc, not the Slack draft.
- **Personal never leaves zenborg.** The extract comes from `themiaExtract`
  alone; if it looks empty, say so rather than reaching into `rows`.
- The skill changes no allocation and no cycle; betting and cool-down are `season`.
