# Garmin backing for the garden

Zenborg's wilting signal measures **logging, not living**. Habits flagged 50–96 days
dark are happening several times a week; the garden simply never hears about it.
Garmin already holds the ground truth. This closes that loop.

Two deliverables off one data source:

1. **`habit-map.example.json`** — Garmin activity type → zenborg habit, the sibling of
   keel's `~/.keel/area-map.json`.
2. **`garmin-report.mts`** — sleep-derived phase-band drift detection. Proposes; does
   not apply.

Everything is **read-only by default.** The only write path is `--apply`, and it only
ever touches `phaseConfigs.json`.

---

## Where things live, and why

| thing | path | why |
|---|---|---|
| pure logic | `src/domain/garmin/` | zenborg's own rule: `domain/` is pure TS, no framework imports. Covered by `pnpm test`, so the husky pre-commit hook protects it. |
| CLI edge | `scripts/garmin/garmin-report.mts` | I/O and formatting only. |
| the example map | `scripts/garmin/habit-map.example.json` | schema + reasoning, **no UUIDs** — habit ids are per-vault and this repo is public. |
| your actual map | `$ZENBORG_HOME/integrations/garmin/habit-map.json` | see below |

### Why the map lives in the vault, not the repo

keel's loader carries the rule verbatim — *"keel's own domain→area map stays keel's
business, and stays local."* `area-map.json` sits in `~/.keel/` because **keel is its
consumer**: keel routes keel's own observations by area.

This map's right-hand side is *habit* UUIDs, and its consumer is whatever plants
moments in the garden. Zenborg is the writer for `moments`. So by the same rule the map
is zenborg's business and stays local to the vault. Putting habit ids in `~/.keel/`
would make keel depend on zenborg's internal identifiers, which is an inward dependency
keel has no use for — it reads *areas*, never habits.

It is not a vault **collection**: nothing in `src-tauri/src/vault/fs.rs` or
`mcp-server/vault.ts` reads it, so it costs neither of the two vault implementations
anything. It is integration config, which is why it sits under `integrations/` rather
than at the vault root next to the eight collections.

> `$ZENBORG_HOME/integrations/` is a **new directory in a shared kernel namespace**.
> It wants sign-off before it is treated as convention. Until then
> the path is fully overridable — `--map <path>` or `$GARMIN_HABIT_MAP` — and nothing
> is created implicitly.

---

## Setup

```bash
mkdir -p "${ZENBORG_HOME:-$HOME/.zenborg}/integrations/garmin"
cp scripts/garmin/habit-map.example.json \
   "${ZENBORG_HOME:-$HOME/.zenborg}/integrations/garmin/habit-map.json"
# then replace every REPLACE-WITH-... with a habit id from your habits.json
```

Verify the ids resolve before trusting the map — a dangling or archived id is reported,
never written through:

```bash
node scripts/garmin/garmin-report.mts --activities acts.json
```

## Fetching the payloads

Garmin is reachable over MCP, which is an agent-facing transport rather than an HTTP API
a script can call. So the script takes payloads as **input** — deterministic, testable,
and no second credential path. Save the results of these two calls:

```
mcp__garmin__get_activities_by_date  start_date=<50 days ago> end_date=<today>  -> acts.json
mcp__garmin__get_sleep_summary       date=<each of the last 21 days>            -> sleep.json
```

`sleep.json` may be an array of night objects or an object keyed by date. Nights Garmin
has no data for come back as `{}`; keep them — they are counted as missing, not as zero.
The MCP `{ "result": "<json string>" }` envelope is unwrapped automatically.

## Running

```bash
node scripts/garmin/garmin-report.mts \
  --activities acts.json --sleep sleep.json --tz Europe/Paris
```

| flag | default | |
|---|---|---|
| `--activities <file\|->` | — | activity payload |
| `--sleep <file\|->` | — | sleep payloads |
| `--map <file>` | `$ZENBORG_HOME/integrations/garmin/habit-map.json` | |
| `--vault <dir>` | `$ZENBORG_HOME` or `~/.zenborg` | |
| `--threshold <min>` | `45` | drift threshold |
| `--min-nights <n>` | `7` | refuse to propose below this |
| `--tz <zone>` | host zone | IANA name |
| `--json` | off | machine-readable |
| `--apply` | **off** | write the proposed bands |

