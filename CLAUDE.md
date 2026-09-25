# zenborg — the garden

> Orientation and working agreements. [`docs/principles.md`](docs/principles.md) outranks
> this file and wins on conflict. Anything here that contradicts the code is a bug in
> here — the code is the truth.

## What zenborg is

**Zenborg is the product.** The app, the MCP server, the Claude Code plugin, the garden
metaphor — one repo, one name.

A macOS desktop app (Tauri 2) wrapping a Next.js static export, plus an MCP server that
exposes the same vault to any agent. Local-first, no accounts, no server.

Not a task manager, not a habit tracker, not a calendar. The question it exists to ask is
*"Where will I place my consciousness today?"*

## Domain

Pure TypeScript in `src/domain/`. Entities carry behaviour; there are no classes in the
persistence path.

| | |
|---|---|
| **Area** | a plot of your life. The one shared kernel concept — see below |
| **Habit** | a perennial: a recurring moment template, lives in an area. You **plant** a habit |
| **Moment** | a tending: a named intention, 1–3 words, allocated to a (day, phase). You **tend** a moment; each one waters a habit |
| **Cycle** | a season: a time container with an intention |
| **CyclePlan** | a plot's budget for the season — one per (cycleId, habitId) |
| **Phase** | time-of-day band — MORNING / AFTERNOON / EVENING / NIGHT |
| **Attitude** | relationship mode — BEGINNING → RETURNING → KEEPING → BUILDING → PUSHING → BEING |
| **Rhythm / Health** | declared cadence, and the wilting signal derived from it |
| **Footprints** | activity: where the gardener actually walked, recorded per surface in the activity log |
| **Spring** | an outside system: `draw` pulls records into footprints, `send` pushes content out |
| **Fence** | a boundary, enforced through surfaces and through springs' `send` |
| **DayNote, MetricLog, HistoryEntry, Meta** | supporting records |

The model's spine is intention versus action: **moments** (what you meant to tend) against
**footprints** (where you walked). Vocabulary decided and stamped in
[`docs/decisions/2026-09-25-garden-vocabulary.md`](docs/decisions/2026-09-25-garden-vocabulary.md).
"Oracle", "integration" and "pond" are retired words; the code still carries the first two
until the migration lands (see Springs below).

`Attitude` lives on **habits**, not areas — 80 of 126 habits carry one, 0 of 20 areas do.
Anything reasoning about friction reads habits or the moment that references one.

## The vault

Garden state is a filesystem vault at `~/.zenborg` (release) or `~/.zenborg-dev` (debug builds).

One JSON file per collection, each a **JSON object keyed by entity UUID** (not an array):
`areas.json`, `habits.json`, `cycles.json`, `cyclePlans.json`, `moments.json`,
`phaseConfigs.json`, `metricLogs.json`, `dayNotes.json`.

Plus one **singleton** file that is not a collection: `activeMoment.json`, a
`{ momentId, at }` pointer naming the moment that IS the current intention. It is
deliberately outside `DomainModelRegistry`, export/import and the synced stores — it has
its own shape and its own module (`src/infrastructure/vault/active-moment.ts`). Adding
another singleton is a design decision; the parity test in
`src/infrastructure/vault/__tests__/collections-sync.test.ts` makes you declare it.

The debug/release split matters — running a dev build against a locally installed release
app must not trash the real vault.

### Rules you inherit

- **One writer per collection.** Zenborg is the writer for all eight above, and for
  `activeMoment`. The plugin reads `areas`, `dayNotes` and `activeMoment` live. Readers
  never mutate — not even to add a missing record.
- **`id` is a UUID.** Stable, opaque, never regenerated. The filename is the id, never a
  slug of the name.
- **Time is UTC, ISO-8601, milliseconds.** Local time is computed at render, never stored.
- **Order is explicit.** Anything whose display order matters carries an integer `order`.
- **Fail soft.** A missing or malformed collection means *empty*, never an error.
- **Preserve unknown fields on write**, or an older build silently deletes a newer one's data.

