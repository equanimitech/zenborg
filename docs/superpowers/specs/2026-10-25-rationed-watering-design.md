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
- `reach` (already on `set_watering_hours` for `dry`) extended to `rationed`.
- Extension: budget-aware activation, a recount alarm, a dedicated DNR rule that spares excluded hosts, a popup readout.

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

`reach` already becomes `wraps.enforcement = { at: "browser", reach }` for `dry` browser rules (`dryRung`); `rationed` reuses `dryRung`, so it inherits that and the use case's `priorReach` keep-on-redeclare.

## Extension

```
today's events = host copy (relay queryEvents) ∪ outbox (activity/log.ts readEventsSince), mergeById
   └─► bouts() ─► rationSpent { day, minutes: Record<pool, number> }  (chrome.storage.local)
fence cache ─► parse.ts: Fence.budget { minutes, pool, exclude }
   └─► liveFences() = withLifts(withRations(fences, spent, now))   // unspent pools drop out, like a lift
          └─► project.ts: one DNR block rule per spent pool, requestDomains = pool hosts,
                          excludedRequestDomains = exclude, reach from the fence
```

The local log is an outbox: the relay deletes events once the host acks them, so today's count must merge the host's copy with the outbox. `fence/pass.ts` (`passesUsed`) already does exactly this; reuse the pattern.

**Units, each pure unless noted:**

| Unit | Does | Depends on |
|---|---|---|
| `fence/ration.ts` (new) | `poolMinutes(events, fences, now)`: today's attended minutes per pool, excluded hosts dropped. `withRations(fences, spent, now)`: drops budgeted fences whose pool is under budget. `rationBlocks(fences)`: one `{ domains, except, reach }` per pool | `bouts()` |
| `fence/parse.ts` | reads `budget` off the schedule primitive into `Fence.budget`; `fencesFor` skips a host covered by `budget.exclude`; `standingBlockHosts` skips budgeted fences (they get their own rule) | types |
| `fence/types.ts` | `Fence.budget?: { minutes; pool; exclude }` | none |
| `fence/project.ts` (I/O) | one block rule per spent pool (ids 100+), `excludedRequestDomains` for the exclude list | DNR |
| `fence/store.ts` (I/O) | `rationSpent` storage item; `liveFences` applies `withRations` | storage |
| `entrypoints/background.ts` (I/O) | a `zenborg-ration` alarm, every 1 min while any rationed window is open, recomputes `spent` from the log and re-projects | alarms, log |
| popup | `YouTube: 42 / 60 min today` per active pool, plain text only: no bar, no colour change near the budget (red line: progress bars against targets) | `poolMinutes` |

**Day boundary:** minutes are per machine-local day (`localDay`, same as `get_site_minutes`), so the pool resets at midnight with no extra state. A bout lands on the day it started.

**Exit:** the cooldown's `out_of_band` unlock note. `parseFences` already refuses entries without one.

**Failure mode:** if the log read throws, `spent` is treated as 0 for that tick (no wall) and the error is logged with `console.error`. A budget that cannot count must not wall; a blocker that fails silently is worse than none, so the error is never swallowed.

**Why not a DNR `allow` rule for music:** a higher-priority allow would also beat the night and Monday blocks on music.youtube.com. `excludedRequestDomains` on the budget's own rule spares music from this policy only.

**Permissions:** DNR `block` with `excludedRequestDomains` needs no host permissions. Zero `host_permissions` stays true.

## Note: the reach drop was a stale server

On 2026-10-25 a re-declaration of `chess-afternoon` dropped `reach: "navigation"`. The repo already exposes `reach` and keeps it on re-declare (`priorReach`); the session was talking to an MCP server built before that. It was restored by hand in `~/.zenborg/fences.json`. Nothing to build; reconnecting the server is the fix.

## Acceptance

1. `set_watering_hours` with the declaration above writes three rules (`watering:youtube-weekend:browser:<host>`), each with `budget` and navigation reach.
2. On a Saturday with 59 attended YouTube minutes, youtube.com loads. At 60, a new youtube.com load is blocked; a video already playing keeps playing.
3. music.youtube.com never counts toward the pool and is never walled by `youtube-weekend`.
4. On Monday the policy is inactive whatever the minutes.
5. The popup shows the pool's minutes against the budget.
6. The block page shows the unlock note when a walled youtube.com load is redirected.
7. The pool minutes for a day equal `get_site_minutes` for the same hosts and day (minus excluded hosts), within rounding.

## Tests

- `fence/ration.test.ts`: sums across pool hosts; drops excluded subdomains; only today's bouts; `withRations` keeps a fence at or over budget and drops it under; stale `day` reads as 0.
- `fence/parse.test.ts`: budget parsed; `fencesFor` skips excluded hosts; `standingBlockHosts` skips budgeted fences.
- `fence/project.test.ts`: `buildDnrRules` emits the pool rule with `excludedRequestDomains`.
- `src/application/__tests__/wateringHoursFences.test.ts`: rationed without `budgetMinutes` refused; `budgetMinutes` on `dry` refused; bad `excludeHosts` refused; rationed with areas/paths refused.
- `bouts.ts` is vendored in two places; if touched, change both (`browserVendored.test.ts` pins them).

## Rollout

1. Ship, rebuild the extension and the MCP server, reconnect the server.
2. Declare `youtube-weekend` as above.
