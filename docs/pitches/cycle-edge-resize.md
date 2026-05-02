# Cycle Edge Resize

**Shape Up Pitch — Tiny (≤1 day)**
**Date:** 2026-05-02
**Source idea:** `docs/ideas/2026-05-02-cycle-date-shifting.md`

---

## Boundaries

**Appetite:** Tiny — one focused session. If it overflows, ship the pointer-drag and defer keyboard nudges.

**In scope:**
- Drag the start or end edge of a cycle block in the `BandedHeatmap` to shift that boundary by whole days.
- Block on collision: a drag that would overlap a neighbor or invert the cycle (`end ≤ start`) clamps at the limit.
- Brief visual feedback when clamped (the blocking neighbor highlights for ~300ms).
- Persist via existing `CycleService.updateCycle({ startDate | endDate })`.

**Out of scope:**
- Push / domino collision policies. Block only.
- Keyboard nudges (`[` / `]`). Nice-to-have, defer.
- Editing dates from any other surface (`CycleCalendarDialog` was retired with the heatmap landing — the heatmap is the only date-edit surface).
- Undo/redo for cycle edits. Cycles aren't in `history-middleware` today; not adding them in this slice.
- Moment orphaning when shrink drops days that have allocated moments. Allocated moments are already independent of cycle date ranges (they reference `cycleId`, not the date interval). No cascade required.
- Buffer-day rules. Two cycles may touch (`end[A] + 1 === start[B]`); that's a placement choice, not a constraint.

---

## Elements

The whole feature lives inside `src/components/banded-heatmap/`. No new domain entities, no new application services, no schema changes. **The parent heatmap's drag state machine is not modified.** Resize is self-contained inside the handle.

**1. `<ResizeHandle>` component, self-owning drag**
A new component rendered inside `BandedHeatmapCycleBlock`, one instance per edge (start/end). It owns its own `pointerdown` / `pointermove` / `pointerup` handlers and a local ref tracking the in-flight delta. `e.stopPropagation()` on pointer-down so the parent heatmap never sees it (no pan kicks in, no create). On pointer-up, it calls `cycleService.updateCycle` directly. No parent state machine extension.

**2. Hover-revealed handles**
Handles are not rendered by default. The cycle block exposes `:hover` (and keyboard-focus) → handles fade in. Visual: ~6px wide indicator, 16px hit zone via padding, `ew-resize` cursor.

**3. Clamp logic — pure helper**
`clampCycleEdge({ cycleId, edge, candidateDate, allCycles }) → { date, blockedBy?: cycleId }`. Pure function: given a candidate date, returns the clamped date and, if clamping happened, which neighbor caused it. Lives in a new `src/lib/cycles/intervals.ts`. The handle calls this on every move; the heatmap doesn't care.

**4. Live preview + clamp feedback**
Two small observables in `ui-store.ts`:
- `cycleResizePreview$ = { cycleId, edge, date } | null` — read by `BandedHeatmapCycleBlock` to render the in-flight edge position while the drag is live.
- `clampHighlight$ = { cycleId, until } | null` — set when the move clamps against a neighbor, triggers a 300ms ring on the blocking neighbor's block.

**Component graph (delta only):**
```
BandedHeatmapCycleBlock.tsx
  ├─ (existing render, augmented to read cycleResizePreview$)
  ├─ <ResizeHandle edge="start"/>   ← new, hover-revealed
  └─ <ResizeHandle edge="end"/>     ← new, hover-revealed
src/lib/cycles/intervals.ts          ← new (clampCycleEdge)
src/infrastructure/state/ui-store.ts ← + cycleResizePreview$, clampHighlight$
```

---

## Risks

- **Edge handle vs click-to-select.** Cycle blocks are clickable (selects the cycle in the deck). The 6px handle must reliably distinguish click-on-block (select) from click-on-edge (resize). Mitigation: `e.stopPropagation()` on handle pointer-down; threshold-based — if pointer-up fires without crossing `DRAG_THRESHOLD_PX`, treat it as a select on the parent block, not a resize.
- **Touch targets.** 6px is too small for touch. Mitigation: 6px visual, 16px hit zone via padding. If still flaky on touch, defer touch resize and ship pointer-only first.
- **Clamp at the visible viewport edge.** What if the user drags past the left of the rendered horizon? The heatmap auto-extends. The clamp logic only cares about cycle neighbors and `start ≤ end`, so this should "just work" — but worth a quick check during build that auto-extension doesn't fight the drag.
- **Active cycle re-derivation.** `activeCycle$` is purely date-derived. Resizing a cycle to/away from "contains today" silently flips `activeCycle$`. Expected behavior, but worth eyeballing during manual test that the deck and timeline don't strobe.
- **First cycle / last cycle.** No left neighbor for the earliest cycle, no right neighbor for the latest. Clamp falls through to "no constraint from that side"; only the cycle-internal `end ≤ start` rule applies.

---

## Pitch

Today the only way to edit a cycle's dates is to ship something via `cycleService.updateCycle` programmatically — there is no UI gesture. The banded heatmap already renders cycles as blocks on a temporal axis; the natural gesture is to drag their edges. With the `dragRef` state machine and the cycle-block component already in place, adding a third drag mode is mechanical: ~30 LOC of state-machine extension, ~25 LOC of edge-handle render, ~20 LOC of clamp helper. No new entity, no service, no schema, no migration. Block-on-collision keeps the rule set tiny and predictable. Ship it in a session.

---

## Build plan (tiny)

1. **Write `clampCycleEdge` + unit tests.** New `src/lib/cycles/intervals.ts`. Pure function: candidate date + this cycle + all cycles → `{ date, blockedBy? }`. Unit-test: no neighbor, blocked by left, blocked by right, blocked by self-inversion.
2. **Add `cycleResizePreview$` and `clampHighlight$` to `ui-store.ts`.** Both ephemeral. Helper to set+auto-clear `clampHighlight$` after 300ms.
3. **Build `<ResizeHandle>` component.** Self-owns pointerdown/move/up. Pointer-down: `setPointerCapture`, store anchor x + original ISO date, stopPropagation. Move: convert dx → day offset using the heatmap's cell width (read from a CSS var or context already exposed by `BandedHeatmap`), call `clampCycleEdge`, write `cycleResizePreview$`, write `clampHighlight$` if blocked. Up: commit via `cycleService.updateCycle`, clear preview. `ew-resize` cursor, 6px visual / 16px hit zone.
4. **Wire into `BandedHeatmapCycleBlock`.** Render `<ResizeHandle edge="start"/>` and `<ResizeHandle edge="end"/>`. Show on `:hover` (and `:focus-visible`). Read `cycleResizePreview$` and `clampHighlight$` to apply in-flight edge position + clamp ring.
5. **Manual test pass.** Drag earliest start, latest end, middle cycle's both edges, into-neighbor (clamps), past-self (clamps), drag a cycle's start past today and back (active flips correctly), parent heatmap pan/create still works (handles eat their own events).

Total budget: ~100 LOC across 4 files (2 new: `intervals.ts`, `ResizeHandle.tsx`). One commit, conventional message `feat(heatmap): drag cycle edges to resize with collision clamping`.
