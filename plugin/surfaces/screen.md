# Screen

Where the gardener's eyes were on the Mac: which app was in front, which site
had the tab, which video was playing. One reading surface, two sensors.

## Sources

| Source | Type | Writes | Read through |
|--------|------|--------|--------------|
| zenborg-daemon (desktop sensor) | local log | `~/.zenborg/log/<day>.desktop.jsonl` | `mcp__zenborg__get_footprints` → `screen` |
| zenborg browser extension | local log | `~/.zenborg/log/<day>.browser.jsonl` | `mcp__zenborg__get_footprints` → `screen` |

Profile of the browser half: `plugin/surfaces/browser.md`.

Never read the JSONL by hand to answer "where did my week go". `get_footprints`
is the one reader; the app's `/week` runs the same function.

## Key fields

### `get_footprints` → `footprints[surface="screen"]`

- `thisWeek.byArea[]` / `lastWeek.byArea[]` — `{ areaId, areaName, minutes }`.
  Per area, desktop and browser spans are unioned, so a focused tab that is
  also playing counts once.
- `thisWeek.unmapped[]` — the largest locators no area claims: app names
  ("cmux", "Spotify") and hosts. An unmapped app only counts where no browser
  span covers it, so "Brave Browser" in front of a resolved tab is not unmapped.
- `coverage` — `{ seenHours, idleCreditedMin, unmappedMin }`:
  - `seenHours` — clock hours in which either sensor left at least one event.
  - `idleCreditedMin` — minutes credited through idle. Always 0 for now (see
    blind spots).
  - `unmappedMin` — every unmapped minute, not just the listed ones.

### Raw events (for probing only)

- desktop: `app_switched { app_name, is_full_screen, window_title }`,
  `idle_start { thresholdMs: 120000 }`, `idle_end`, `writer_started`
- browser: see `browser.md`

## Blind spots

Name these whenever screen minutes are read back. A number without what it
could not see is the 2026-10-09 failure: Entertainment read "doubled" when
viewing had only moved from Stremio to YouTube.

- **Off-screen moments can't be traced.** A run, a dinner, a book: no screen
  sensor sees them. The readback marks such moments `traceable: false` —
  untraceable, never missed.
- **Idle after 120 s ends a span** (until pitch slice 4). The desktop sensor
  closes the frontmost app's span at `idle_start`, so a film watched without
  touching the keyboard counts its first two minutes. `idleCreditedMin` stays
  0 until the daemon credits players holding the display awake.
- **Embedded and DRM players emit no video events** (until pitch slice 5). The
  extension's video sense runs in the top frame only, so a player in a
  cross-origin iframe, or a DRM player, writes no `video_started` /
  `video_paused`. Background playback in such a tab is invisible.
- **Unmapped apps and hosts.** Minutes on an app or host no area declares sit
  in `unmapped`, not in any area. The next unmapped site will be a different
  one, so always read `unmappedMin`. Fix with `mcp__zenborg__map_area`
  (`kind: "app" | "host"`), e.g. a streaming site at `example.tv` →
  `{ kind: "host", key: "example.tv", area: "Entertainment" }`.
- **Sites off the observe tier sense nothing deep.** Tab dwell is written for
  every domain, but video events only for domains on the extension
  watchlist's observe tier.
- **The Mac asleep or the daemon stopped** shows as fewer `seenHours`, not as
  zero attention.

## Noise (skip on probe)

- `window_title` (privacy tier: never surfaced)
- `writer_started` heartbeats

## Gotchas

- Surfaces overlap. An agent run (work) while its terminal is in front
  (screen) is the same hour on two surfaces; never add surfaces into one total
  without saying so.
- Week over week is two numbers. Never a ratio, never "doubled", never an arrow.
