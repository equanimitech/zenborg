---
tag: pitch
appetite: small
status: draft
source: "Rafa, 2026-11-12, after the fence re-check: 'improve the ladder to leverage the breakpoints at the end of videos (or longer bouts?)'. Working notes in .claude/attently/browser-fence-efficacy.md"
supersedes: []
related:
  - 2026-10-24-fence-passes-and-openings.md
---

# Pitch -- The YouTube ladder asks between videos

**Bet:** The YouTube nudge stops interrupting a video at the 10-minute mark. It asks when the *next* video starts, and only once today's watching has passed a threshold. That is the moment that is a decision ("one more?"), not an interruption.

**Why it matters:** Three weeks of the randomised split show the dwell nudge does nothing: 10 min after a cue, the shown arm watched +1.2 min *more* than the held-back arm (n = 24 / 9, 8 days, every rung the same sign). It lands mid-video, gets clicked through, and can sit unseen behind fullscreen. The chess ladder already moved from dwell to a click on Play for the same reason (`extension/modules/friction/gate/click.ts`: "the click is the one moment that is a decision rather than an interruption").

---

## Boundaries

**JBTD:** As the gardener, when one video ends and another is about to begin, I want to be asked whether I'm still here for what I came for, so that a long evening doesn't happen one autoplay at a time. Baseline: a cue every 10 attended minutes, wherever the video happens to be.

**In:** a new gate trigger, its parse, its decision point, the youtube-ladder record moved onto it.

**No-gos:**
- chess-ladder fired once in 19 days. Its click selector likely no longer matches. That is a `fence-selector` job, not this bet.
- No change to standing blocks: they hold since 11-03.
- No new overlay design. The overlay already pauses all media while up (`overlay.ts:107`), which is what stops the autoplayed video.

## Elements

1. **Trigger variant.** `GateTrigger` (`src/domain/intervention/Primitive.ts:102`) gains `{ type: "video_start"; afterMinutes: number }`. A video starting on the host is the decision point; below `afterMinutes` of attended dwell today, nothing happens.
2. **Parse.** `extension/modules/fence/parse.ts:204` maps it onto `DwellGate` beside `click` and `entry`; `evaluateGate` refuses it on dwell, as it does a click rung (`decide.ts:236`).
3. **Page signal.** The friction content script listens for `playing` on `document` in capture phase (media events don't bubble, capture still reaches them), deduped per element like `senses/video.ts`. YouTube swaps the `<video>` per video (`video.ts:21`), so each element is one video. It asks the background; it never fires on its own.
4. **Background verdict.** `evaluateVideoStartGate`, shaped like `evaluateClickGate`: rung from today's crossings, threshold from `dwellTodayFor`, a `video_start` decision point, the 0.7 draw. `DecisionPoint.trigger` and `get_rule_efficacy`'s `byTrigger` pick it up.
5. **The record.** youtube-ladder's three rungs (intention → 15 s delay → 3 breaths) move from `dwell / 10` to `video_start / afterMinutes`. Delivery stays 0.7, so the comparison is within the new trigger and against the dwell arm's three weeks.

## Risks

- **Ads.** A pre-roll may play in its own element and count as a video start, so the gate asks before an ad. Check on the live page before wiring.
- **Shorts.** Each swipe is a new element. Past the threshold, every short asks. Either scope `/shorts` out or accept that it's the right answer for shorts.
- **One long video** (a 2-hour talk) has no next video, so nothing asks. A dwell backstop at a long beat (45 min) as a second rule covers it, if wanted.
- **Two-arm comparison is across time**, not within: dwell 10-24 → 11-11 vs video_start after. The 0.7 draw still gives a within-trigger split.

## Pitch

Small. One trigger variant, threaded through parse → page → background → efficacy, mirroring the click trigger that already exists. The fence record changes by hand in `fences.json`. Read the effect with `get_rule_efficacy` after two weeks.

**Decided 2026-11-12:**
- Threshold clock: **today's attended dwell** (`dwellTodayFor`), the dwell gate's clock. No bout state.
- `afterMinutes`: **20**, about the September median day.
- **Backstop:** a second rule, `youtube-backstop`, on `dwell / 45`, one intention rung, delivery 0.7.
- **Shorts: in.** Every swipe past the threshold asks.

**After merge, by hand in `fences.json`** (backup first): youtube-ladder rungs → `video_start / 20`; add `youtube-backstop`.
