# Calendar & zoom ladder: status and absorbed ideas

Companion to [2026-06-03-calendar-zoom-ladder](2026-06-03-calendar-zoom-ladder.md), which is stamped and therefore left unedited. This file holds what has shipped since then, plus two ideas merged into the ladder during the 2026-10-07 triage.

## What has shipped (as of 2026-10-07)

| Rung | State | Where |
|---|---|---|
| Heatmap | shipped | components/banded-heatmap, /heatmap-preview, harvest |
| Week grid | shipped | components/week-grid, CultivateWeekView |
| Phase / time zoom toggle | shipped | CultivateZoomToggle |
| Circular day | not built | |
| Hour view | not built | |
| Pinch zoom | not built | |
| Calendar push (moments as events) | not built | #58 |

## Absorbed: zoomed-in mode and the phase cap (2026-06-08)

Original file: `archive/2026-06-08-calendar-zoomed-in-mode-and-phase-cap.md`.

The idea was to connect Zenborg to Google Calendar so that a zoomed-in mode time-blocks the day's moments as calendar events. The first test would be whether blocking out a full cycle week, with buffers and allowances, helps keep the rhythm.

- **The phase cap is resolved.** The 3-per-(day, phase) cap is gone everywhere: the MCP reports `dayViewOverflow` as information, never as a refusal. The proposal to gate the cap on granularity is moot.
- **Still open:**
  - Push only, or two-way? Mind the "never build a Zenborg-Things sync" lesson.
  - Does the experiment live in zenborg, or as a separate spring?

## Absorbed: cycles should appear in the calendar (2026-06-23)

Original file: `archive/2026-06-23-cycles-should-appear-in-the-calendar.md`.

> Would be good to have at least the cycles surface in the calendar.

CycleCalendarDialog already renders existing cycles as bands, but only when creating a cycle. Showing cycles in an external calendar is unbuilt, and it belongs with the calendar push (#58).