### Two implementations, pay twice

`src-tauri/src/vault/fs.rs` (the app) and `mcp-server/vault.ts` (the MCP server) each read
and write the vault independently. **Any change to the vault's structured shape costs two
implementations.** Weigh that before adding a format — it is the reason the sidecar
convention below carries no structured state.

Root resolution: `vault_root()` in `fs.rs`, mirrored in `resolveVault()` in `vault.ts`.
They must stay in lockstep; they have drifted before.

### Springs (outside systems)

**Target** (decided 2026-09-25, not yet built): one `springs.json` holds a record per
spring: how to reach it (commands), what it records (`records({from,to})` with a privacy
tier), and where it belongs (area, habit). Drawing springs write into the activity log as
their own surface; the MCP server reads footprints locally and never calls a spring live.
One reader, `get_footprints`, replaces `get_attention` and `get_day_trace`. `/new-spring`
replaces `/oracle-wizard`.

**Today** the concept is split across two files, documented below as they stand:
`oracles.json` (how to reach a system) and `integrations.json` (source → area/habit
bindings, `src/domain/integration/IntegrationBinding.ts`, read only by the Garmin report
script). Garmin already follows the target shape: a scheduled job writes
`log/*.garmin.jsonl` and `get_body` reads it.

`oracles.json` in the vault root declares the external systems the garden talks to.
It lives at `~/.zenborg/oracles.json` regardless of debug/release — oracles are about
the gardener's tools, not the garden's data.

```json
{
  "oracles": {
    "garmin": {},
    "hey": {
      "journal": {
        "check": "which hey",
        "read": "hey journal read --markdown --quiet",
        "write": "hey journal write -c \"$CONTENT\""
      }
    },
    "linear": {},
    "penceive": {
      "journal": {
        "check": "which ~/Developer/equanimitech/penceive/bin/journal-append",
        "write": "printf '$CONTENT' | ~/Developer/equanimitech/penceive/bin/journal-append"
      }
    }
  },
  "routes": {
    "journal": ["hey", "penceive"]
  }
}
```

- **`oracles`** — which external systems are available. An oracle being listed means the
  gardener uses it. MCP oracles stay `{}` (their tools self-describe). CLI oracles carry
  per-capability protocol objects with `check`, `read` (optional), and `write` commands.
  `$CONTENT` in commands is a placeholder for the actual payload.
- **`routes`** — preference chains for capabilities with >1 provider. Skills try each oracle
  in order, skipping any that's unreachable at runtime. Missing route = skill's own default.

Known oracles: `garmin` (body, workouts), `hey` (journal, email), `linear` (tasks),
`penceive` (journal), `slack` (messaging), `things` (tasks).

Skills read this file but never write it. The gardener edits it directly — or via the
`/oracle-wizard` skill, which walks through creating a new integration. A missing file
means "try everything, probe at runtime" — the pre-oracle behaviour.

## Area sidecar folders

Unstructured, area-scoped content lives beside the JSON, never inside it:

```
$ZENBORG_HOME/areas/<slug>/
├── AGENTS.md      # area-scoped agent context
├── docs/          # whatever belongs to this plot
└── skills/        # area-scoped skills
```

- `<slug>` is the area name kebab-cased — `equanimi.tech` → `equanimi-tech`. Renaming an
  area means renaming the folder; at ~20 areas that is rare enough not to warrant an
  id-keyed indirection.
- Create a folder when there is a file to put in it. Do not scaffold one per area.
- `areas.json` stays the index and the source of truth for structured fields (name, color,
  emoji, order). **The sidecar never carries structured state** — no `AREA.md`, no
  frontmatter, no slug↔id map, no parser. That is the whole point: zero code in either
  vault implementation.
- Habits get `areas/<slug>/habits/<slug>/` the day a habit actually has a doc.

