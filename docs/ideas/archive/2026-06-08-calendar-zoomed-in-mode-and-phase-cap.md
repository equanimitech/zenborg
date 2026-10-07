# Zenborg ↔ Calendar: zoomed-in mode + lifting the 3/phase cap

Captured 2026-06-08 (weekly review, wind-down). **Don't shape/build yet** — flagged tiny but isn't.

## The bid

Connect Zenborg to the (Google) Calendar so a **high-granularity / "zoomed-in" mode** time-blocks
the day's moments as calendar events — then experiment with whether time-blocking helps *keep*
the rhythm (a full cycle week, blocked out with buffers + allowances, is the first test).

Builds directly on the stamped **[[2026-06-03-calendar-zoom-ladder]]** + `calendar-zoom-views`
ideas — this is their concrete realization, not a new concept. Semantic-zoom / Attentive
Granularity applied to time: coarse = phase view, zoomed-in = blocked moments on the calendar.

## The coupled tweak: the 3-moment/phase cap

Zoomed-in needs **more than 3 moments per phase** — a detailed time-blocked morning can hold four
or five short blocks. So the **max-3-per-(day,phase) invariant** has to flex.

- It's an invariant in the MCP/vault logic (see TOOLS.md) — plausibly a small change.
- BUT it's load-bearing: `morning` and `cycle-planning` rely on "max 3 per phase" as an
  anti-over-planning guard. Don't just delete it — make it **granularity-dependent**: coarse mode
  keeps the 3-cap (intention), zoomed-in mode lifts it (time-blocking).

## Open

- Calendar direction: Zenborg → Calendar (push), or two-way? (mind the "never build a Zenborg↔Things
  sync" lesson — Calendar may want the same caution.)
- Is the cap removed, raised, or mode-gated?
- Does the calendar experiment live in Zenborg or as a separate relay?

Next: a focused session (NOT during a move / wind-down). Tee into the next `/cycle-planning`.
