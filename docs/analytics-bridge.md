# The analytics bridge — plan ↔ trace

**Date:** 2026-09-01
**Status:** architecture, not implementation. Grounded in the code as of `e9bf5b0` (0.32.0).
**Feeds:** GitHub #151 (derived attention). Supersedes nothing; wires what exists.

> **Lead:** the bridge is two-thirds built and zero-thirds wired. `src/domain/attention/`
> already turns the keel log into area-resolved spans (80+ tests); the only runtime caller
> is a CLI script. The smallest design that unlocks the bridge is **one log adapter, one
> pure summariser, and four read-only MCP tools** — no new vault collection, no Rust, no UI.

---

## 0. What exists (read before designing — the ground the design stands on)

### Plan side — `src/domain/`, 12 registered collections

`src/domain/registry.ts` lists `moments areas habits cycles cyclePlans phaseConfigs
metricLogs dayNotes people places relationships routines`. Adding a collection costs
**four** places, not two: the registry, `src-tauri/src/vault/fs.rs::ALLOWED_COLLECTIONS`,
`mcp-server/vault.ts::COLLECTION_NAMES`, and export/import + the sync parity test. That
is the real price of "a new JSON collection" and it drives §D.

Relevant shapes:

| entity | join-relevant fields | notes |
|---|---|---|
| `Moment` | `areaId habitId day phase startTime? durationMin? customMetric? status?` | `(day, phase)` is the cell; `startTime+durationMin` is an exact window |
| `Habit` | `areaId rhythm? schedule? attitude` | attitude lives here, not on areas |
| `MetricLog` | `momentId date value notes?` | keyed by **moment**, so a trend must hop `moment.habitId` |
| `PhaseConfig` | `phase startHour endHour` | local hours; NIGHT wraps |
| `DayNote` | `date title body?` | per-day prose — a natural home for a rendered day trace, later |

Existing read-side aggregation to mirror: `mcp-server/index.ts::get_cycle_review`
("descriptive review, no aggregate scores"), `get_tag_profile` (derived at read time),
`get_boundaries` (already accepts Garmin sleep anchors *from the caller*).

### Trace side — the log

`$KAIROS_HOME/keel/log/YYYY-MM-DD.<surface>.jsonl`, **local-date** buckets, one
`ActivityEvent` per line: `{ id, surface, kind, ts, sessionId, payload, durationMs? }`.
Substrate (`kairos/kernel/substrate.md`) lists `logs` as a stream, writer keel, reader
"zenborg (later)" — this document is that "later".