**Considered and rejected:** making `AREA.md` frontmatter the source of truth. It reads
fine and is git-friendly, but it turns one atomic JSON write into an N-file operation and
obliges both vault implementations to grow a YAML parser and a rename-is-a-move path. Read
performance was never the constraint — 20 areas and 126 habits parse in single-digit
milliseconds. The write path is the cost.

## Layout

Dependencies flow inward: domain ← application ← infrastructure ← UI.

`src/domain/registry.ts` is the type-level registry of persisted collections. Add a collection
there and TypeScript forces the export/import path and the stores to follow. It is the one file to
touch when the vault grows a file.

### Two runtimes, one shape

`infrastructure/state/persistence.ts` picks a mode at boot via `isTauri()`. **Tauri** → vault-synced:
the vault is truth, IndexedDB is a hot cache, writes debounce 2s through
`infrastructure/vault/adapter.ts` and a Rust watcher feeds external edits back. **Web** → IndexedDB
only, same layout, no vault. The web path is still live; don't assume Tauri.

UI preferences (`activeCycleId`, `lastUsedAreaId`, TRMNL settings) always go to localStorage — they
are per-device, not per-vault. `ui-store.ts` holds ephemeral form state and is deliberately not
persisted; `store.ts` holds domain collections as `Record<uuid, Entity>`.

## Commands

pnpm only — never npm or yarn. Running `pnpm dev` and building to verify a change is fine.

The husky pre-commit hook runs `pnpm test`, so a red suite blocks commits. `mcp-server/` is its own
package: `pnpm start` (tsx), `pnpm build` (tsc), `pnpm build:compile` (bun binary), `pnpm smoke`.

`pnpm test:e2e` runs Playwright against the **web** build (IndexedDB, no vault, so it never touches
a real garden). It boots `pnpm dev` itself and seeds a synthetic garden through the app's own
Settings import path, so the fixture goes through real validation. Browsers install once with
`npx playwright install chromium`. It is deliberately outside the pre-commit hook: it covers what
unit tests cannot see, which is what a card does with the space it has.

`pnpm test:e2e:tauri` runs Playwright against the **real Tauri webview** via a socket bridge
(`tauri-plugin-playwright`). Requires the app running with `pnpm tauri dev --features e2e-testing`.
Tests live in `e2e/*.tauri.spec.ts` and import from `e2e/support/tauri.ts`. Use for anything that
touches Tauri IPC, native window behaviour, or vault interaction. The plugin is feature-gated and
compiles out of release builds.

## Design

Canonical system: [`../DESIGN.md`](../DESIGN.md) (org-wide). It wins on conflict.
`DESIGN_SYSTEM.md` in this repo is partly superseded and retained as history.

- **Stone tones only, unless attributed to an area.** Area `color` is the one sanctioned
  channel for colour in the whole system. Test: if something on screen is coloured, a
  viewer must be able to name which area it belongs to. "Red because destructive" fails.
- **Phases are structural, not coloured** — position, label, glyph, tonal stone step.
- **Flat at rest.** No shadow, gradient, blur, or glassmorphism. One exception, the One
  Lift: `-2px` translate on hover for genuinely draggable elements.
- **Square by default**, 4px radius ceiling.
- **No modals.** Inline editing.
- **Mobile is landscape-only.** Portrait is not considered.

## Red lines

Full treatment in [`docs/principles.md`](docs/principles.md). Never build: completion
checkboxes or "done" states, streaks, progress bars against targets, push notifications or
badges, algorithmic curation, leaderboards or comparative scoring, engagement-based revenue.

Permitted and easily confused with the above: counting allocations ("3rd time" is
information, not a score), neutral history ("2 days ago"), passive surfaces the user visits,
ambient chips on cards.

## Known drift — verify before trusting a doc

- **`README.md`** still describes the retired Next-on-Vercel era — a web app with a Compass
  and a three-day timeline. Do not build from it.
- **The `docs/protection/` tree** documents shields and a rule engine whose intervention
  layer was retired 2026-06-12. Dead.
- **`docs/ideas/2026-05-31-*`** are capture stubs pointing at Things, not designs.
