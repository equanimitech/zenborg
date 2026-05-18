# Tiny: daysSinceLast on wilting deck cards (SHIPPED)

> Show `·{N}d` next to the habit name on `VirtualDeckCard` when `health === "wilting"`. Answers the "how late?" question with one extra glyph cluster.

## Done

- `useHabitHealth` extended to return `{ health, daysSinceLast }`.
- `VirtualDeckCard` renders `·{N}d` after the habit name, opacity-60, mono, when wilting.
- `MomentCard` / `GhostHabitCard` updated to new hook signature (destructure `health` only — no day indicator on placed moments or unbudgeted ghosts; deck only, per scope).
- Tests still pass.

## Why this shape

- Stays monochrome (no new color).
- Stays text (no new icon).
- No streak/score language — pure information.
- Only renders on wilting state → no clutter on healthy habits.
- Lives where attention is during planting → answers the question at the point of choice.

## What it doesn't solve

- Five of seven health states still render identically (only wilting differentiates). See follow-up below.
- No signal at all on `MomentCard` (placed moments don't need urgency) — intentional.
- No "expected vs actual" pacing — that's a bigger surface.

## Follow-ups (not in scope)

- [[2026-05-18-rhythm-ui-parity]] — refactor `RhythmSelector` to match phase/attitude two-state pattern.
- [[2026-05-18-auto-allocate-rhythm-ghost-moments]] — ghost moments for rhythm-anchored slots.
- [[2026-05-18-wilting-lane-in-cycle-planning-review]] — passive lane during planning/review.
- Differentiate seedling/budding/blooming/evergreen visually — currently all `opacity-100`. Cheap option: scale or border style per state.
