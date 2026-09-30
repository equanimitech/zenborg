---
tag: pitch
appetite: big
status: draft
source: "conversation 2026-09-30: after fences that ask, the owner asked whether intention actually drives outcome; research digest .claude/attently/outcome-loop.md"
supersedes: ["slice C of docs/pitches/2026-09-30-fences-that-ask.md"]
decision: "docs/decisions/2026-09-30-declared-fences-run-at-0-8-so-the-garden-can-tell-whether-th.md"
related: ["docs/pitches/2026-09-30-fences-that-ask.md", "docs/pitches/2026-09-23-stepping-stones.md", "kairos/docs/decisions/2026-08-20-retire-the-baseline-gate-and-ship-derived-rules-at-a-randomi.md"]
---

# Pitch -- The outcome loop: does naming an intention make attention follow it?

**Bet:** Every fence decision point is recorded, delivered or not, with a snapshot of what was planted. A pure function reads the log after each point and asks how much of the gardener's attention followed the plan. Because the fence now runs at 0.8, comparing delivered and declined points gives each rule a **causal** effect on intention–action coupling. The garden reports it per rule and proposes fading a rule once it stops mattering.

**Why it matters:** The design was decided on 2026-08-20 (a micro-randomised trial: "every eligible decision point is recorded whether or not it delivered") and never built. Today:
- no measure has an evaluator;
- `settleProximalOutcome`, `DecisionPointOutcome` and `reportEfficacy` do not exist;
- nothing reads `fadeEligibility`;
- the fence hook keeps counts (`{crossings, declined, at}`), not per-point records, so no window can be settled;
- the DC fence shows 338 "declined" points, because every agent tool call counted as one.

The garden can say what was planted and where attention went (`get_day_trace`), but not whether planting and fencing change the second. That is the whole claim of the product.

---

## Boundaries

**JBTD:** As the gardener, when a season ends, I want to know whether my fences made my attention follow what I planted, so that I keep the ones that work, fade the ones I have internalised, and drop the ones that do nothing, without ever being scored myself.

**Baseline today:**
- `src/domain/intervention/ProximalOutcome.ts` declares four measures; none is evaluated.
- `mcp-server/attention.ts:367-470` (`get_day_trace`) computes, per planted cell, `traced` minutes (in the planted area) vs `elsewhere`, plus `unplanted`.
- `plugin/hooks/fences.mts` records tallies only; declarations are deleted at the next prompt.
- Shadow mode ran once (2026-08-20, 88 drift records) and is not scheduled.

**Out (no-gos):**
- **No person score.** Per rule only (spec; `SeasonReadback.tsx:17`; principles).
- **No automatic fade.** Proposals only; the gardener decides.
- **No new sensors.** Settle from the existing log (agent, desktop, browser) and the snapshot recorded at the decision point.
- **No per-habit attribution** beyond what the log already resolves; stepping stones is the upgrade path, not a dependency.
- **No statistics library.** A difference in means with a count per arm; the weighted estimator only if the arms prove unbalanced.

## Elements

Slices ship in order. Must-have = 1, 2, 3. Should-have = 4. Nice = 5.

1. **Record decision points** (`plugin/hooks/fences.mts`; the browser extension's `intervention_shown` path). Replaces slice C of fences-that-ask.
   - The decision point is the **first crossing per gardener prompt** (keyed by session + prompt), not every tool call.
   - One `decision_point` event per point, delivered or declined: `{ ruleId, delivered, p, draw, rung, distance?, reason?, planted: { day, phase, momentIds, areaIds, paths }, activeMomentId?, servesAreaId, windowMs, ts }`.
   - Log the declaration there before the session file is cleared.
   - `sessionFence.ts` default goes from `ALWAYS` (1) to 0.8, per the decision.

2. **On-plan share, as a pure function** (`src/domain/attention/`; extracted from `get_day_trace`).
   - `onPlanShare(spans, planted, from, to) → { onPlan, elsewhere, unplanted, share }`, built from human-kind spans only (`deriveSpans`).
   - Territory, in order: the cell's areas, else the active moment's area, else `serves`, plus the fence's own paths (so near drift inside the same plot shows up as off-plan).
   - New measure kind `planted_share` in `ProximalOutcome.ts`; `next_span_in` stays for existing rules.
   - `get_day_trace` reuses it, so the day view and the loop agree.

3. **Settle and report** (`src/application/`; one read-only MCP tool).
   - `settleProximalOutcome(point, log) → { share, settledAt }` once the window has closed.
   - `get_rule_efficacy { ruleId?, from, to }`: per rule, on-plan share in the delivered vs declined arm, the difference, n per arm, split by distance, rung, and phase.
   - `/weather` and `/season` may call it. Wording stays per rule ("the DC fence: +0.18 on-plan share, n = 41 / 11"), never "you".

4. **Probabilities and shadow mode.**
   - Set existing declared fences to 0.8, including the DC fence (currently 0, its bypass).
   - Schedule the shadow run (derived rules at 0 record points without acting) through the background agent that already runs the observer.

5. **Fade proposals.**
   - When a rule's effect is near zero *and* its declined arm stays on plan, propose lowering p, then retiring the rule. `fadeEligibility` finally gets a reader.
   - Delivered as a line in `/season`, never a nag.

## Risks

**Rabbit holes:**
- *The window.* 10 min is the DC fence's current `windowMs`. It is a guess. Keep it per rule and report the n that each window leaves.
- *Overlapping windows.* Two points ten minutes apart share time. `ponytail:` settle each point independently and note the overlap count; model it only if the estimates swing.
- *Correlated samples.* One rule, one person, many days. Report n and days, not p-values.
- *Near drift inside a plot.* The fence paths are the only sub-plot territory until stepping stones lands; a moment's `file:` refs (2026-08-20 decision) are the next.

**Off-sides:**
- The browser extension writes `intervention_shown` for delivered points only; slice 1 must add the declined arm there too, or browser rules stay unmeasured.
- The vendored `plugin/domain` copy has already drifted (`Primitive.ts`, `RuleSpec.ts`), and its drift check always skips. Adding `planted_share` touches `ProximalOutcome.ts`: fix the drift check's path first, or the two copies diverge again.

**Fat cut:** 4 and 5 can slip. 1–3 give the first honest answer.

**Domain knowledge:**
- Micro-randomised trial: at each decision point the intervention is randomised, so the delivered − declined difference in the proximal outcome estimates its causal effect at that kind of moment.
- Distance classifies; cost sets the response (decision 2026-09-30). Splitting the effect by distance tests that decision too: near-capture should show a larger effect than near-work.

## Acceptance

1. One DC-fence session with 12 agent tool calls across 3 prompts writes 3 `decision_point` events, each with a planted-cell snapshot.
2. With p = 0.8, a fixture of 100 points has ~20 declined, all logged.
3. `onPlanShare` on a fixture day matches `get_day_trace`'s traced/elsewhere minutes for the same cell.
4. `get_rule_efficacy` on a fixture log returns per-arm share, difference, and n per arm, split by distance; no field names a person.
5. The vendored drift check runs (not skips) and passes.
6. (5) A fixture rule with zero effect and an on-plan declined arm yields one fade proposal in `/season`, and nothing is changed without a yes.

---

_Drafted by Claude (scribe)._
