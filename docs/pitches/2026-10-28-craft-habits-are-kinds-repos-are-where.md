---
tag: pitch
appetite: medium
status: draft
source: conversation 2026-10-28, "why break it down by repo in equanimitech and in Themia by 'build / data', is this really how I work?"
slice_id: A
---

# Pitch: Craft habits are kinds of attention, repos are where they happen

**Bet:** In the three craft areas, a habit names a *kind* of work (build, shape, write), and a repo becomes a variant of it with a declared path. Sunset then proposes "you built zenborg for 3h, plant it?" from footprints. Today the gardener has to remember and plant it by hand.

**Why it matters:** The garden says ⚖️ build is wilting, 8 days dry, yet the agent footprints show Themia sessions nearly every day for two weeks. Habits that footprints can't reach will always read false, and a false reading teaches the gardener to stop looking.

```
today      equanimi.tech: zenborg · oliba · attently · vakigne · secretariat…  (repos)
           Themia:        build · shape · strategy · admin · support…          (kinds)
           footprints:    one cwd per session → area only → waters nothing

bet        build ─┬─ zenborg   (~/Developer/equanimitech/zenborg)
                  ├─ oliba     (~/Developer/equanimitech/oliba)
                  └─ attently  (…)
           shape · write · admin                 (kinds the folder can't tell apart)
           footprints: cwd → variant by path → sunset proposes, gardener plants
```

---

## Boundaries

**JBTD:** When I close the day, I want the garden to already know which projects I built in, so that tending it costs one confirmation instead of a recall exercise, and build stops reading as wilting while I work daily. Baseline today: 14 habits across Themia and equanimi.tech mix two axes (repos versus activities). Footprints map a session only to an area via `surfaces.paths` on `areas.json`. Nothing waters a habit unless I plant a moment by hand.

**Out:**
- Auto-planting. Footprints *propose*; the gardener plants (Principle 9). No moment is ever written without a key press.
- Guessing the kind from tool calls or file paths (`docs/pitches/` → shape). A folder gives *where*; the kind stays declared, and build is the default.
- Non-craft areas. Body, Social and the rest keep their current habits.
- The wider garden graph (#75).

## Elements

- **Variants carry a path.** A repo habit becomes a child of `build` through `parentHabitId` (`src/domain/entities/Habit.ts:50`, decision `2026-08-30-variants-are-child-habits-not-a-new-type.md`). It gains `surfaces.paths`, the same shape areas already use, so the band's `areaOfCwd` (branch `fix/band-ranks-by-workspace`) extends to `habitOfCwd`, deepest prefix wins. That costs two vault implementations (`fs.rs` and `mcp-server/vault.ts`), so the field is optional and passed through untouched.
- **One migration, by MCP, reviewed by the gardener.** Equanimi.tech gets a `build` parent; zenborg, oliba, attently and vakigne become its variants, each with its path. Themia's `build` gets a `minerva`-style variant only where a sub-repo is real. Secretariat is already archived and torchbearer is PRUNING (done 2026-10-28). Each repo's rhythm moves to the parent, and variants keep none.
- **Sunset proposes from footprints** (#237). `get_attention` sessions for the day, grouped by `habitOfCwd`, with idle-capped minutes (sessions left open overnight read 1,000+ minutes today). The sunset skill shows "≋ zenborg · 3h · plant?" per variant, and Enter plants it in the phase where most of the time fell. This is the BCT *self-monitoring of behaviour* with the recording cost removed, and *feedback on behaviour* through the habit's health, which now tells the truth.
- **Health reads the family.** A moment planted on a variant waters its parent, so `build` reflects any repo. Verify `HabitHealthService` already does this before writing code; if it does, this element is free.

## Risks

**Rabbit holes:**
- Session minutes. Raw `start`/`end` spans run overnight. Use visits or the idle-gap span derivation (`get_day_trace`, `idleGapMin: 15`), never raw duration.
- Renaming a repo moves its path. Accept it: the gardener edits one field, which is rare at about 6 repos.

**Off-sides:** Detecting shape and write from what the session did; proposals for browser and desktop surfaces; whispers (`2026-10-28-phase-whispers.md`) gaining "you were here today" from the same mapping.

**Domain knowledge:**
- Does parent health already count child moments? Check `HabitHealthService` and the `mcp-server/health.ts` mirror.
- Child habits are hidden from `activeHabits$`. Planting from the band or `/phase` must still reach variants, or the gardener can't plant "zenborg" directly.

## Acceptance

1. In equanimi.tech, `zenborg`, `oliba`, `attently` and `vakigne` are variants of `build`, each with one path; no root habit there is named after a repo.
2. On a day with zenborg sessions, `/sunset` proposes a zenborg moment with an idle-capped duration, and nothing is written until the gardener confirms.
3. Planting a variant moment changes the parent's `daysSinceLast` to 0.
4. A session in an unmapped folder (pith, bemtevi) proposes the area only, never a guessed variant.
5. `fs.rs` round-trips a habit with `surfaces.paths` unchanged (the existing unknown-field preservation test covers it, or a new one does).

---

_Drafted by Claude (scribe)._
