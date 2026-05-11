---
gtd:
  status: shipped
shipped:
  date: 2026-05-11
  commits:
    - 2fd6597  # feat(heatmap): drag cycle edges to resize with collision clamping
    - cf545d7  # fix(heatmap): live drag, edge-straddle handles, portaled create popup
---

# Cycle date shifting

Raw capture — 2026-05-02.

- We need to easily shift cycle start / end dates.
- When two cycles sit side-by-side without a buffer, shifting one needs to adapt the neighbor accordingly (push, shrink, or block).
- Why this matters: active cycle is derived from dates (`activeCycle$`), so date-edit IS the primary activation/lifecycle gesture. Today the only place to do this is the `CycleCalendarDialog`, and even there overlaps just block creation rather than negotiate.
- Adjacent angles:
  - Adjacency policies on shift:
    - **push** — neighbor slides over by the same delta (shift train).
    - **shrink** — neighbor's edge gets clipped to make room.
    - **block** — refuse the move; require the user to resolve the neighbor first.
    - User probably wants different policies in different contexts. Default should feel "natural" — likely **push the future side, shrink/block the past side**.
  - Direct manipulation: drag the start or end edge of a cycle bar in the calendar/timeline. Snap to day. Visual feedback for which neighbor is affected.
  - Keyboard: `[` / `]` to nudge selected cycle's edges by a day (or week with Shift).
  - Constraints: don't allow `endDate <= startDate`; don't allow shrinking past zero days; flag if shift would orphan moments allocated to dropped days.
- Questions:
  - Where does shifting live? `CycleCalendarDialog` (today's calendar UI), the heatmap (cycles already render there), or both?
  - Should there be a single canonical "edit cycle dates" dialog, or always-direct-manipulation in context?
  - When neighbors get pushed, is that one undoable operation or N? (probably one batched op, like the existing history-middleware pattern)
  - Buffer days: should two cycles ever be allowed to touch (end[A] = start[B] - 1)? Or is touching the default and gaps the exception?
  - What happens to moments allocated on days that fall outside the new range? Orphan via cycleId, like archive_habit cascade? Or refuse the shift?
  - Does shifting an active cycle (one containing today) feel different from shifting a past/future one?
- Don't shape yet.

---

## Follow-up — 2026-05-02

Adjacency-policy clarification (Rafa):

- **Rigid-link policy**: when two cycles touch (no buffer), the shared boundary acts as one. Dragging end[A] also moves start[B] by the same delta, and vice versa. Not a push-train of independent cycles — a single shared edge.
- Open mechanic: how do we *separate* two touching cycles when the rigid link prevents pulling them apart?

Separation gestures (candidates):

1. **Modifier-key drag** — Alt/Shift while dragging end[A] breaks the link, leaves a gap. Cheap, invisible, undiscoverable.
2. **Visible seam handle** — small affordance on the shared boundary. Dragging the seam pulls the cycles apart (creates gap); dragging either cycle's edge still moves the boundary as one. Discoverable, matches metaphor.
3. **Two-step click** — first interaction selects the boundary in "linked" mode; clicking the boundary again splits it into independent end[A] / start[B] handles. More steps, no visual cost.

Lean: option 2 (visible seam). Discoverable, no hidden modifier.

Other open questions:

- Minimum gap when separating: 0 days (touching but unlinked — confusing) or 1 day (real calendar gap)? Probably 1 day.
- Re-merging: dragging cycles back to touch should re-establish the rigid link automatically? Or require an explicit "snap together" gesture?
- Does the rigid-link include any buffer state, or strictly `end[A] + 1 day === start[B]`?
- For an active cycle (contains today), does separating it from a future neighbor have any side effect? (probably none — active is purely date-derived)

---

## Pivot — 2026-05-02 (later)

Drop rigid-link. **Every boundary is always individual.** Each cycle's start and end are dragged independently. Touching cycles touch because the user placed them touching, not because of a special pair-mode. No seam, no modifier, no two-step click.

Open question reduces to **collision behavior** when end[A] is dragged into B's range:

1. **Block** — clamp at `start[B] - 1`. Can't overlap. User must explicitly move B.
2. **Push** — shove B's nearest edge by the overlap amount; B shrinks.
3. **Domino** — shift both of B's edges; B keeps its length, slides forward.

Lean: **block** as default. Predictable, never mutates an untouched cycle, cheapest to ship. Push/domino can land later as opt-in if blocking feels stuck.

**Decision (Rafa): block.**
- Drag clamps at `start[B] - 1` (or `end[B] + 1` on the other side).
- Visual feedback: the dragged edge stops, neighbor highlights briefly to signal "this is what's stopping you".
- No automatic neighbor-mutation. To make room, user drags neighbor first.

This collapses the whole "adjacency policy" decision tree into a single rule: **non-overlapping intervals, edges drag freely, collisions clamp**. The concern that triggered this idea ("two cycles side by side without a buffer need to adapt") becomes a non-issue — they were placed touching, they stay touching unless the user drags them apart.
