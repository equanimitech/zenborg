# Browser

The browser half of the **screen** surface (`plugin/surfaces/screen.md`):
which site had the tab, for how long, and which video played. Also where
fences act on sites.

## Sources

| Source | Type | Probe method |
|--------|------|-------------|
| zenborg browser extension (sensor) | local log | `mcp__zenborg__get_footprints` → `screen`; raw: `~/.zenborg/log/<day>.browser.jsonl` |
| zenborg fences on hosts | app internal | `mcp__zenborg__get_fence`, `mcp__zenborg__get_boundaries` |

## Key fields

### Dwell (written for every domain)

- `tab_activated { domain, tab }` opens a span; `focus_end`, `idle_start` or
  the next `tab_activated` closes it. Duration is tracked: minutes per domain
  come back through `get_footprints` (capped at 120 min per span).
- `focus_start`, `navigation_committed`, `tab_opened`, `tab_closed`,
  `idle_end` — context, not boundaries.

### Senses (observe-tier domains only)

- `video_started` / `video_resumed` / `video_paused` / `video_ended`
  `{ domain, tab, seconds }` — playback counts as attention on its domain
  whether or not the window has focus. A screen lock closes it; plain idle
  does not.
- `post_seen`, `game_finished` — feed and game senses where an adapter exists.

### Fences (`get_fence`, `get_boundaries`)

- Standing host blocks, browser gates and transforms, with crossing tallies.

## Noise (skip on probe)

- URLs, titles, post content — never written (privacy tier: domain + timing)
- Extension version metadata, IPC details

## Gotchas

- The video sense runs in the top frame only: iframe and DRM players emit no
  video events until pitch slice 5 (see `screen.md`, blind spots).
- A domain off the watchlist's observe tier gets dwell but no senses.
- Brave in front with no `tab_activated` attributed reads as the desktop app
  "Brave Browser", unmapped.
