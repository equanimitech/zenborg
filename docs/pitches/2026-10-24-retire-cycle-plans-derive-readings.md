---
tag: pitch
appetite: medium
status: draft
source: conversation 2026-10-24 — "attitudes get stale quickly, especially with the frequency goals"; follows docs/pitches/2026-08-24-replace-cycle-plan-crud-with-running-cycle-overview.md and docs/decisions/2026-08-30-variants-are-child-habits-not-a-new-type.md
slice_id: B
hard_dependency: slice A (2026-10-24-season-intentions.md) shipped and used for one season
closes: ["#226"]
---

# Pitch — Retire cycle plans, read attitude and health from footprints

**Bet:** Delete `CyclePlan`. Health reads each habit's own usual gap, and attitude becomes a reading of the moment history. Only `BEING` and `PRUNING` stay declared.

**Why it matters:** CyclePlan has no job left. Its budget role died in August and its cultivar role died with variants. Meanwhile it keeps the stalest numbers in the garden alive. Once readings come from footprints, nothing the gardener declared can quietly stop being true.

```
declared, standing   →  goes stale     (attitude, rhythm, budget today)
declared, per season →  expires itself (slice A: season intentions)
derived from data    →  can't go stale (this slice: health, attitude)
```

---

## Boundaries

**JBTD:** When a habit's place in my life shifts, I want the garden to notice from what I actually did, so that I never have to remember to update a setting. Baseline today: 80 habits carry a declared attitude, health reads `cyclePlan.rhythmOverride ?? habit.rhythm`, and nothing flags when either stops matching reality.

**Out:**
- Deleting `cyclePlans.json` from vaults. Code stops reading it; the file stays (fail soft).
- Migrating stored attitudes. They stay in `habits.json`, unread except `BEING` and `PRUNING`.
- Person `cadence`, and `rhythm` as used by schedules and the calendar.
- Any target, count-against-goal or progress display. Red line.

## Elements

- **Health from the habit's own gap** (`src/domain/services/HabitHealthService.ts:36`, `mcp-server/health.ts:44`). Wilting becomes "silence longer than this habit's usual gap": the median gap between its last N moments, times one constant. `resolveRhythm` and the thirst budget deficit (`src/domain/services/ThirstService.ts:115`, `mcp-server/thirst.ts`) go. Written in both places, kept in step by one shared test table. BCT 2.2 (feedback on behaviour), as information, not score.

- **Attitude as a reading** (`src/domain/value-objects/Attitude.ts`). A pure `readAttitude(moments)`: BEGINNING (few moments ever), RETURNING (resumed after a gap well past usual), KEEPING (steady), BUILDING (gap shrinking). The habit form shows the reading; its selector offers only `BEING` and `PRUNING`, which are choices, not observations. `Area.attitude` (null on all 20 areas, `src/domain/entities/Area.ts:20`) and the area→habit inheritance (`Habit.ts:26`) go.

- **CyclePlan retired** (`src/domain/registry.ts`, `src-tauri/src/vault/fs.rs:52`, `mcp-server/vault.ts`). Out of the registry, stores, persistence, export/import and both vault collection lists; the parity test (`src/infrastructure/vault/__tests__/collections-sync.test.ts`) records it as gone. `Moment.cyclePlanId` is ignored on read and preserved on write, so the budgeted/spontaneous split (`Moment.ts:15`) ends.

- **Planting without the deck** (`src/components/CycleDeck.tsx`, `src/application/services/CycleService.ts:418`, `mcp-server/index.ts:2767`). The CycleDeck, `CycleDeckColumn`, `VirtualDeckCard`, `allocateFromPlan`, `allocate_from_plan` and `fromPlan` go. Planting runs through the habit path that already exists. Closes #226 by removing the budget it asks for.

## Risks

**Rabbit holes:**
- Tuning the gap factor. Pick one constant, mark it `ponytail:`, move on.
- `readAttitude` as a stored state machine. It is a pure function of the moment list; nothing persists.
- Rebuilding a deck-shaped planting surface. The habit picker already plants.

**Off-sides:**
- Removing `rhythm` from habits. Schedules still derive it; only health stops reading it.
- A health view comparing this season to the last. Separate pitch.

**Domain knowledge:**
- Habits with fewer than ~3 moments have no usual gap. Decide their health (likely "no reading") before writing the function.
- Confirm no skill other than `season` calls `fromPlan` or `allocate_from_plan`.

## Acceptance

1. Health for any habit never reads `cyclePlans.json`; a habit silent past its usual gap reports wilting in both the app and `list_wilting_habits`.
2. The app and the MCP server give the same health for the same vault (shared test table).
3. The habit form shows the derived attitude and lets the gardener set only `BEING` or `PRUNING`.
4. `CyclePlan` is gone from `registry.ts`; `allocate_from_plan` and `fromPlan` are gone from the MCP tool list; the CycleDeck is gone from the app.
5. A vault still holding `cyclePlans.json` and moments with `cyclePlanId` boots, plants and saves with no error and no data lost.
6. `pnpm test` and `pnpm smoke` pass; #226 closes with a pointer to the merge.

---

_Supersedes: 2026-10-24-season-intentions-replace-cycle-plans.md. Drafted by Claude (scribe)._
