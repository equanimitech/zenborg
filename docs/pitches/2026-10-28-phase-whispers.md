---
tag: pitch
appetite: medium
status: draft
source: conversation 2026-10-28, "what is this drawing board? shouldn't we have a smarter recommendation system by now? based on intentions, timings, etc." Follows the /phase pane (branch feat/phase-pane).
hard_dependency: /phase pane merged (feat/phase-pane)
---

# Pitch: Phase whispers, three things worth planting now, each with its reason

**Bet:** One pure ranker scores habits and drawing-board moments for a given day and phase. It reads only what the gardener declared: health, the habit's phase or schedule, and this season's area intentions. The `/phase` pane and the moment band each show its top three, each with a one-line reason.

**Why it matters:** The ranking already exists, but none of the places the gardener looks use it. The band offers habits in plain `order` (`plugin/hooks/garden.ts:59`), and the drawing board is an unranked list. Each reason shown teaches the gardener their own pattern, so over time they need the whisper less (Fade-by-Design).

```
today:   habits by order ─┐
         board, unranked ─┴─▶ gardener scans and guesses
bet:     health + phase fit + season intention ─▶ 3 whispers + why ─▶ gardener picks or ignores
```

---

## Boundaries

**JBTD:** When I open a phase with room in it, I want the two or three things my own garden says need tending, with the reason for each, so I can plant one in a keystroke or knowingly let it pass. Baseline today: thirst exists in three copies (`src/domain/services/ThirstService.ts:56`, `mcp-server/thirst.ts:88`, plus the cycle proposals). Only `propose_gap` uses it, and only when I say "I have time". The band and `/phase` ignore it.

**Out:**
- Energy and body battery. Habits carry no effort tag yet, so a body battery reading has nothing to filter against. That is step 9 of `docs/ideas/2026-09-08-gap-proposals.md` (#235), its own slice.
- "Yesterday's skips." Zenborg has no completion (red line), so a skip has no meaning in the data. Day-trace spans belong to #237.
- Cycle-plan deficit as a factor. Slice B (`2026-10-24-retire-cycle-plans-derive-readings.md`) deletes `CyclePlan`, so the ranker must not lean on it.
- Auto-placing anything, defaults that must be undone, or penalising dismissed whispers (Principle 9).
- A learned or LLM ranker. The scores are plain arithmetic the gardener can read.

## Elements

- **`whispers(vault, day, phase, now)`**, pure, in `plugin/domain/attention/` next to `ActiveMoment.ts`, which the band already imports (`plugin/hooks/garden.ts:6`). It returns at most three `{ kind: habit | board, id, reason }`. Candidates are unarchived habits not already planted in that slot, plus board moments.
- **Four factors, added up.**
  1. **Thirst:** `computeThirst` without the plan bonus.
  2. **Phase fit:** the habit's `phase` matches, or its `schedule.weekdays` include the day and `startTime` falls in the phase; a mismatch scores 0 and is not filtered out.
  3. **Season intention:** a small boost when the area has an `areaIntentions` entry on the running cycle (`src/domain/entities/Cycle.ts:33`, shipped in #260).
  4. **Where you are:** the working folder's area first, then areas tagged `craft`, reusing the banner's workspace ranking (branch `fix/band-ranks-by-workspace`). The reason reads "you're in Themia".

  Board moments score on phase fit and season intention only.
- **The reason is the strongest factor, in words.** "9 days dry", "your evening sit", "season: Body, *move daily*". There are no numbers on screen beyond days-since, which the principles permit as neutral information. This is the BCT *prompts/cues* plus *self-monitoring of behaviour*. The cue explains itself, so the gardener can absorb it and stop needing it.
- **Two surfaces, same ranker.** `/phase` gets a "whispers" section above the board, and `i` plants the focused whisper. The band's taps swap `byOrder` for `whispers()`, the slot still capped at 3 (`MAX_TAPS`). Dismissing means pressing Later on the band, or simply not planting from the pane. Nothing is stored.
- **One thirst, not three.** The ranker imports the domain thirst. `mcp-server/thirst.ts` then re-exports it if the MCP build can import it, or keeps its mirror plus a parity test if it can't. `propose_gap` stays as it is.

## Risks

**Rabbit holes:**
- Weight tuning. Pick weights that put thirst first, write three fixture gardens with the order they must produce, and stop there.
- Sharing thirst across the app, the MCP server and the plugin builds. Check what the plugin's `node --experimental-transform-types` loader and the MCP bundler can import before moving any code; a parity test is the fallback.

**Off-sides:** Energy-aware whispers, calendar pre-scheduling (#235 step 10), people-due whispers (`list_people_to_reach`), and whispers in the Tauri app. Each one reuses `whispers()` later.

**Fat cut:** A "why not X?" explainer, a stored dismissal history, per-gardener weight settings.

**Domain knowledge:** Confirm the attitude multiplier still holds once slice B derives attitude from footprints. Since `whispers()` calls `computeThirst`, slice B changes the input, not the ranker.

## Acceptance

1. On a fixture garden with a habit last done 9 days ago (weekly rhythm), an evening habit, and an area with a season intention, `/phase evening` shows exactly 3 whispers in that order, each with its reason line.
2. The band's taps come from `whispers()`. A habit at the top of `order` but freshly watered no longer appears.
3. Nothing is written until the gardener presses a key. Ignoring every whisper for a week leaves the vault byte-identical.
4. No whisper's ranking reads `CyclePlan` (grep-able), and no score is shown beyond days-since.
5. Thirst has one implementation, or two with a parity test that fails when they drift.

---

_Drafted by Claude (scribe)._
