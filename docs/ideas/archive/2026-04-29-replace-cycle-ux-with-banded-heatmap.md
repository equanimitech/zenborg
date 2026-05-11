---
gtd:
  status: shipped
shipped:
  date: 2026-05-11
  commits:
    - 69d0b33  # refactor: drop manual activation; cycle dates are the only source
    - 2fd6597  # feat(heatmap): drag cycle edges to resize
    - cf545d7  # fix(heatmap): live drag, edge-straddle handles
    - 5a3dc48  # fix(heatmap): preview-during-drag, portaled date label
  note: "Shipped piecewise via heatmap commits. Cycle UX replaced; polish ideas (gradient/noise, globe-spin, dense variant) remain separate someday items."
---

# Replace cycle UX with banded heatmap

Raw capture — 2026-04-29.
**→ Pitched 2026-04-29:** [`docs/pitches/banded-heatmap-cycle-ux.md`](../pitches/banded-heatmap-cycle-ux.md)

- Replace the current cycle UX with the **Banded Scrollable Heatmap** spec (`~/Downloads/Banded heatmap spec.html`, ~46KB, 787 lines, dated 2026-04-23).
- Spec essence (verbatim pull-quote from the doc):
  > "Two questions, one surface: *which cycle am I in?* and *how has each day been tended?* The band answers the first; the cells answer the second. A horizontal scroll lets each beat breathe."
- Two densities, one form:
  - **Minimap (dense)** — peripheral, ambient, 6–8px cells, fits all cycles in viewport. Lives at edge of page like a scrollbar.
  - **Banded scrollable (this idea)** — primary cycles surface, 14px cells, ~3 cycles visible, horizontal pan. Visited on purpose.
- Anatomy: header row · cycle brackets · cycle bands (behind grid) · 3-row heatmap (AM/PM/EVE) × N days · vermillion now-needle · time axis · fixed left gutter (phase labels).
- Band system: only **one lifted band at a time** (active = paper-white fill + ink borders). Past/future = transparent + hairline edges only. Brackets distinguish past (mute), active (ink 600), future (italic).
- Scroll: horizontal only · today centered on mount · no snapping · momentum native · clamped to `[first-past-cycle-start, last-future-cycle-end]` (no infinite scroll). "↩ now" chip when today is off-screen.
- **Create by gesture:** no "+ new cycle" button, no modal. Press-drag in gap-space → draft band → release → name popup. Vermillion readout when invalid (overlap). Backfilling past cycles allowed; crossing today allowed.
- Cell color owned by user's areas (no blending). Tense opacity: past 0.55 · active 1.0 · future 0.70 · unplanted dashed · fallow filled gray.
- Red lines (from spec):
  - Not a planner ("+ add moment" on empty cells forbidden — planting on day-strip).
  - Not a report (no "12 moments this cycle" annotations).
  - Not a scoreboard (no streaks, no "consistent on Wednesdays").
  - Not an animation stage (no pulse on today, no breathing band).
  - Not a selection surface (no marquee-select across cells).
  - Never blend two area colors. Never fill past/future band. Never use now-vermillion elsewhere.
- Related: existing idea `2026-04-23-harvest-dense-heatmap.md` already framed banded for **Cultivate**; harvest gets the dense variant. This idea is about the **cycle UX surface** specifically — needs disambiguation at roundtable: is "cycle UX" = cultivate page, or a separate surface?
- Open questions:
  - Which existing surface gets replaced? Cultivate page? Cycle detail view? Both?
  - Coexistence with the current `CycleStack`/`PlanAreaCard` flow — does this *replace* or *augment*?
  - Mobile: spec says <600px is the wrong surface, fall back to mobile transpose. Project CLAUDE.md says landscape-only on mobile — check fit.
    - **Update — 2026-04-29:** mobile fit will need to transpose the timeline from a row to a column. Days run vertically, phases run horizontally (or stacked per day). Bands become horizontal stripes spanning the day-rows of each cycle. Now-needle becomes a horizontal line at today's row. Scroll axis flips: vertical pan instead of horizontal. Reconcile with CLAUDE.md landscape-only constraint — does landscape mobile keep the row layout (no transpose needed), and transpose only applies to portrait? Or transpose for all mobile? Decide at roundtable.
  - Stone-tones constraint (CLAUDE.md): spec uses `oklch` area palette + vermillion `--now`. Need to map area palette to existing zenborg area colors and confirm `--now` accent is allowed (red lines say "monochrome unless attributed to area" — `now` is *temporal*, not area-attributed; flag for principles review).
  - Data contract in spec: `{ cycles, moments, today, focusDate }` with derived per-cell render rule (dominant areaId wins, tie-break most recent). Verify against current zenborg domain shape.
  - Create-by-gesture vs existing cycle creation flow — replaces? coexists?
- Don't shape yet.
