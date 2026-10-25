---
tag: pitch
appetite: medium
status: draft
source: "Session 2026-10-24: 'do we have a way to analyze and see efficacy of interventions? in the tabs?'"
hard_dependency: decision_point events in the browser log (shipped 6829d0f, live from extension build 2026-10-24T14:27Z)
---

# Pitch -- Fences in the season readback

**Bet:** Harvest's season readback gains a read-only "Fences" section: per browser rule, what attention did after a shown cue versus a skipped one, and per fenced site, minutes a day against the season before.

**Why it matters:** efficacy exists only behind Claude (`get_rule_efficacy`, `get_site_minutes`) and a one-line `/season` echo. The gardener who closes a season in the app never sees which fences earned their friction, so none get faded or dropped on evidence.

---

## Boundaries

**JBTD:** As the gardener, when I read a season back in Harvest, I want to see what each fence did to where my attention went next, so that I keep, fade or drop it on evidence rather than on feel. Baseline today: the app has no fence screen at all ([#216](https://github.com/equanimitech/zenborg/issues/216)); efficacy is a question I have to ask an agent.

**Out:**
- Writes of any kind. Clear, pause and set stay with #216; this section only reads.
- Scores, percentages, bars against a target, rankings between rules, and any sentence about "you" (`docs/principles.md:126`, `:138`, `:142`).
- Fade proposals. They belong to outcome-loop slice 5 (`docs/pitches/2026-09-30-the-outcome-loop.md`).
- Session (Claude Code) fences. Their decision points aren't logged yet.
- A new log format or any change to what the extension writes.

## Elements

- **Two read-only Tauri commands** (`src-tauri/src/vault/mod.rs:51`, `fs.rs:47`). `vault_read_fences` returns `fences.json` raw. `vault_read_log { surface, from, to }` returns that surface's `log/<day>.<surface>.jsonl` lines for the date range. Both fail soft to empty. `fences` stays out of `ALLOWED_COLLECTIONS`, so the app never becomes a second writer.
- **A pure view model** (`src/infrastructure/state/harvestFencesViewModel.ts`, new). `(season, previousSeason, fences, events) → rows`. Per rule it calls `ruleEfficacy` (`src/domain/intervention/browserEfficacy.ts:253`) over the season's dates and reuses its `line` wording, so Harvest, `/season` and `get_rule_efficacy` say the same sentence. Per fenced host it calls `siteMinutes` (`src/domain/attention/siteMinutes.ts:45`) for this season and the one before: mean per tracked day, missing days excluded.
- **`SeasonFences` section** in `SeasonReadback` (`src/components/harvest/SeasonReadback.tsx:30`), after the record. One row per rule with points in the season:
  - the rule's name, its hosts, and paused or standing;
  - the line, e.g. "youtube-ladder: −3 min on youtube.com in 10 min after a cue";
  - `14 shown · 6 skipped · 5 days`.
  Below it, one row per fenced site: this season's minutes a day beside last season's. Two numbers, no bar. Stone tones, flat, inline (design rules in `CLAUDE.md`). The web build has no log, so the section doesn't render.
- **Behavioral lens.** The section leans on BCT 2.2 *feedback on behaviour* and 2.7 *feedback on outcomes of behaviour*, scoped to the rule, never the person. PDP *self-monitoring* without *praise* or *rewards*: the readback mirrors and does not direct (principle 3). An arm too small to compare says so in words, so a thin difference never reads as a verdict.

## Risks

**Rabbit holes:**
- *Log volume.* A season of browser logs is 10–30 MB, and `bouts()` needs focus and idle events, not only decision points. Read only the season's days, parse once and memoise per season; don't filter in Rust.
- *Seasons of different length.* Compare means per tracked day, never totals. `siteMinutes` already excludes missing days.
- *Small n.* Early seasons hold a handful of points. Below 5 per arm, show the counts and "too few to compare yet" instead of a difference.

**Off-sides:**
- Clear or pause from this row. Point to #216 instead; this pitch only reads.
- A daily ebb-and-flow chart of site minutes: worth it, but a second visual element (memory: chart variation, never score).

**Fat cut:**
- Rung and trigger splits. They stay in `get_rule_efficacy`'s full mode.
- Overlap counts and settled/unsettled detail. These are analyst concerns, not readback.

**Domain knowledge:**
- Verify the withheld arm exists in the real log after the extension reload before building. `get_rule_efficacy` over 2026-10-24 → +3 days must return n > 0 for both arms on at least one rule.
- The previous season is the cycle ending just before this one (`CycleService`), not the calendar month before.

## Acceptance

1. In the Tauri app, Harvest for a season with `decision_point` events shows one row per browser rule that had points, with the line, `n shown · n skipped · n days`, and paused or standing.
2. A rule whose withheld arm is empty reads "nothing withheld yet, so no comparison". With fewer than 5 points in an arm, it reads "too few to compare yet" and still shows the counts.
3. For a fixture log, the view model's per-rule lines and per-site means equal `get_rule_efficacy` and `get_site_minutes` over the same range (one test, one source of truth).
4. Per fenced site: this season's and the previous season's minutes a day appear side by side, as numbers only.
5. The web build renders Harvest with no Fences section and no console error.
6. The section contains no "you", "score" or "%", and no colour outside stone. `vault_read_fences` and `vault_read_log` are read-only, and `cargo test` covers a date-range read with a missing day.

---

_Drafted by Claude (scribe)._
