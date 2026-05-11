# Heatmap Cells: Gradient or Noise Texture

**Date:** 2026-04-23
**Status:** Idea
**Focus:** Banded heatmap cell aesthetic

## Seed

Flat area-color cells are fine for v1, but cells could carry more texture:

- **Gradient** — subtle light→dark gradient on each cell, keyed by phase (AM brighter top, EVE darker bottom) or by fullness (more moments = deeper saturation).
- **Noise** — very faint paper/grain texture overlay so cells feel hand-printed, not pixel-perfect. Matches the "warm paper" feel from the spec.
- Could combine: area-color gradient + global noise overlay at 2–4% opacity.

## Why it could sing

- Area color alone can read as dashboard-y. Texture adds the "journal / chapter" quality the spec's serif + paper tones already hint at.
- Noise is cheap, CSS-only (`filter: url(#noise)` or a tiled PNG).
- Gradient per-cell can encode a second dimension without adding icons (e.g., dominance strength, count).

## Open questions

- Texture at 14px cell size may be invisible — test at target render size.
- Does noise stay readable in dark mode?
- Risk: violates "still; motion reserved for user" if gradient animates. Keep static.

## Related

- Banded heatmap spec (pending).
