---
status: draft
slice: 1 of 2 (band first; the /garden pane is slice 2)
source: conversation 2026-10-27; mod candidate #6 in equanimitech/.claude/attently/claude-code-mods.md
---

# Moment band

**Bet:** The stale-moment prompt that `moment-awareness.mts` writes for Claude at every session start becomes a one-line band above the prompt with the phase's moments as taps. A daily Ask becomes a Press.

**Why:** A recurring conversational command is a missing button (torchbearer, *Glance, Press, Ask*). Today the gardener is asked, in prose, through Claude, every session: "stale active Netflix, propose picking a Morning moment". Picking means a sentence and an MCP round trip for a choice that is one of three names.

## Surfaces

| Speed | Surface | Holds |
|---|---|---|
| Glance | status line | `≋ 🍿 Netflix`; stale: `≋ 🍿 Netflix · from the afternoon`; none: `≋ Morning` |
| Press | band above the prompt | only when the active moment is stale or none, and this phase has something to offer |
| Ask | chat (`/tend`, `/sunrise`) | unchanged |

### The band

Stale or none, with moments planted in this phase:

```
≋ Netflix is from the afternoon   [🧘 meditation] [🥐 breakfast] [🟰 quality time] [Later]
≋ No intention this morning       [🧘 meditation] [🥐 breakfast] [🟰 quality time] [Later]
```

None planted in this phase, habits whose phase is this phase (up to three, in habit order):

```
≋ Nothing planted this morning    [+ 🧘 meditation] [+ 🏃 run] [Later]
```

- A moment tap tends it: `set_active_moment { momentIdOrName: <id> }`.
- A `+` tap plants and tends: `add_moment { habitId, day: today, phase }`, then `set_active_moment` on the new id.
- **Later** hides the band until the phase changes. Held in `$.state`, so it lasts the session, not across sessions.
- No band when nothing is planted and no habit belongs to this phase. The status line still shows `≋ Morning`.
- At most three taps plus Later. Area emoji only (the gardener chose them); `≋` is the only system mark.
- No suggestion is highlighted or pre-focused (principle 9, Downstream Allocation). Taps are in board order.

### Stale

Stale = the shell hook's two readings, unchanged:
- `staleReason(moment, wakingDayKey())` from `plugin/domain/attention/ActiveMoment.ts`: gone, or not on today's board. Reads as none.
- the moment's phase differs from the current phase, or it was set more than 120 minutes ago.

### When it is read

At `session.start`, at every `turn.start` (main loop only), and after each tap. A phase change mid-session therefore raises the band on the next prompt. Reads are the vault JSON, read-only, as `moment-awareness.mts` reads it: `activeMoment.json`, `moments.json`, `areas.json`, `habits.json`, `phaseConfigs.json` under `ZENBORG_HOME` or `~/.zenborg`.

### Writes

Only through `$.tool.call` on the zenborg MCP tools. The call runs the permission check like any model call; the vault keeps one writer. A failed call: one toast (`zenborg: not saved, try again`), the band stays as it was.

## Changes

| File | Change |
|---|---|
| `plugin/hooks/moment-band.tsx` (new) | the module: status line, band, taps |
| `plugin/hooks/moment-band.test.tsx` (new) | tests below |
| `plugin/hooks/hooks.json` | `"modules": ["./moment-band.tsx"]` |
| `plugin/hooks/moment-awareness.mts` | facts only: drop every "Propose…" sentence and tool hint; keep the active moment, area, staleness and phase as context for Claude |
| `plugin/.claude-plugin/plugin.json` | `"types"` naming the contract for the band's one state value (Later's phase); version bump |

## Boundaries

Out of this slice:
- the `/garden` pane (slice 2), set aside (unallocate), moving a moment;
- ritual panes (decided against: rituals stay an Ask; attently's ring owns the ritual lever);
- any change to the MCP server or the vault shape.

## Risks

- **Importing the domain file.** Whether a hooks module can import `../domain/attention/ActiveMoment.ts` at runtime. If not, copy `staleReason` and `wakingDayKey` into the module and extend the existing byte-for-byte test to pin that copy too.
- **Builds without mods.** How an older Claude Code reads `"modules"` in `hooks.json`. If it refuses the file, the shell hooks stop too. Check with `claude plugin validate` and one older build before release.
- **Tool name.** The MCP tool is `mcp__zenborg__set_active_moment` only where the server is registered as `zenborg`. Resolve the name from `$.tool.list()` by suffix; no zenborg server, no band.
- **Status line ownership.** oliba 0.19 gave the status line back. `$.ui.status` adds an entry; confirm it composes with a user's own `statusLine` command rather than replacing it.

## Acceptance

1. Active moment set this phase, set under 120 minutes ago: status line `≋ <emoji> <name>`, no band.
2. Active moment from an earlier phase, three moments planted this phase: band names the old one and offers the three; tapping one calls `set_active_moment` with its id, and the band leaves.
3. No active moment, nothing planted, two habits in this phase: band offers `+` for both; a tap calls `add_moment` then `set_active_moment`.
4. Later hides the band until `turn.start` sees a new phase.
5. A failing tool call toasts once and changes nothing on screen.
6. `moment-awareness.mts` output contains no "Propose".
7. `claude plugin test`, `claude plugin validate` and `pnpm test` in `plugin/` pass.
