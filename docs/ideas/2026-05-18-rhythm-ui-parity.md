# Rhythm selector UI parity

> `RhythmSelector` is the outlier among the three habit-form selectors. Refactor to match the `PhaseSelector` / `AttitudeSelector` two-state pattern.

## Current shape (`src/components/RhythmSelector.tsx`)

Inline checkbox + number input + shadcn `Select` dropdown. Different paradigm from `PhaseSelector` (popover with letter hotkeys, empty chip / filled full-width button) and `AttitudeSelector` (same family).

```
[ ] rhythm                                   ← null state
[x] rhythm  [3]  ×  [per week ▾]             ← filled state, inline
```

## Target shape (matches phase/attitude)

```
[ rhythm ]                                   ← null state, chip
[ 3× per week ▾ ]                            ← filled state, full-width trigger
```

Tap the chip → opens popover with:
- count stepper (`-` 3 `+`)
- period picker with letter hotkeys: `W` weekly, `2` biweekly, `M` monthly, `Q` quarterly, `Y` annually
- `X` to clear (null)

Reuses `SelectorPopover`. Same collision boundary handling as `PhaseSelector`. Same `enableHotkeys` plumbing.

## Why

- Memory `rhythm_ui_parity.md` already captures the principle: rhythm/aliases selectors must match the two-state pattern.
- Three habit form fields → three different UI paradigms is a learning-curve tax for keyboard-first users.
- Currently no hotkeys on rhythm — can't drive habit form fully from keyboard.

## Appetite

Small. Pure UI refactor — no domain changes. ~1 file rewrite, three call sites updated.

## Adjacent

- [[2026-05-18-tiny-days-since-last-on-wilting]] — already shipped.
- [[2026-05-18-auto-allocate-rhythm-ghost-moments]] — rhythm's domain depth grows there.
