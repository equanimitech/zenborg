# Wilting lane in cycle planning & review

> Surface the worst-wilting habits as a passive lane that appears during cycle planning and cycle review — not always-on.

## Why

After the v0.12.0 sidecar review, Rafa flagged that habit health is opaque in the planting area ("I have no clue"). Today only one signal exists: `opacity-50` on wilting emojis — five of seven health states render identically. 19 habits currently wilting; worst offender `drafting` at 75 days silent, `grow` (Themia BUILDING ×2/wk) at 52 days.

A standalone "Wilting" area is wrong primitive — areas are life domains, not filters. Always-on wilting surface risks becoming guilt-trip territory.

Cycle planning / cycle review is the natural moment: user is already reflecting on cadence vs intent. Surface there, fade elsewhere.

## Shape (sketch)

- **In `plan_cycle` / cycle planning UI**: a lane listing top 3-5 wilting habits sorted by `daysSinceLast / silenceThreshold` ratio (so monthly habits don't get drowned by weekly). Each row = name + days silent + drag handle → drop into a phase slot on a day of the cycle, or click → budget into `CyclePlan`.
- **In `get_cycle_review` / cycle review UI**: same lane, but read-only — labelled "what wilted this cycle" alongside the existing review surface. No drag, just acknowledgment.

## Principle check

- ✅ Passive surface — user visits during reflection, surface doesn't visit user.
- ✅ No completion/streak language.
- ✅ Ratio sort prevents weekly-habit dominance.
- ✅ Cap at 3-5 prevents "look at all this neglect" overwhelm.
- ⚠ Stays clear of red line "no algorithmic curation" because user is already in a curation context (planning).

## Adjacent ideas

- [[2026-05-18-tiny-days-since-last-on-wilting]] — daysSinceLast inline on wilting cards (in flight now).
- [[2026-05-18-rhythm-ui-parity]] — RhythmSelector should match PhaseSelector/AttitudeSelector pattern.
- [[2026-05-18-auto-allocate-rhythm-ghost-moments]] — ghost moments pre-placed for rhythm+slot habits.

## Appetite

Small — assumes the daysSinceLast bit ships first (gives the lane its display unit) and assumes cycle planning view already has space for a side lane.
