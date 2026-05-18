# Auto-allocate rhythm habits as ghost moments

> When a habit has a rhythm (and a fixed slot — e.g. therapy on Monday afternoons), pre-place ghost moments in those slots. User taps to confirm = real moment.

## The pull

Some habits are rhythmically anchored: singing Monday afternoons, therapy Monday afternoons. Manually allocating these every week is friction without insight — the slot is decided, only the showing-up matters.

## The principle tension

"Where will I place my consciousness today?" — auto-committing the moment answers the question for the user. That violates Strategic Friction.

Resolution: **propose, don't auto-commit**. Ghost moments appear in the slot. One tap commits to a real moment. Ignoring = no moment. Friction preserved, drudgery removed.

## The data gap

Current `Rhythm = { period, count }`. No day-of-week. `Habit.phase` exists (therapy=AFTERNOON, singing=AFTERNOON, samba=EVENING) but no day binding.

Extension needed: `Rhythm.slots?: { dayOfWeek: 0-6, phase: Phase }[]`. Optional, additive. A rhythm without slots still controls budget + health; only rhythms with slots feed the ghost-allocate path.

Example shape:

```ts
{
  rhythm: {
    period: "weekly",
    count: 1,
    slots: [{ dayOfWeek: 1, phase: "AFTERNOON" }]   // Monday afternoon
  }
}
```

## Phases

**A — extend rhythm domain (small).** Add `slots`. Migrate nothing (optional field). Health logic unchanged. RhythmSelector grows an optional "anchor slot" picker.

**B — ghost moments at slot times (small).** Cycle planning view derives ghost moments for `(habit, slot, day)` triples in the cycle. Render with dashed border (reuse `GhostHabitCard` aesthetic). Tap → materializes via `allocateFromPlan`. Drag → re-place. Dismiss → swipes away for that occurrence only.

**C — sunrise auto-bloom (deferred, crosses red line).** Ghost moments turn into real moments automatically at the start of their phase. Removes the act of allocation entirely. Don't build unless the friction loss proves desirable in practice.

## Health implications

Currently `latestAllocationDate` reads real moments. If ghost moments don't count toward health, that's correct — the slot is intent, not act. Confirmed-only counts.

## Adjacent

- [[2026-05-18-rhythm-ui-parity]] — selector refactor is a prerequisite; slot picker grows naturally inside the new popover.
- [[2026-05-18-wilting-lane-in-cycle-planning-review]] — wilting lane and ghost-allocation are sibling planning-context affordances.

## Appetite

Phase A + B together: small-to-medium. Defer C indefinitely.
