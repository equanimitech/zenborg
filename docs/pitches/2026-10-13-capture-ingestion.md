---
tag: pitch
appetite: medium
status: draft
source: "gardener, 2026-10-13: 'Shape them [daemon job draining capture inboxes + a loose-seeds strip on the board]. Make sure we ingest each inbox and we can trace them appropriately.' Revised same day: voice memos ingested directly; strip named 'drawing board'."
supersedes: []
related: ["docs/2026-10-05-zenborg-jobs-run-in-the-daemon.md", "docs/decisions/2026-09-25-garden-vocabulary.md", "docs/pitches/2026-10-09-the-week-reads-back.md"]
issues: ["#59", "#201", "#237"]
---

# Pitch -- Capture ingestion: a traced drain onto the drawing board

**Bet:** A daemon job reads every capture inbox once, turns what it can name into tentative no-day moments, and writes one ledger line per item. The drawing board finally shows them.

**Why it matters:** Captures pile up in Things, voice memos and `captures/`. No-day moments are invisible. One drain plus one strip turns "where did that go?" into one `grep`, all on the machine.

---

## Boundaries

**JBTD:** As the gardener, when I capture something away from the board, I want it waiting on the drawing board with no day, so that I can tend it or set it aside on purpose. Baseline today: `unallocatedMoments$` has no UI consumer (`src/infrastructure/state/store.ts:189`). `CycleDeck` shows plan moments only (`store.ts:564`). A standalone moment with no day appears only in CommandPalette search.

**Inboxes, confirmed:**

| Inbox | State today | v1 |
|---|---|---|
| Things inbox | `/idea`, `/pain` and `/question` write here (since 2026-08-24). Nothing drains it | **Drained** |
| Voice memos | `murmur sync` (daemon job) writes 58 transcripts to `~/Documents/murmur/*.md`. None reviewed | **Drained** |
| `~/.zenborg/captures/*.jsonl` | 16 lines, no writer since 2026-08-23, no reader | **Drained** once |
| MCP `add_moment` with no day | Already in `moments.json`, invisible | **Made visible** |
| HEY email, Supernote, browser extension | Mail, journal and dwell, not captures | Out |

**Out:**
- Placing anything on a day or phase. Ingested moments land with `day: null` and `phase: null`, as `tentative`.
- Badges, counts or "N unprocessed". When there is nothing on it, the drawing board doesn't render.
- `claude -p "/tend …"` in the job: content leaves the machine, launchd auth, per-item cost, non-deterministic writes.
- kev in v1: training run, MLX server lifecycle, unknown accuracy over ~126 habits. Phase 2, same router port.
- Changing any source. The Things DB opens read-only. Murmur's files are read, never written, `reviewed:` included.
- Changing the vault shape. No new Moment field.
- Copying source text into the vault. The ledger keeps titles, never transcript bodies.

## Elements

- **`zenborg-mcp ingest` subcommand** (`mcp-server/index.ts`, `mcp-server/moments.ts:89`). It ships in the binary already inside `zenborg.app` and goes through `resolveAddMoment` + `writeCollection`, the same path MCP writes take today. A `jobs.json` interval entry (900s) runs it. `--dry-run` prints decisions and writes nothing.

- **Sources: pure readers yielding `{source, sourceId, title, text?, ref?, reviewed?}`.**
  - **Things:** `/usr/bin/sqlite3 -readonly -json` on the Things DB. It returns open to-dos with `start = 0`. The daemon's Full Disk Access covers it, so there's no AppleScript prompt.
  - **Voice memos:** `*.md` in murmur's out dir (default `~/Documents/murmur`, `--murmur-dir` overrides). `sourceId` is the frontmatter `id`, the Voice Memos UUID, the same `^id:` key murmur uses for its own dedupe. `title` is JSON-decoded. `ref` is `file://` to the transcript. murmur writes `.tmp` then renames, so reading only `*.md` never sees a partial file.
  - **captures:** reads the jsonl and keeps `kind`.

- **Router port: `route(item, garden) → seed | left-at-source | skip`. v1 is `match@1`, deterministic.**
  - Gates come first. `idea`/`pain`/`question` → `left-at-source`. `selftest*` → `skip`. A memo carrying `reviewed:` → `skip`, because its actions already went to Things.
  - Then an exact, case-insensitive match, after trimming trailing punctuation, against habit `name` and `aliases` (`mcp-server/search.ts:84`). It checks the Things title. For a memo it checks the memo title, or the **whole** transcript text. It never searches for a substring, the first line or a sentence: a 322-word median memo would plant junk.
  - A match becomes a `seed` named after the habit, verbatim, so names stay 1–3 words.