| surface | writer | kinds that matter | locator in payload | durations |
|---|---|---|---|---|
| `desktop` | `src-tauri/src/observer/` (port of keel tray) | `app_switched`, `idle_start/idle_end`, `media_playing/stopped`, `input_activity`, `writer_*` | `app_name`, `window_title` (capped 256) | **`durationMs` on `app_switched` is the span it *closes* (the previous app's dwell)**, absent after start/pause. `sessionId` always `""` |
| `agent` | `plugin/keel.mjs` hooks | `prompt session_start session_end turn_stop tool_dispatched tool_completed subagent_stop intention_switched …` | `cwd`, `tool_input.file_path` | mostly undurated |
| `browser` | keel extension via native host → `plugin/store.mjs::appendBrowserEvents` | `tab_activated focus_end idle_start idle_end video_ended …` | `domain` (domain-level, never per-path) | — |
| `garmin` | `kairos/integrations/garmin/garmin_sync.py`, run by the daemon scheduler as an interval job in `jobs.json` | `workout_completed` (ts=start, durationMs=elapsed, payload `activityType movingDurationS calories avgHrBpm maxHrBpm`), `sleep_recorded` (ts=sleep end, durationMs=asleep, payload `calendarDate sleepScore deepS remS avgHrBpm`), `body_sampled`, `body_battery_changed` | — | trusted (computed from Garmin, not observed live) |

Existing readers: `plugin/store.mjs::readEvents` (one day, agent), `readBrowserEventsSince`,
and `scripts/shadow.mts::readLog` (**agent + browser only — desktop has never been fed
through `deriveSpans`**). No typed, shared reader exists. `ActivityLogPort` in
`src/application/ports.ts` has no runtime implementation.

### The half-built bridge — `src/domain/attention/` (pure, tested, unused at runtime)

| module | gives you |
|---|---|
| `ActivityEvent.ts` | the mirror type + `actorOf(event)`: `human / agent / joint`. Garmin → `agent` (deliberately: the body is not attention) |
| `AreaMap.ts` | `{ paths: PathRule[], hosts: HostRule[] }` + `resolveArea(map, event)` — longest prefix wins, `tool_input.file_path` beats `cwd`, unresolvable → `undefined` (never a default area) |
| `Span.ts`, `SpanDerivation.ts` | `deriveSpans(events, resolve, { idleGapMs, boundaries })` — human actors only; closes on area change, silence > gap, or a planned boundary |
| `Discrepancy.ts`, `services/DiscrepancyService.ts` | drift / absence — **shadow only**, gated behind `Baseline.ts` stability. Do not surface |
| `application/use-cases/deriveDiscrepancies.ts` + `ports.ts` | `ActivityLogPort`, `GardenPort { areaMap, plantingsAt, boundaries }` |
| `scripts/shadow.mts` | the only runtime: `readLog`, `phaseAt`, `plantingsAt`, `boundariesIn`, `--init-map`. Writes `$KAIROS_HOME/area-map.json` and `discrepancy.json` |
| `src/domain/garmin/GarminHabitMap.ts` | `activityType → habitId` from `$KAIROS_HOME/integrations/garmin/habit-map.json`; `SleepNight`, `sleepToMomentFields`, `plantSleep` use case |

Two facts that shape the design:

1. **The privacy hook forbids Claude from reading `~/.kairos` raw.** Its own words:
   *"Contract is aggregates only: Claude authors the question, local code reads the rows."*
   The MCP server *is* local code reading rows. So the query surface is MCP tools returning
   aggregates, and the recap skill's `jq` recipes are the thing being retired.
2. **`mcp-server/index.ts` already imports `../src/application/use-cases/fences.ts`** and
   `plugin/hooks/*.mts` import `src/` too. Derivation written once in `src/domain` is
   shared by the MCP server, the scripts, and (later) the app. Only I/O is per-runtime.

### Drift found while reading (fix in passing, or the bridge measures noise)

- **Two `area-map.json`s with different shapes.** `plugin/store.mjs::AREA_MAP_PATH` =
  `keel/area-map.json`, a bare `Record<domain, areaId>` used for fence domain resolution.
  `scripts/shadow.mts::AREA_MAP_PATH` = `<vault>/area-map.json`, `{ paths, hosts }`. The
  bridge must read one map. §B picks the domain shape and folds the legacy one in.
- `scripts/shadow.mts` never reads the desktop surface, and `AreaMap` has no rule kind that
  could resolve a desktop event (no `cwd`, no host). "Where did my attention go today
  (desktop by area)" is unanswerable until §A.1.
- `deriveSpans` uses `reachOf = ts + durationMs`. Applied to `app_switched` that would extend
  the *new* app's span by the *previous* app's dwell. The adapter must strip it (§A.2).

---

## A. Trace domain models

Principle: **the JSONL is the source of truth; nothing here has an `id` or is persisted.**
Every type below is a derived view, computed on request, thrown away after. Mirrors
`Span` (provenance, not identity).

### A.1 `AreaMap` grows one rule kind — `src/domain/attention/AreaMap.ts`

```ts
export interface AppRule {
  /** Exact `payload.app_name` as the observer records it ("Slack", "Linear"). */
  readonly app: string;
  readonly areaId: AreaId;
}
export interface AreaMap {
  readonly paths: readonly PathRule[];
  readonly hosts: readonly HostRule[];
  readonly apps: readonly AppRule[];   // new; absent in a file ⇒ []
}
```

`resolveArea` gains a third branch: `payload.app_name` exact match. Terminals and editors
are *not* mapped — they are area-agnostic, and the agent surface already attributes them by
`cwd`. That is the honest answer to the desktop ambiguity the recap skill names
("iTerm2's hours are unattributable there and attributable here"), and it is why §C.1
reports **per surface, never one number**.

Deferred: `titleContains` rules. `ponytail: exact app match only; add title fragments when
a gardener actually asks for Ghostty→repo attribution on the desktop surface.`

### A.2 Adapter normalisation, not a model — `mcp-server/activity-log.ts`

```ts
export type Surface = ActivitySurface;                       // "agent"|"desktop"|"browser"|"garmin"
export function readActivityLog(
  root: string, window: Window, surfaces: readonly Surface[],
): readonly ActivityEvent[];                                  // sorted by ts, fail-soft per line
export function activityLog(root: string, surfaces?: readonly Surface[]): ActivityLogPort;
```

Lifted verbatim from `scripts/shadow.mts::readLog` (which then imports it — one reader).
Two normalisations, both documented in the file:

- `app_switched`: **drop `durationMs`** (it describes the span being closed, and dwell is
  derived from consecutive timestamps anyway).
- lines missing `surface` (older files) get it from the filename — already in `readLog`.

Window → files: every local date overlapping `[from, to)` plus one, then filter by `ts`.
Same as today. Local date, because the writers bucket by local date.

### A.3 Dwell and sessions — `src/domain/attention/AttentionSummary.ts` (new, pure)

The recap skill's `awk` one-liners, made a function with tests.

```ts
/** What a human event was pointed at, on its surface. `undefined` ⇒ not a locator event. */
export type LocatorOf = (event: ActivityEvent) => string | undefined;

export const locatorOf: Readonly<Record<ActivitySurface, LocatorOf>> = {
  desktop: e => e.kind === "app_switched" ? str(e.payload.app_name) : undefined,
  agent:   e => e.kind === "prompt"       ? str(e.payload.cwd)      : undefined,
  browser: e => e.kind === "tab_activated" ? str(e.payload.domain)  : undefined,
  garmin:  () => undefined,
};

export interface DwellRow {
  readonly surface: ActivitySurface;
  readonly locator: string;            // app name / cwd / domain
  readonly areaId?: AreaId;            // via resolveArea; absent ⇒ unmapped
  readonly ms: Duration;
  readonly visits: number;             // switches into it — "presence" for Slack-style micro-visits
}

export interface DwellConfig {
  /** A gap longer than this is not dwell, it is absence. Recap uses 30m desktop, 5m agent. */
  readonly capMs: Duration;
}

/** Fold consecutive human locator events into dwell. Dwell = min(next.ts − ts, capMs). */
export function dwellRows(
  events: readonly ActivityEvent[], surface: ActivitySurface,
  resolve: AreaResolver, config: DwellConfig,
): readonly DwellRow[];

export interface AreaAttention { readonly areaId: AreaId; readonly ms: Duration; readonly visits: number }
export function byArea(rows: readonly DwellRow[]): readonly AreaAttention[];   // unmapped rows excluded, reported separately

/** One Claude Code session: start to end (or last event), with the cwd it sat in. */
export interface AgentSession {
  readonly sessionId: string; readonly cwd?: string;
  readonly start: Instant; readonly end: Instant;
  readonly prompts: number;            // human turns — never tool counts
}
export function agentSessions(events: readonly ActivityEvent[]): readonly AgentSession[];

/** First/last human event per surface in the window — "zero is not missing". */
export interface Coverage { readonly surface: ActivitySurface; readonly first?: Instant; readonly last?: Instant; readonly events: number }
export function coverage(events: readonly ActivityEvent[]): readonly Coverage[];
```

Why dwell rows *and* spans: spans answer "was attention in the planted lane" and need
plan boundaries; dwell rows answer "where did it go" and need nothing from the plan.
Different questions, both cheap, both pure. Spans stay as they are.

### A.4 The body — `src/domain/garmin/BodyLog.ts` (new, pure)

```ts
export interface NightRecord   { readonly calendarDate: string; readonly asleepMs: Duration; readonly score?: number; readonly deepS?: number; readonly remS?: number; readonly avgHrBpm?: number }
export interface WorkoutRecord { readonly start: Instant; readonly elapsedMs: Duration; readonly movingS?: number; readonly activityType: string; readonly calories?: number; readonly avgHrBpm?: number; readonly habitId?: string }
export function nightsOf(events: readonly ActivityEvent[]): readonly NightRecord[];       // kind === "sleep_recorded"
export function workoutsOf(events: readonly ActivityEvent[], map?: GarminHabitMap): readonly WorkoutRecord[];  // kind === "workout_completed", habitId via resolveActivity
```

`NightRecord.calendarDate` is the morning woken — it describes the night *before* that
day's work (recap §5). The type carries the field name so the reader cannot mistake it.
`body_sampled` / `body_battery_changed` are ignored in v1.

### A.5 Metric series — `src/domain/services/MetricTrendService.ts` (new, pure)

```ts
export interface MetricPoint  { readonly date: string; readonly value: number; readonly momentId: string; readonly notes?: string }
export interface MetricSeries { readonly habitId: string; readonly metric: { name: string; unit: string }; readonly points: readonly MetricPoint[] }

/** Join logs → moments → habit. Series per distinct customMetric.name under the habit, dates ascending. */
export function metricSeries(
  habitId: string, moments: readonly Moment[], logs: readonly MetricLog[], metricName?: string,
): readonly MetricSeries[];
```

No slope, no delta-to-target, no percent. `customMetric.target` is deliberately **not**
echoed: the series is history; the target is the gardener's own declaration and lives on
the moment where he wrote it. A tool that computed "distance to target" is the progress
bar the red lines forbid.

### A.6 Not modelled

- **Discrepancy kinds** (`drift`, `absence`) — exist, stay shadow until `assessBaseline` is
  stable. §C.4 renders the same facts in neutral words.
- **Watchlist** (`config.json`/`ledger.json`/`snapshot.json`) — protection tier logic,
  not analytics. Out.
- **`input_activity`, `media_*`** — no question in §C needs them yet.
- **`AttentionSummary` as a persisted entity** — see §D.

---

## B. The bridge — join keys and what emerges

```
                    ┌──────────── plan (vault JSON) ────────────┐
                    │ Area ◄── Habit ◄── Moment(day, phase,     │
                    │   ▲          ▲        startTime?)         │
                    │   │          │           ▲                │
   area-map.json ───┘   │          │           │ phaseConfigs   │
   { paths, hosts, apps }│  habit-map.json     │ (cell ↔ clock) │
                        │  { activityType }    │                │
   ┌────────────────────┼──────────┼───────────┼────────────────┘
   │ trace (JSONL)      │          │           │
   │ agent   cwd ───────┘          │           │
   │ browser domain ────┘          │           │
   │ desktop app_name ──┘          │           │
   │ garmin  activityType ─────────┘           │
   │ every event ts ───────────────────────────┘
   └───────────────────────────────────────────
```

Three join keys, all already in the system:

| key | plan side | trace side | resolver | owner / file |
|---|---|---|---|---|
| **area** | `Area.id` | `cwd`, `file_path`, `domain`, `app_name` | `resolveArea(AreaMap, event)` | zenborg writes `$KAIROS_HOME/area-map.json` (§D) |
| **time** | `(day, phase)` cell from `phaseConfigs`; exact `[startTime, +durationMin)` when present | `event.ts` | `cellAt(instant)`, `plantingsAt(instant)`, `boundariesIn(from,to)` — lift out of `scripts/shadow.mts` into `src/domain/attention/GardenClock.ts` (pure over `moments + phaseConfigs`) | — |
| **habit** | `Habit.id` | garmin `activityType` | `resolveActivity(GarminHabitMap, activity)` | `$KAIROS_HOME/integrations/garmin/habit-map.json` (exists) |
| **metric** | `Moment.customMetric.name` + `Moment.habitId` | — (plan-only) | `metricSeries` | — |

**The one map.** `AreaMap` is the domain shape. `loadAreaMap(root)` in
`mcp-server/attention.ts` reads `<vault>/area-map.json` and, fail-soft, folds
`<vault>/keel/area-map.json` (`Record<domain, areaId>`) into `hosts` so fences and
analytics stop disagreeing about where `linear.app` lives. `ponytail: two files read, one
written; delete the fold when the plugin's fence resolver reads the domain map.`

**Day boundary.** A "day" for windows is the plugin's waking day: `DAY_START_HOUR = 4`
(`plugin/core.mjs::focusDayKey`). `[day 04:00, next 04:00)` local. Files are calendar-date
buckets, so a waking day always touches two files; the adapter already handles that.

### Derived views (none persisted)

| view | built from | answers |
|---|---|---|
| `DwellRow` → `AreaAttention` per surface | events + AreaMap | where attention went; what is unmapped |
| `AgentSession` | agent `session_start/end` | session hours by repo |
| `Span` (existing) | events + AreaMap + GardenClock boundaries | attention resolved against the plan's cuts |
| `MomentTrace` (§C.4, phase 3) | allocated moments × spans in their cell | which planted moments left a trace |
| `NightRecord`, `WorkoutRecord` | garmin events + GarminHabitMap | the body beside the day |
| `MetricSeries` | metricLogs × moments | one metric over time |

No `DayProfile` aggregate object: `get_day_trace` returns the four views for one day
side by side and stops. Composing them into a judgment is the skill's job (recap §7) and
the gardener's, never the tool's.

---

## C. Query surface — MCP tools, read-only, aggregates only

All via `defineTool`, `annotations: { readOnlyHint: true }`, `concise` by default.
Minutes in output (not ms), rounded. Names resolved (`areaName` beside `areaId`) so a
skill never needs a second call. Every response carries `coverage` so an empty surface
reads as *unrecorded*, not *idle*. Never returned: window titles, URLs, prompts, file
paths beyond the `cwd` the gardener already knows.

Shared input:

```ts
const WindowSchema = z.object({
  day:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),   // one waking day (04:00 roll)
  from: z.string().regex(...).optional(),                     // inclusive waking days
  to:   z.string().regex(...).optional(),
}).describe('Omit for today. "from"/"to" are inclusive waking days (04:00 roll).');
```

### C.1 `get_attention` — *"Where did my attention go?"*, *"How much on project X this week?"*

```ts
schema: {
  window: WindowSchema,
  surfaces: z.array(z.enum(["desktop","agent","browser"])).optional(),  // default all three
  pathPrefix: z.string().optional(),   // agent only: restrict cwd rows ("~/Developer/themia" — ~ expands)
  actor: z.enum(["human","agent"]).default("human"),   // agent = tool_dispatched dwell, labelled as the model's, never the person's
}
→ {
  window: { from, to },
  coverage: [{ surface, first?: "HH:MM", last?: "HH:MM", events }],
  surfaces: [{
    surface,
    byArea:   [{ areaId, areaName, minutes, visits }],
    unmapped: [{ locator, minutes, visits }],          // top 10 — what to map next
  }],
  sessions?: [{ cwd, start, end, minutes, prompts }],  // agent surface only
}
```

Deliberately absent: `share`, `total`, ranks. Per-surface rows are never summed
into one figure — "time on a project is a sum across surfaces, never one number"
(recap §7). The skill quotes a floor and a ceiling.

### C.2 `get_metric_trend` — *"Show me this metric over time"*

```ts
schema: { habitId: z.string(), metricName: z.string().optional(), since: dayString.optional() }
→ { habitId, habitName, series: [{ metric: { name, unit }, points: [{ date, value, notes? }] }] }
```

Points only. The caller sees the shape; the tool draws no line through it.

### C.3 `get_body` — *"How did I sleep? What did I do with my body?"*

```ts
schema: { window: WindowSchema }
→ {
  coverage: { first?: date, last?: date },             // history starts 2026-06-26; ~20 min sync lag
  nights:   [{ calendarDate, asleepHours, score?, deepMin?, remMin?, avgHrBpm? }],
  workouts: [{ day, start: "HH:MM", activityType, elapsedMin, movingMin?, calories?, avgHrBpm?, habitId?, habitName? }],
}
```

*"How did I sleep before/after heavy building days?"* is answered by the skill calling
`get_attention` and `get_body` for the same window and placing them side by side — the
tool never joins them. **Covariate, not tide** (recap §5): a `correlate` tool is the one
thing this design refuses to build, because the line between a short night and a slow
afternoon is the gardener's to draw or not draw.

### C.4 `get_day_trace` — *"How aligned was my day with my plan?"* (phase 3)

```ts
schema: { day: dayString.optional(), idleGapMin: z.number().int().positive().default(15) }
→ {
  day,
  coverage: [...],
  moments: [{
    momentId, name, areaId, areaName, phase, window?: { start, end },   // cell or exact clock window
    traced: [{ surface, minutes }],        // spans in this cell whose area is the moment's
    elsewhere: [{ surface, areaName, minutes }],   // spans in this cell resolving to another area
    evidence: "traced" | "untraced",       // untraced ≠ unrun — no log holds a walk or a call
  }],
  unplanted: [{ phase, areaName, surface, minutes }],   // attention observed in a cell that planted nothing
}
```

Built from `deriveSpans` + `GardenClock` — the exact machinery of `deriveDiscrepancies`,
minus the discrepancy vocabulary. `elsewhere` *is* drift and `unplanted` *is* absence, but
reported as minutes in places, not as kinds with magnitudes, until `assessBaseline` says
the series is stable. No percent aligned. No "on plan" badge.

### C.5 `get_area_map` / `map_area` — close the loop on `unmapped`

```ts
map_area: { kind: z.enum(["path","host","app"]), key: z.string(), area: z.string() /* name or id */ }
```

`get_attention` names what is unmapped; the gardener says "Slack → Themia"; `map_area`
writes the rule. Writer: the MCP server (zenborg), same atomic write as `fences.ts`. A
`remove` is `map_area` with `area: null`. `get_area_map` returns the map with area names
resolved and flags rules whose `areaId` no longer exists (mirrors `checkMapIntegrity` in
`GarminHabitMap.ts`).

### Skills

`recap` §4–5 and `weather` replace their `jq`/`awk` blocks with `get_attention`,
`get_body`, and (phase 3) `get_day_trace`. `sunset` gains one line from `get_day_trace`
(`untraced` moments → "did that happen off-screen?"). The skills keep every reading rule
they already state; the tools just make those rules code.

### App side — none in v1

The Tauri webview cannot read `keel/log/` (`vault_read_collection` is gated by
`ALLOWED_COLLECTIONS`). When a traces lane in the day view earns its place, add **one**
Rust command `vault_read_log(day, surface) → Option<String>` (raw JSONL, no parsing in
Rust) and run the same TS derivation in the app. That keeps "pay twice" at the I/O line,
never the logic.

---

## D. Storage strategy

| option | cost | verdict |
|---|---|---|
| **Compute on the fly from JSONL** | one adapter; a 7-day window is three surfaces × 7 files, parsed in tens of ms (`shadow.mts` does 90 days in one run today). Zero registry change, zero Rust, zero export/import, no second truth to drift | **do this** |
| New vault collection (`attention.json`) | registry + `fs.rs` + `vault.ts` + export/import + sync stores + parity test; and a derived file that lies the moment the log or the map changes | rejected |
| Derived cache under `keel/derived/<day>.attention.json` | cheap and honest (a past day's file is closed and immutable), but it is speculative until a window is measured slow | deferred. `ponytail: O(days × events) rescan per call; add a per-day cache when a 30-day window exceeds ~200 ms.` |

What *is* written, and by whom:

| file | shape | writer | status |
|---|---|---|---|
| `$KAIROS_HOME/area-map.json` | `AreaMap { paths, hosts, apps }` | zenborg (MCP `map_area`, `shadow.mts --init-map`) | exists; **config, not a collection** — same standing as `fences.json` and `integrations/garmin/habit-map.json`; stays out of the registry and out of export/import. Needs a line in `kairos/kernel/substrate.md` beside `fences` |
| `$KAIROS_HOME/keel/area-map.json` | `Record<domain, areaId>` | plugin | legacy; read-only fold-in until the fence resolver switches |
| `discrepancy.json` | `DiscrepancyRecord` | `shadow.mts` | untouched by this design |

The "two implementations" constraint is respected by construction: the vault's
*structured shape* does not change. The log is a stream with a writer contract already
kept by three writers (Rust, Node, Python); this design adds readers, and readers cost one
implementation because the derivation is pure TS shared through imports the MCP server
already makes.

---

## E. Migration path

Ordered by what unlocks the most for the least. Each step ships alone; each has one
runnable check.

**Phase 0 — the adapter (half a session).** `mcp-server/activity-log.ts` (§A.2), lifted
from `scripts/shadow.mts::readLog`; the script imports it. Strip `app_switched.durationMs`.
Check: `shadow.mts --dry --days 14` prints the same counts before and after. This is #151
element 1, verbatim.

**Phase 1 — where did it go (one session).** `AttentionSummary.ts` (§A.3) with fixture
tests; `AppRule` on `AreaMap` (§A.1); `mcp-server/attention.ts::loadAreaMap` with the
legacy fold; tools `get_attention`, `get_area_map`, `map_area` (§C.1, §C.5); recap §4
switches to the tool. Check: `get_attention { day }` on a real day agrees with the recap
skill's `awk` to the minute for the desktop surface.

**Phase 2 — the body and the metric (one session, independent of phase 1).**
`BodyLog.ts` (§A.4), `MetricTrendService.ts` (§A.5), tools `get_body`, `get_metric_trend`.
Trivial joins; could go first. Check: `get_body` for a known workout day returns the
session with its real shape (moving vs elapsed).

**Phase 3 — the day against the plan (one session).** Lift `phaseAt / plantingsAt /
boundariesIn` from `shadow.mts` into `src/domain/attention/GardenClock.ts` (script imports
it); `get_day_trace` (§C.4) over `deriveSpans`; `sunset` asks about `untraced` moments.
Check: for a day with a clock-timed moment, its `traced` minutes never exceed the window.

**Deferred, with the condition that un-defers each:**

- App-side traces lane → when a gardener asks to *see* a day's trace rather than be told it.
- `titleContains` app rules → when desktop attribution of a terminal is actually wanted.
- Per-day derived cache → when a 30-day `get_attention` is measured over ~200 ms.
- Surfacing `drift` / `absence` by name → when `assessBaseline` reports `stable: true`.
- Browser dwell beyond `tab_activated` (video, feeds) → when a question needs it.
- Media-credited dwell (`media_playing` while unfocused) → same.

**Never:** a `correlate` tool, an alignment percentage, a "share of attention" figure, a
weekly total across surfaces, a target-distance on a metric, any push. The bridge reports;
the gardener judges.

---

## Red-line audit

| principle | how the design keeps it |
|---|---|
| Information, never score | minutes and counts; no `%`, no `share`, no rank, no delta-to-target |
| No progress bars against targets | `customMetric.target` is not echoed by `get_metric_trend` |
| No streaks | nothing is computed across days except the series the gardener asked for |
| Absence is a question, not a verdict | `coverage` on every response; `evidence: "untraced"` never `"unrun"` |
| The body is a covariate | `get_body` and `get_attention` are separate calls; no join tool |
| Ambient, passive surfaces | every tool is `readOnlyHint`; nothing schedules, badges, or notifies |
| Sovereignty over the mapping | `resolveArea` never defaults; unmapped is shown, and the gardener maps it in a sentence |
| Privacy tier | aggregates only; the MCP is the "local code that reads the rows"; titles, URLs, prompts never leave the file |

## Files touched, by phase

```
phase 0   mcp-server/activity-log.ts                       new
          scripts/shadow.mts                               import the adapter, delete readLog
phase 1   src/domain/attention/AreaMap.ts                  + AppRule, + apps branch in resolveArea
          src/domain/attention/AttentionSummary.ts         new (dwellRows, byArea, agentSessions, coverage)
          src/domain/attention/__tests__/AttentionSummary.test.ts
          mcp-server/attention.ts                          loadAreaMap (+legacy fold), writeAreaMap, tool handlers
          mcp-server/index.ts                              get_attention, get_area_map, map_area
          plugin/skills/recap/SKILL.md, weather/SKILL.md   tools replace jq
phase 2   src/domain/garmin/BodyLog.ts                     new
          src/domain/services/MetricTrendService.ts        new
          mcp-server/index.ts                              get_body, get_metric_trend
phase 3   src/domain/attention/GardenClock.ts              lifted from shadow.mts
          mcp-server/index.ts                              get_day_trace
          plugin/skills/sunset/SKILL.md                    one line
```

Nothing under `src-tauri/`. Nothing in `registry.ts`. No new dependency.
