# The board suggests: your rhythm, your season

**Appetite:** small (a day) · **Status:** draft · **Source:** handoff 2026-10-29, [suggestions-baseline](../../.claude/attently/suggestions-baseline.md)

**The bet:** the `/phase` board gains two rows of tappable habits, one mirroring the gardener's recent rhythm for the shown phase, one naming season intentions gone quiet.

**Why it matters:** the drawing board was emptied on 2026-10-29; the pane now has a blank where "what might belong here" used to sit, and the declared signals (rhythm due, budget, cwd area) lost the backtest to plain frequency.

## Boundaries

**Job:** when I open `/phase` on an empty or half-planted phase, I want to see what I usually plant there and which season intention I've let go quiet, so I can plant one in a keypress. **Today:** I type it to Haiku or run `/tend`.

**Out:**
- Auto-placing anything. A suggestion is a row; only a keypress plants it (principle 9).
- PRUNING habits in either row: mirroring a habit the gardener is tapering would undo that declaration.
- Scores, "overdue", streak or deficit language. Neutral history only: "last planted 9 days ago".
- Blending the two rows into one ranking.
- New vault state. "Not now" lives in a pane atom, not a collection.
- Changing the moment band's taps (see Ask).

**Flag gate:** no. A plugin pane change, opt-in by opening `/phase`.

## Elements

1. **Rhythm row.** Pure `rhythmRow(v, view, today)` in a new `plugin/hooks/suggest.ts`: unarchived, non-PRUNING habits planted in `view.phase` over the 56 days before today, 21-day half-life, same weekday as `view.day` ×4, minus habits already in the shown (day, phase). Top 3. The baseline model as-is, no lag features. `plugin/hooks/board.ts:106`

2. **Season row.** On pane open, Haiku reads each `areaIntentions` text of the running cycle with that area's non-PRUNING habits and returns the habit ids that serve it. The reply is parsed strictly against the vault (as `parseProposal` does) and cached in an atom keyed by cycle id, so the 60 s redraw never calls the model. Pure `quietIntentions(v, today, matches)`: an intention is **quiet** when days since any matched habit was planted exceed those habits' own median gap between planting days over 56 days (floor 1). Each quiet intention offers its most-planted matched habit: `🎸 guitar · last planted 9 days ago`. No match, no row. Haiku down: fall back to the area's most-planted habit. Top 2, quietest first. `src/domain/entities/Cycle.ts:39`, `board.ts:276`

3. **Pane rows.** `── board ──` now holds suggestions only: `your rhythm`, then `your season`. Drawing-board moments stop rendering, and `boardOf`'s board half goes. Suggestion rows join the cursor walk. Focused: `i` plants into the shown phase (an `add` op with `habitId`, written via `add_moment`), `z` hides it for that waking day. `plugin/hooks/phase-pane.tsx:216`, `board.ts:106`

4. **Vault read + check.** `loadVault` also reads `cycles.json`; `Habit` gains `attitude`. Tests on a synthetic vault cover both rankers. A local script runs `rhythmRow` over the real vault on the 61 day-phase backtest and prints only aggregates. `plugin/hooks/vault-io.ts:17`

**Behavioural lens:** prompts/cues (BCT 7.1) placed where the decision already happens, plus self-monitoring feedback (2.2) as neutral history. No reward, no goal-setting by the system.

## Breadboard

```
/phase ─ ☀️ Afternoon · Thu 29 Oct · now
  ☕️ coffee ●
── board ──
your rhythm
› ♟️ strategy            [i into afternoon] [z not now]
  📞 call
  🧘 sit
your season
  🎸 guitar · last planted 9 days ago
  🏋️ strength · last planted 15 days ago
```

`i` → `add_moment {habitId, day, phase}` → row leaves both lists, moment appears above. `z` → row hidden until the waking day turns.

## Risks

🐇 **Rabbit holes**
- Parsing cadence out of intention text ("every day"). Don't: the matched habits' own pattern is the threshold.
- Letting Haiku rank or phrase. It only maps text to habit ids; the threshold and label stay deterministic.

🏴 **Off-sides**
- Dropping the drawing board from the pane: a moment Haiku sends "back to the board" leaves `/phase`'s sight. The app still shows it.
- Tuning weights past the baseline. Ship the backtested model; lag features are a later bet.

🥩 **Fat cut**
- A season-scoped "not now". Needs persistence, so a vault write in two implementations.

🧪 **Domain knowledge**
- "Gap" is taken: `GapDetector` and `GapForecast` mean time holes between blocks. Name the season row "quiet", not "gap".
- `ThirstService` already computes "due", but against the **declared** rhythm, which scored 2% top-3. The season row uses the area's **observed** interval instead.

## Acceptance

1. `/phase` on a phase with history shows up to 3 rhythm habits and up to 2 season rows, never a PRUNING habit.
2. `i` on a suggestion plants it into the shown (day, phase); nothing is planted without a keypress.
3. `z` hides a suggestion for the rest of the waking day.
4. The 60 s redraw makes no model call; Haiku runs at most once per cycle per session, and a failed call still yields season rows from the fallback.
5. Browsing to tomorrow morning shows morning rhythm for tomorrow's weekday.
6. The local backtest of `rhythmRow` reports top-3 precision ≥ 15% and recall ≥ 22%.
7. `node --test plugin/hooks/*.test.mjs` and `claude plugin test plugin` pass.

## Ask (not explored)

- Lag features (planted yesterday, days since) on the rhythm row.
- The moment band's plant taps calling `rhythmRow` instead of declared phase + cwd.
- Logging "not now" presses as a signal.