- **Ledger as trace and cursor: `log/<date>.ingest.jsonl`.**
  - One line per item: `{at, source, sourceId, title, outcome, momentId?, router, reason?}`.
  - At startup the job loads every `*.ingest.jsonl` into a set keyed by `source:sourceId`. That makes re-runs idempotent, and a moment set aside is never re-ingested. No cursor file.
  - An unparseable item gets no line, so the next run retries it.
  - Seeds carry `refs` (`things:///show?id=…` or `file://…/murmur/….md`) and `status: "tentative"`, both existing fields (`src/domain/entities/Moment.ts:46,79`).
  - Tracing goes both ways: moment → source through the ref, source → moment through `momentId` in the ledger.

- **The drawing board on cultivate** (`src/app/cultivate/page.tsx:100`, `src/components/DnDProvider.tsx`).
  - Shows `unallocatedMoments$` filtered to `cyclePlanId === null`.
  - Stone tones and area colour only, flat, one row, no count. A source glyph (Things / voice / none) opens the ref.
  - Drag to a cell to **tend** it: allocate + `acceptMoment` (`Moment.ts:623`). The existing delete is **set aside**.
  - **Lever:** the PDP *Reduction* on capture → garden. BCT 1.4 *Action planning* stays human: placing is the implementation intention. `countsAsAllocation` ignores tentative moments until they are tended, so habit health never reads false watering. Visible: yes.

## Risks

**Rabbit holes:**
- The Things DB schema is undocumented (`TMTask`: `type`, `status`, `trashed`, `start`). Keep it to one query and one fixture test. On error, treat the source as empty and record the reason.
- Write races with the app's 2s debounce: same as MCP writes today; the Rust watcher reconciles. No locking.
- Opening `file://` refs from the Tauri webview may hit the opener's scope. Check before building the glyph. If it fails, the glyph stays a label.

**Off-sides:**
- Extracting intentions from inside a long transcript. That needs a local model (kev), never the cloud.
- Standalone moments for short titles that match no habit, which means guessing an area.
- Completing the Things item on tend (#59). An MCP `get_ingest` reader.

**Fat cut:**
- A cursor file like `garmin.cursor`. The ledger already answers "seen?".
- A provenance field on Moment. `refs` + `status` + the ledger cover it without paying twice.

**Domain knowledge:**
- v1 yield is low by design: most items are ideas or long memos and stay at source. The bet is pipe, trace and visibility; `left-at-source` lines plus tend/set-aside choices become kev's eval set.
- Whisper turns silence into "Thank you."; whole-text equality ignores it unless a habit bears that name.
- `Moment.ts:36` and `mcp-server/vault.ts:264` say "only calendar ingestion writes tentative". Update both.
- The ledger sits in `log/` but it is not a footprint. Footprint readers read only named surfaces (`mcp-server/activity-log.ts:25`), and `get_footprints` must keep it that way.

## Acceptance

1. A second `ingest` run on the same vault writes 0 moments and 0 ledger lines.
2. A Things item or a voice memo whose title (or whole transcript) equals a habit name in any casing → one moment with `day`/`phase` null, `habitId` set, `tentative`, and a ref. Plus one `seeded` line with `momentId` and `router: "match@1"`.
3. Every other Things inbox item, all 58 transcripts and all 16 `captures/` lines → exactly one `left-at-source` or `skip` line each, with a reason. Things' DB and murmur's files have unchanged mtimes.
4. No transcript body appears in the ledger or the vault.
5. `grep <sourceId> log/*.ingest.jsonl` returns the `momentId`, and that moment's ref resolves to the source.
6. Cultivate shows the drawing board with every no-day, no-plan moment, including one made by MCP `add_moment` with `name` + `areaId` only. Nothing there → no strip. No number appears.
7. Dragging a moment onto a cell sets `accepted`, and only then does health count it. Set aside deletes it, and the next run doesn't recreate it.
8. The jobs doc gains the `ingest` entry, and the CLAUDE.md vault section names the ledger.

---

_Drafted by Claude (scribe)._