---

## The map: two sections

`mappings` is decided. `pending` is not — and a type in `pending` **never** resolves to
a habit, even if it also appears in `mappings`, so a half-finished edit cannot start
writing moments.

The map carries `habitName` inline next to `habitId`. `area-map.json` gets away with
bare UUIDs because keel resolves names live at render time; this one cannot afford to.
A type and its habit need not share a name (`soccer` → `footy`), so the name travels
inline and each entry can be audited by eye.

> **`yoga` has a history.** Until 2026-08-09 the watch had no meditation activity, so
> sits were logged as `yoga`. That day it gained `meditation`, and since then `yoga`
> maps to yoga. A type-level map cannot express a date: when analysing older data,
> treat pre-2026-08-09 `yoga` as a sit.

`checkMapIntegrity` cross-checks every id against `habits.json` on each run and reports
dangling ids, archived habits, and renames — so the audit name cannot rot.

---

## Phase drift: what the watch may and may not decide

Only two of the eight boundaries are sleep-determined:

```
MORNING.startHour  ↔  when you wake          (the day opens)
NIGHT.startHour    ↔  when you fall asleep   (the day closes)
```

The AFTERNOON and EVENING boundaries are lifestyle choices. Garmin has no opinion about
them, so neither does this tool. A proposal is therefore always a **rigid translation**
of all four bands by one delta: it preserves band *widths*, which encode your
preference, and moves only the anchor, which encodes your physiology.

If the two anchors move by *different* amounts, the sleep window changed length rather
than position. No single translation expresses that, so the verdict is `stretch` and
**nothing is proposed** — re-carving the day is yours to do.

### Circular medians, not plain ones

Sleep onset straddles midnight — this dataset holds both 23:53 and 05:44. A plain median
of those lands near noon and is quietly, badly wrong. `circularMedianHours` finds the
rotation of the clock under which the samples are least dispersed, takes the ordinary
median in that frame, and rotates back. No hardcoded "cut the day at 18:00" anchor, so
it keeps working as the schedule shifts further.

### Rounding outward

Bands are integer hours, so both medians must be rounded, and the direction is a real
choice. Wake rounds **down**, onset rounds **up** — both outward from the waking day.
That can only ever make the waking day longer than observed, which is the harmless
direction: an empty band costs nothing, while a band that opens after you are up leaves
a moment with nowhere to go.

Against the real 11-night sample this derives `MORNING 09` and `NIGHT 03` — exactly the
two anchors chosen by hand, which is the check that the rule encodes judgement rather
than merely fitting numbers.

### The 45-minute threshold

- Bands are integer hours, so drift under 30 min **cannot be expressed at all**. A lower
  threshold would emit proposals that round to no change.
- It must sit above the sampling noise of the median. With the observed spread
  (IQR ≈ 2h, σ ≈ 1.5h) over ~11 nights, the standard error of a median is
  ≈ 1.25·σ/√n ≈ **34 min**. At 45 min, a trigger is more likely a real shift than a run
  of late nights.
- It must stay below the ~60 min quantum that actually moves a boundary, or the tool
  would only fire once the misalignment was already a full band-hour wide.

45 min is the window between those two: above the noise floor of the estimate, below the
resolution of the thing being estimated.

---

## `--apply`

Off by default, and deliberately so. Silently mutating phase boundaries would make the
garden non-reproducible — the wrong behaviour for a tool whose whole point is your
sovereignty over your own attention.

When you do pass it, three obligations from the vault contract are honoured:

- **Preserve unknown fields.** Only `startHour`, `endHour` and `updatedAt` are touched,
  or an older build silently deletes a newer one's data.
- **One writer per collection.** Zenborg owns `phaseConfigs`. If the app is running its
  2-second debounce would overwrite the edit, so the write is **refused** instead.
- **Atomic, with a backup.** `phaseConfigs.json.bak.<iso>` first, then tmp + rename.

It converges: applying a proposal and re-running yields `ALIGNED`, not an oscillation.

## Tests

```bash
pnpm test -- src/domain/garmin
```
