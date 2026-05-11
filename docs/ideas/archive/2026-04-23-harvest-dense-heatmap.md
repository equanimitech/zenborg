# Harvest: Dense Heatmap Variant

**Date:** 2026-04-23
**Status:** Idea
**Focus:** Harvest page surface

## Seed

Cultivate gets the banded scrollable heatmap (14px cells, ~3 cycles at a glance, horizontal scroll, active band lifted). Harvest grows the same form into a **denser** variant with more detail — closer to the original "Cycle Minimap" spec (6–8px cells, full-timeline fit, ambient peripheral view).

## Direction

- Same data contract as banded heatmap (cycles, moments, today, focusDate).
- Zoomed-out: every cycle of the user's history fits on screen.
- More detail per cell — multiple areas per day possible, per-phase grain, heat-by-count, or reflection annotations.
- Could live as a full Harvest page; banded heatmap remains the Cultivate/bottom companion.

## Open questions

- Blend multi-area days or stay single-dominant?
- Any aggregate overlays (cycle totals, area distribution, dormancy runs)?
- Scroll semantics — one long pannable vs paged by year/cycle-batch?

## Related

- Banded scrollable heatmap spec (`docs/superpowers/specs/2026-04-23-banded-heatmap-design.md` — pending brainstorm).
- `docs/principles.md` — history is visible, not loud.
