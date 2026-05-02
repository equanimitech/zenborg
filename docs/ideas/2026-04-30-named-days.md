# Named days

Raw capture — 2026-04-30.

- We should be able to give names for days.
- Adjacent angles:
  - Days are nodes in the timeline; today they're just a date string. A name turns a day into a chapter beat ("travel day", "deep work", "rest").
  - Could surface inline on the day-row label in the Timeline, in the heatmap bracket area when zoomed, in the harvest recap.
  - Cycles already get names + intentions. This is the same idea one zoom level down.
- Questions:
  - Schema: `Day` entity with `{ date, name, intention? }`, or just a `dayName` field on something existing? Days aren't currently entities — they're derived from dates that have moments allocated.
  - Optional: leave most days unnamed; name only the ones that warrant it. Don't surface empty labels.
  - Should the name auto-suggest from dominant area / first moment / cycle name?
  - Edit affordance: where does the user name a day — in the Timeline (top of the day-row), via command palette (`:name today travel day`), or both?
- Don't shape yet.

---

## Follow-up — 2026-05-02

Design answers (Rafa):
- Surface: **Timeline day header only** (not heatmap, at least initially).
- Edit: **click the day header → inline input**.
- Length: **1-3 words**, same constraint as moments.

### Penceive parallel — `Entry`

Penceive's domain (`src-tauri/src/domain/entry.rs`):
- `Entry { date: EntryDate, content, tags, preview, has_pdf }`
- One markdown file per day, keyed by ISO date — same shape as our hypothetical `DayNote`/`DayEntry`.
- Has frontmatter (tags), preview (first 3 non-empty lines), and PDF attachment slot.

Parallel angles:
- Both Zenborg and Penceive treat **the day as a first-class addressable thing** keyed by ISO date — but neither currently has a real `Day` entity in the domain (Penceive has `Entry`, Zenborg has dates derived from moments).
- A Zenborg "day title" and a Penceive "entry frontmatter title" want to be the same thing. Naming a day in Zenborg ≈ writing a one-line journal stub in Penceive.
- Could mean: `Entry.title` (frontmatter `title:` field) becomes the canonical store for both. Zenborg renders it on the Timeline header; Penceive renders it as the entry heading.
- Cross-app affordance later: click Zenborg day header → opens/creates Penceive entry for that date.
- Penceive's `EntryPreview` (first 3 non-empty lines) is also adjacent to Zenborg's "harvest recap" — same data shape, different framing.

### Open questions for round-table
- Should Zenborg own a local `DayNote` entity now (clean DDD, no external deps), with optional Penceive bridge later? Or design the schema upfront to mirror Penceive's `Entry` so cross-pollination is cheap?
- If we mirror: store as markdown frontmatter `{ title, intention?, mood? }` + free-form body, OR keep Zenborg's flat-record style and converge later via shared schema?
- Both apps are local-first, file-system-friendly. Could a shared "day vault" emerge — one folder of `YYYY-MM-DD.md` files, both apps read/write?
