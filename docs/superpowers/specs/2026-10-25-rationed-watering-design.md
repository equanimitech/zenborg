# Rationed watering: a daily attended-minutes budget

**Status:** approved design, 2026-10-25. Not built.
**Build model:** sonnet.

## The bet

A fourth watering mode, `rationed`, gives a host pool a daily budget of attended minutes. Inside the window the hosts stay open until the pool's minutes reach the budget, then they wall (page loads only) until the window ends.

First use: YouTube on weekends, 60 minutes a day.

## Why

- Weekday YouTube is a clock window (`youtube-afternoon`, 13h to 16h, MON to FRI). On weekends Rafa wants a duration cap, not a clock window.
- No fence primitive counts usage. Gates (`set_browser_gate`) fire every N attended minutes but never wall; schedules wall by the clock only.
- `get_site_minutes` already reports attended minutes per host via `bouts()`. The budget counts with the same function, so the readout and the wall never disagree.

## Boundaries

**In:**
- `rationed` mode on `set_watering_hours`, with `budgetMinutes` and `restricts.excludeHosts`.
- An optional `reach: "navigation"` on `set_watering_hours` for `dry` and `rationed`, so a re-declaration can carry it (see "Bug folded in").
- Extension: budget-aware activation, a recount alarm, an allow rule for excluded hosts, a popup readout.

**Out:**
- Chess. It keeps its `chess-afternoon` clock window, every day.
- Phone and resolver reach. Browser only, like every watering browser rule.
- Shared pools across policies. One policy is one pool.
- A warning cue before the wall. Add it as a gate rung later if wanted.

## Declaration

```jsonc
set_watering_hours {
  "name": "youtube-weekend",
  "mode": "rationed",
  "budgetMinutes": 60,
  "reach": "navigation",
  "window": { "fromHour": 0, "toHour": 0, "weekdays": ["SAT", "SUN"] },
  "waters": ["Entertainment"],
  "restricts": {
    "hosts": ["youtube.com", "m.youtube.com", "youtu.be"],
    "excludeHosts": ["music.youtube.com"]
  },
  "unlockNote": "Tomorrow. An hour of YouTube a day on weekends; the video you're on finishes."
}
```

Validation in `declareWateringHours` (`src/application/use-cases/fences.ts`):
- `rationed` requires `budgetMinutes`, an integer from 1 to 1440, and `unlockNote` (invariant 6, as for `dry`).
- `budgetMinutes` on any other mode is refused, not ignored.
- `excludeHosts` must each be a subdomain of some `hosts` entry; otherwise refused.
- `rationed` requires `restricts.hosts`; garden, paths and tools surfaces are refused for this mode.

## Domain (`src/domain/intervention/rules/wateringHours.ts`)

`rationed` produces one browser rule per host, like `dry`: mechanism `access-block`, a `schedule` primitive wrapping a standing `cooldown`. The schedule primitive gains:

```ts
budget?: {
  minutes: number;          // budgetMinutes
  pool: string;             // policy name, shared by every rule the policy emits
  exclude: readonly string[]; // excludeHosts
}
```

`reach`, when given, becomes `wraps.enforcement = { at: "browser", reach: "navigation" }` for both `dry` and `rationed`.

## Extension

```
activity log (IndexedDB, activity/log.ts)
   └─► bouts() (modules/domain/bouts.ts) ─► spentToday: Record<pool, minutes>
fence cache ─► parse.ts: Fence.budget { minutes, pool, exclude }
   └─► isFenceActive(fence, now, spent) = inWindow && (no budget || spent[pool] >= minutes)
          └─► project.ts: DNR rule 3 (navigation) + DNR allow rule for excluded hosts
```

**Units, each pure unless noted:**

| Unit | Does | Depends on |
|---|---|---|
| `fence/budget.ts` (new) | `poolMinutes(events, pools, day)`: today's attended minutes per pool, hosts matched by longest suffix, `exclude` dropped | `bouts()`, `localDay` |
| `fence/parse.ts` | reads `budget` off the schedule primitive into `Fence.budget`; `isFenceActive` takes `spent` | types |
| `fence/types.ts` | `Fence.budget?: { minutes; pool; exclude }` | none |
| `fence/project.ts` (I/O) | passes `spent` through; adds an `allow` rule (priority above the block) for excluded hosts of active budgeted fences | DNR |
| `entrypoints/background.ts` (I/O) | a `zenborg-ration` alarm, every 1 min while any rationed window is open, recomputes `spent` from the log and re-projects | alarms, log |
| popup | `YouTube: 42 / 60 min today` per active pool, plain text only: no bar, no colour change near the budget (red line: progress bars against targets) | `poolMinutes` |

**Day boundary:** minutes are per machine-local day (`localDay`, same as `get_site_minutes`), so the pool resets at midnight with no extra state. A bout lands on the day it started.

**Exit:** the cooldown's `out_of_band` unlock note. `parseFences` already refuses entries without one.

**Failure mode:** if the log read throws, `spent` is treated as 0 for that tick (no wall) and the error is logged with `console.error`. A budget that cannot count must not wall; a blocker that fails silently is worse than none, so the error is never swallowed.

**Permissions:** DNR `allow` and `block` need no host permissions. Zero `host_permissions` stays true.

## Bug folded in

`set_watering_hours` cannot express `enforcement.reach`. On 2026-10-25, re-declaring `chess-afternoon` dropped the hand-added `reach: "navigation"`, which would have killed a live game's websocket at 16h. It was restored by hand in `~/.zenborg/fences.json`. The optional `reach` parameter above closes this: after it ships, `chess-afternoon` is re-declared with `reach: "navigation"` and nothing is hand-edited.

## Acceptance

1. `set_watering_hours` with the declaration above writes three rules (`watering:youtube-weekend:browser:<host>`), each with `budget` and navigation reach.
2. On a Saturday with 59 attended YouTube minutes, youtube.com loads. At 60, a new youtube.com load is blocked; a video already playing keeps playing.
3. music.youtube.com never counts toward the pool and is never walled by `youtube-weekend`.
4. On Monday the policy is inactive whatever the minutes.
5. The popup shows the pool's minutes against the budget.
6. Re-declaring `chess-afternoon` with `reach: "navigation"` keeps navigation reach.
7. The pool minutes for a day equal `get_site_minutes` for the same hosts and day (minus excluded hosts), within rounding.

## Tests

- `fence/budget.test.ts`: sums across pool hosts; drops excluded subdomains; per-day split; empty log is 0.
- `fence/parse.test.ts`: budget parsed; active only when in window and spent ≥ budget; no budget means current behavior.
- `fence/project.test.ts`: allow rule emitted for excluded hosts only while the budgeted fence is active.
- `src/application/__tests__/fenceAuthoring.test.ts`: rationed without `budgetMinutes` refused; `budgetMinutes` on `dry` refused; bad `excludeHosts` refused; `reach` lands on `dry` and `rationed`.
- `bouts.ts` is vendored in two places; if touched, change both (`browserVendored.test.ts` pins them).

## Rollout

1. Ship, then reconnect the zenborg MCP server.
2. Declare `youtube-weekend` as above.
3. Re-declare `chess-afternoon` with `reach: "navigation"`; delete the hand patch's backup once diffed clean.
