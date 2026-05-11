# Cycle gaps as cooldown buffers

Raw capture — 2026-04-30.

- Should we treat the gap days between cycles as cooldown buffers — explicit rest/integration time, not just unstructured negative space?
- Adjacent angles:
  - Naming candidates: cooldown, intercycle, rest, fallow buffer, integration period.
  - Today gaps render as bare cells (gap segments). They have no semantics — just "no cycle here." Giving them a name turns absence into intention.
  - Could be implicit (no schema change, the UI just labels and styles them) or explicit (a `CooldownBuffer` value object the user can name and set intention for, much like cycles get intention strings).
  - Visual treatment: muted, slow gradient, "exhale" glyph, or just heavier opacity reduction than the surrounding canvas.
- Questions:
  - Default behavior: do all between-cycle gaps automatically count as cooldown, or only ones the user explicitly marks?
  - Min length: a 1-day gap is probably noise; 3+ days starts feeling like rest. Threshold?
  - Should they participate in the heatmap selection cursor (i.e. selectable like cycles), or stay non-interactive?
  - Allocation rules: discourage / forbid moments inside cooldown days, or treat as normal allocation?
  - Harvest implications: does a recap include "you took 5 days of cooldown between Paris and the writing block"?
- Don't shape yet.
