---
tag: pitch
appetite: medium
status: draft
source: conversation 2026-10-28, "it's about the long stretches that I do, I do a little bit of everything, we could leave both as it's just ways to tag sessions"
supersedes: [2026-10-28-craft-habits-are-kinds-repos-are-where.md]
---

# Pitch: Craft is long stretches, repos and kinds are tags on them

**Bet:** Each craft area (Themia, equanimi.tech, r4tb) keeps **one** habit, the stretch. Sunset turns each long session stretch into a proposed moment on that habit, tagged with the repo from the folder. The gardener can add a kind tag (`build`, `shape`, `write`) if they want. Repo habits and kind habits stop being habits.

**Why it matters:** The gardener works in long stretches and does a bit of everything in each one. Splitting craft into habits forces a choice the work never made. Footprints then water nothing, so ⚖️ build reads as wilting after two weeks of near-daily Themia sessions. Tags keep the detail, while the habit carries only the rhythm.

```
today   habits = repos (equanimi.tech) + kinds (Themia) → footprints water nothing
bet     habit  = ⚖️ stretch · ≃ stretch · 🧭 stretch   ← rhythm and health live here
        moment = one long stretch, tags: [zenborg] [shape]   ← where and what, both optional
        sunset: "≃ stretch · 3h · zenborg · plant?"  → Enter
```

---

## Boundaries

**JBTD:** When I close the day, I want my long stretches already sketched as moments with their repo, so that tending costs one confirmation, and the garden's craft readings match how I actually work. Baseline today: 14 habits across Themia and equanimi.tech mix repos and activities. Footprints map a session only to an area (`surfaces.paths` on `areas.json`), and nothing waters a habit unless I plant a moment by hand.

**Out:**
- Auto-planting. Sunset proposes and the gardener presses a key (Principle 9).
- Inferring the kind from what a session did. The repo tag comes from the folder; the kind tag is optional and declared.
- Non-craft areas, the person, place and graph models (#75), and habit `surfaces.paths` (the area's path plus a path segment is enough for a tag).

## Elements

- **One stretch habit per craft area.** Rename Themia's `build` to the stretch habit, which keeps its history and 6/wk rhythm. Equanimi.tech and r4tb each get one. The gardener reviews the migration over MCP: Themia's `shape` and `strategy`, and equanimi.tech's `zenborg`, `oliba`, `attently` and `vakigne`, are archived. Their moments stay as history (archive cascade, `update_habit { archived: true }`). Habits for non-agent work (`admin`, `support`, `demo`, `office`) stay as they are.
- **Repo tag from the folder.** The first path segment under the area's declared path (`~/Developer/equanimitech/zenborg` → `zenborg`) is normalised through the existing tag rules (`src/domain/entities/Moment.ts:21`). Worktrees under `.claude/worktrees/` fold into their repo.
- **Sunset proposes stretches** (#237). Group the day's agent spans (`get_day_trace`, `idleGapMin: 15`, never raw session start/end, which runs overnight) by area, then by repo tag, and merge spans less than 30 minutes apart. Each stretch over 45 minutes becomes "≃ stretch · 3h · zenborg", planted in the phase where most of it fell; a kind tag can be typed before Enter. This is the BCT *self-monitoring* with the recording cost removed. Health now tells the truth, so it works as *feedback on behaviour*.
- **Detail comes back as a reading.** `get_tag_profile` already aggregates a tag's moments, so "how much zenborg this season" becomes a query, not a habit. `/phase` and the whispers pitch show tags on moment rows.

## Risks

**Rabbit holes:**
- Stretch boundaries. The 30-minute merge and 45-minute floor are guesses, marked `ponytail:` in code and calibrated after a week of real days.
- Parallel sessions (several Themia sessions open at once) can't be added up. Use the wall-clock union of spans per area, never a sum.

**Fat cut:** Habit variants per repo (the superseded draft): a second level that tags already cover.

**Domain knowledge:**
- Does renaming `build` keep its moments' `habitId`, and so its health? It should, since ids are stable, but check `update_habit { name }`.
- Is a 3-word moment name enough? "stretch" plus tags may read as bare on the board. Consider naming the moment after the repo tag ("zenborg") while it still waters the area's stretch habit.

## Acceptance

1. Each of Themia, equanimi.tech and r4tb has exactly one stretch habit carrying a rhythm. No active craft habit is named after a repo.
2. On a day with a 3-hour zenborg stretch, `/sunset` proposes one moment on ≃ stretch tagged `zenborg`, with its duration from idle-capped spans, and writes nothing until confirmed.
3. Two overlapping Themia sessions produce one stretch, not double time.
4. `get_tag_profile zenborg` returns the confirmed moments.
5. Archived repo habits' past moments are still readable.

---

_Supersedes: 2026-10-28-craft-habits-are-kinds-repos-are-where.md. Drafted by Claude (scribe)._
