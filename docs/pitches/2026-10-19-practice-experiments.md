---
tag: pitch
appetite: big
status: draft
source: "conversation 2026-10-19: a practice-resilience probe (2026-10-18) read sits off Garmin with scripts in an area sidecar; the gardener asked for the outcome loop to cover a practice habit, not only fences"
supersedes: []
hard_dependency: "docs/pitches/2026-09-30-the-outcome-loop.md slice 1 (decision_point events) — for slices 4–5 only. Slices 1–3 stand alone."
related: ["docs/pitches/2026-09-30-the-outcome-loop.md", "docs/pitches/2026-10-09-the-week-reads-back.md", "docs/decisions/2026-09-30-declared-fences-run-at-0-8-so-the-garden-can-tell-whether-th.md", "docs/decisions/2026-09-25-garden-vocabulary.md"]
issues: ["#247", "#235", "#203"]
---

# Pitch -- Practice experiments: the outcome loop, generalised past fences

**Bet:** The gardener can run a one-person experiment on a practice habit. The plan is a stamped doc in the area sidecar. The measure is a footprint the watch logged, never a moment tended after the fact. One pure function reads sit-days, gaps and a baseline verdict per stage of the plan; a second, once decision points exist beyond fences, reads the delivered-vs-declined difference for a system offer such as the ritual pause (#247). Both report per protocol, in `/season`, with n and days.

**Why it matters:** Zenborg has the grammar of an experiment and no reader. `RuleSpec` carries `deliveryProbability`, `outcome` and `fadeEligibility` (`src/domain/intervention/RuleSpec.ts:52-59`); four measure kinds exist and none is evaluated (`ProximalOutcome.ts:14-28`); `assessBaseline` has a 21-day floor and a 14-day flat-trend rule and one caller, its test (`src/domain/attention/Baseline.ts:105`). The 2026-10-18 probe answered with six sidecar scripts that hard-code one trip's timezone. The outcome-loop pitch measures fences only; this extends it to a practice.

---

## Boundaries

**JBTD:** As the gardener, when a stage of a practice protocol ends (an anchor protocol, an environment change, a ritual pause), I want to read whether the practice held, against a baseline that was stable before I changed anything, so that I keep what worked and change the anchor rather than the effort, without ever being scored.

**Baseline today:**
- Sits are counted by a sidecar script over `log/*.garmin.jsonl`, filtered on a hard-coded tuple of activity types (`~/.zenborg/areas/<slug>/docs/scripts/gaps.py`). Its README names the limit: timezones come from a hard-coded window, "until places carry a timezone".
- `get_body` resolves workouts to habits through `integrations/garmin/habit-map.json` (`mcp-server/index.ts:4149,4160`). The file does not exist in the vault, so nothing maps.
- `workout_completed` was written twice for 25 of 204 events, `body_sampled` for ~300 of 2,712 hours, during the window when the sampling machine changed timezone. No reader dedupes.
- The local day and hour of a footprint come from the machine's current zone (`GardenClock.ts:27-38`, `mcp-server/attention.ts:38`). Every travelled day is mis-bucketed.
- `gapPracticeRule` ships at `deliveryProbability ?? 1` (`rules/gapPractice.ts:251`); only the fence hook randomises (`plugin/hooks/fences.mts:640`), and it keeps tallies, not points.

**Out (no-gos):**
- **No "you".** Every line names a protocol and a stage. No score, no streak, no run of sit-days. Gap lengths are history, read as "4+ days without, twice"; the longest *run* is never shown (`docs/principles.md`, Red Lines).
- **No tended moment as evidence.** A moment tended after the fact is intention (decision 2026-10-19). The measure reads Garmin and future sensors only.
- **No new vault collection.** Plans are prose in the sidecar; system offers are `RuleSpec`s in code. A second protocol earns the first collection, not the first.
- **No statistics library.** A difference, n per arm, and days. No p-value, no confidence interval.
- **No push.** The readout is a line in `/season` (and `/weather` when the week closes a stage). Nothing notifies.
- **No automatic fade, no automatic anchor change.** Rules in the plan are read by the gardener.
- **No input-sensor data.** `desktop.inputActivity` stays opt-in and default-off (`observer-core/src/domain.rs:137`); its lost-config episode (`19cb02e`) taints only covariates this pitch does not read.

## Elements

Slices ship in order; each is one PR. **Must = 1–3. Should = 4–5. Nice = fat cut below.**

1. **A practice measure and its reader** (`src/domain/intervention/ProximalOutcome.ts:14`; new `src/domain/practice/PracticeReadback.ts`; reuses `workoutsOf` at `src/domain/garmin/BodyLog.ts:60` and `assessBaseline` at `Baseline.ts:105`).
   - New measure kind `habit_footprint: { habitIds, cmp: "gte", value }`, resolved through `GarminHabitMap` (`GarminHabitMap.ts:145`). The validator refuses an empty `habitIds` the way it refuses empty `areaIds` (`RuleSpec.ts:117-126`).
   - `practiceReadback(events, map, habitIds, from, to, stages?)` → per stage: practice-days over days, weekday split, gap distribution (median, longest gap, count of gaps ≥ 4 days), hour-of-day histogram, and a `BaselineVerdict` from `assessBaseline` on the daily 0/1 series. `stages` are `{ name, from, to }`; absent means one stage. The word is *stage*, because *phase* is time of day in this domain.
   - Dedupe on `(ts, activityType)` before counting; latest wins, the rule `byDay` already uses (`Baseline.ts:70`).
   - One read-only MCP tool, `get_practice`, returns that object. When `get_footprints` lands (week-reads-back slice 1) this becomes a section of it, not a third reader.
   - The habit map file is written by hand in the vault, no code. `checkMapIntegrity` (`GarminHabitMap.ts:181`) reports at read, never fixes.
   - BCT lens: self-monitoring of behaviour (2.3) and feedback on behaviour (2.2). The anchor itself is the gardener's own prompt/cue (7.1) and action planning (1.4); the garden only reads it.

2. **A local day per place** (`src/domain/entities/Place.ts:6`; `mcp-server/vault.ts:305`; `mcp-server/index.ts:1317`).
   - `Place` gains optional `timezone` (IANA). `update_place` accepts it and rejects a name `Intl.DateTimeFormat` cannot resolve. No library: `formatToParts` gives hour and date.
   - `localDayOf(ts, cycles, places)` → `{ day, hour }`: the cycle running at `ts`, latest-starting wins (the rule `currentPlace` already applies, `plugin/hooks/gap-practice.mts:74-98`), its first place, its timezone, with the 04:00 roll. No cycle, no place, or no timezone → the machine's zone, as today. Fail soft.
   - Only slice 1 reads it. `get_body`, `phaseAt` and the board keep machine time; migrating them is an off-side.
   - Cost: `fs.rs` passes collections through as strings (`src-tauri/src/vault/fs.rs:115-150`), so Rust costs nothing. The second implementation is the MCP type and schema.

3. **The protocol plan, pre-registered** (new `docs/templates/practice-protocol.md`; `/decision`).
   - A template with seven sections: question; stages with dates; measures decided in advance; baseline stability rule; what will cloud it; rules decided in advance; readout dates. The sidecar scripts' structure is the working spec; the template carries none of their data.
   - The plan lives at `~/.zenborg/areas/<slug>/docs/` and is stamped through `/decision`, so the measures and the cut-offs are attested before the first stage starts. The stamp is the pre-registration. Nothing in the repo names a habit, a rhythm or a date.
   - Commitment (1.9) is the lever: the readback holds the gardener to a declared rule, not to a target.

4. **Decision points beyond fences, with a `draw`** (`plugin/hooks/gap-practice.mts`; `plugin/skills/sunrise/SKILL.md:29-33`; `plugin/skills/sunset/SKILL.md`; new MCP tool). Builds on outcome-loop slice 1.
   - The `decision_point` event defined there gains `surface: "skill" | "hook"`. The gap-practice hook writes one per gap offered or declined, at p = 0.8 (`gapPractice.ts:251` loses its `?? 1`).
   - `draw { ruleId }`: the MCP server draws `Math.random()` against the rule's `deliveryProbability`, writes the `decision_point`, returns `{ delivered, draw }`. A model cannot randomise; the server can. `declare_drift` (`mcp-server/index.ts:4014`) is the precedent for an agent-facing call the hooks later read.
   - `/sunrise` and `/sunset` call `draw` before step 1. Delivered → the 60-second sit, one "not today" (#247). Either outcome writes `pause_taken` or `pause_declined`, a record apart from watch-logged sits, per the issue.
   - The ritual pause is a `RuleSpec` in code: `scope: { surface: "session" }`, `mechanism: "friction"`, outcome `habit_footprint` within the waking day.

5. **A per-protocol efficacy readout, in `/season`** (`plugin/skills/season/SKILL.md:57`; generalises outcome-loop slice 3).
   - For an act (no decision point): the stage comparison from slice 1, weekday-matched, with the baseline verdict beside it. Read: "anchor protocol — stage B1: practice-days 18/28 (Mon–Sun 3/4 … 1/4); baseline A stable, 24 days."
   - For an offer: `get_rule_efficacy` already reports delivered vs declined. Its measure becomes any `Measure`, so `habit_footprint` reads the same way as `planted_share`: "ritual pause — footprint same day: 0.71 delivered (n = 34) vs 0.58 declined (n = 9), 43 days."
   - `/season` step 3 prints one line per protocol with a running stage; `/weather` may, on the day a stage ends. Neither interprets.

## Risks

**Rabbit holes:**
- *A binary daily series under a slope test.* `assessBaseline` tolerates drift at 10% of the window mean; on a 0/1 series the mean is the practice rate, so the rule still reads. Keep floor, window and tolerance as the parameters they already are; do not add a second criterion.
- *Timezone everywhere.* Routing `phaseAt`, `wakingDayWindow` and the board through `localDayOf` is tempting. Slice 1 only: the board is read where the gardener is; the readback, about where the gardener was.
- *Two mapping files.* `integrations.json` (`IntegrationBinding.ts`, read by `scripts/garmin/garmin-report.mts:273`) and `habit-map.json` both map Garmin to habits; neither exists in the vault. Use the map; do not merge them here.
- *Overlapping offers.* A gap breath and a ritual pause on the same morning share a window. Settle each independently and report the overlap count, as the outcome-loop pitch does.

**Off-sides:** Other sensors (a meditation app's export, a second wearable) land as another `*.jsonl` surface and resolve through the same map; not here. Moving `get_body` to the per-place day. A chart of practice-days across stages. Springs for the Garmin sync itself (week-reads-back slice 6).

**Fat cut:**
- Mapping `BehavioralMechanism` to BCT v1 numbers and adding `anchor`, `commitment`, `graded-task`. The plan names its techniques in prose; the type can follow when a second rule needs the words.
- Fade proposals. They are outcome-loop slice 5 and read the same efficacy object; nothing to add.
- A `stages` field on the rule. Stages belong to the plan, and the plan is prose.

**Domain knowledge:**
- Verify the 25 duplicate `workout_completed` events are byte-identical except for offset, not re-synced edits with new durations. If durations differ, latest wins; say so in the readback's `coverage`.
- European DST ends 2026-10-25, inside the first protocol. `Intl` handles it with an IANA name; a fixed offset would not. This is why the field is a timezone, not an offset.
- n-of-1 design: an act is an A/B stage comparison, confounded by season and travel; the weekday match and the baseline gate make it readable. An offer is a micro-randomised trial, so its difference is causal. Different words; never pooled.
- A 60-second sit may not reach the watch. If the pause is not a Garmin activity, its proximal outcome is still the next watch-logged sit that day; the pause record itself is not the measure.

## Acceptance

1. A rule with `habit_footprint` and empty `habitIds` fails `validateRuleSpec`; one with a mapped habit settles on a fixture log, and a fixture with 10 duplicated `workout_completed` events counts each once.
2. `practiceReadback` on a 60-day fixture with three stages returns practice-days, weekday split, gap distribution and `BaselineVerdict` per stage, and matches `gaps.py` on the same fixture. No field is a ratio against a target, and no field names a person.
3. A footprint at 23:30 in a place with `timezone` set lands on that place's day; the same footprint with no timezone lands on the machine's day. `update_place` rejects `"Mars/Olympus"`.
4. `docs/templates/practice-protocol.md` has the seven sections and no data. One plan exists in a sidecar and carries a stamp; the repo does not mention it.
5. (4) `draw` at p = 0.8 over a fixture of 100 calls writes 100 `decision_point` events, ~20 declined; `/sunrise` writes `pause_taken` or `pause_declined` on every run that drew delivered.
6. (5) `/season` prints one line per protocol with a running stage, per arm or per stage, with n and days. The word "you" does not appear in it.

---

_Drafted by Claude (scribe)._
