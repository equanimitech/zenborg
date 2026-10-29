# The board suggests: your rhythm, your season

**Appetite:** small (a day) · **Status:** approved 2026-10-29 · **Source:** [suggestions-baseline](../../.claude/attently/suggestions-baseline.md)

**The bet:** the `/phase` board becomes two rows of habits to plant in one keypress: your recent rhythm for the shown phase, and season intentions gone quiet.

**Why it matters:** the drawing board was emptied on 2026-10-29, and plain frequency beat every declared signal (rhythm due, budget, cwd area) in the backtest.

## Boundaries

**Job:** when I open `/phase` on a half-planted phase, I want to see what I usually plant there and which season intention has gone quiet, so I can plant one in a keypress. **Today:** I type it to Haiku or run `/tend`.

**Out:**
- Auto-placing. Only a keypress plants (principle 9).
- PRUNING habits in either row: mirroring a tapered habit undoes the declaration.
- Scores, "overdue", streaks. Neutral history only: "last planted 9 days ago".
- Blending the two rows.
- New vault state.

**Flag gate:** no. Opt-in by opening `/phase`.

## Elements

1. **Rhythm row.** Pure `rhythmRow(v, view, today)` in new `plugin/hooks/suggest.ts`: unarchived, non-PRUNING habits planted in `view.phase` over the 56 days before today, 21-day half-life, `view.day`'s weekday ×4, minus habits already in the shown (day, phase). Top 3. `plugin/hooks/board.ts:106`

2. **Season row.** On pane open, Haiku maps each `areaIntentions` text of the running cycle to that area's non-PRUNING habit ids. Parse strictly against the vault (like `parseProposal`); cache in an atom keyed by cycle id. Pure `quietIntentions(v, today, matches)`: **quiet** when days since any matched habit was planted exceed their median gap between planting days over 56 days (floor 1). Offer the most-planted matched habit: `🎸 guitar · last planted 9 days ago`. No match, no row; Haiku down, fall back to the area's most-planted habit. Top 2, quietest first. `src/domain/entities/Cycle.ts:39`, `board.ts:276`

3. **Pane rows.** `── board ──` holds `your rhythm` then `your season`; drawing-board moments stop rendering. Suggestions join the cursor walk: `i` plants into the shown phase (`add` op, `add_moment`), `z` hides it for the waking day. `plugin/hooks/phase-pane.tsx:216`, `board.ts:178`

4. **Vault read + check.** `loadVault` reads `cycles.json`; `Habit` gains `attitude`. Synthetic-vault tests cover both rankers. A local script backtests `rhythmRow` on the real vault, printing aggregates only. `plugin/hooks/vault-io.ts:17`

**Behavioural lens:** a cue (BCT 7.1) where the decision happens, plus self-monitoring (2.2) as neutral history. No reward, no system-set goals.

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

`i` → `add_moment {habitId, day, phase}` → row leaves, moment appears above. `z` → hidden until the waking day turns.

## Risks

🐇 **Rabbit holes**
- Parsing cadence from intention text ("every day"). The habits' own pattern is the threshold.
- Letting Haiku rank or phrase. It only maps text to ids.

🏴 **Off-sides**
- A moment sent "back to the board" leaves `/phase`'s sight; the app still shows it.
- Tuning weights past the backtested model.

🥩 **Fat cut**
- Season-scoped "not now": it needs a vault write in two implementations.

🧪 **Domain knowledge**
- "Gap" is taken (`GapDetector`, `GapForecast`: time holes). Call it "quiet".
- `ThirstService` measures "due" against **declared** rhythm (2% top-3). Quiet uses **observed** intervals.

## Acceptance

1. `/phase` with history shows up to 3 rhythm and 2 season rows, never a PRUNING habit.
2. `i` plants into the shown (day, phase); nothing plants without a keypress.
3. `z` hides a suggestion for the rest of the waking day.
4. The 60 s redraw makes no model call; Haiku runs at most once per cycle per session; a failed call still yields fallback rows.
5. Tomorrow morning shows morning rhythm for tomorrow's weekday.
6. The local backtest of `rhythmRow` reports top-3 precision ≥ 15% and recall ≥ 22%.
7. `node --test plugin/hooks/*.test.mjs` and `claude plugin test plugin` pass.

## Ask (not explored)

- Lag features (planted yesterday, days since).
- The moment band's taps calling `rhythmRow`.
- Logging "not now" presses as a signal.
