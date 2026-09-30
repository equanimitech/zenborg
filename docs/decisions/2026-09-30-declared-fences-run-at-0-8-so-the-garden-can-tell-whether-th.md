---
$signature:
  $type: tech.equanimi.secretariat.signature
  signer: did:key:z6MkpcX3mHt44yNEDPDWJic8ocJdagzERxx5u2Qh1dWcVRVN
  signerRole: agent
  docHash: sha256:17eb2e1608ab0bc2f0e8add4a32c22d5045a6bc0e9a3e6b1f01b3b57cd30b54d
  signedAt: 2026-09-30T10:34:13.997260Z
  signature: ed25519:QcvjNZiCSgDeMdV0bpoOcYz/1JZfwVpaaO65Dim+TSwRbPIS7M7RSUW2JxKywsiX9MU29R4NbVXYJ9uav3y8Cg==
type: decision
---
# Declared fences run at 0.8, so the garden can tell whether they work

**Date:** 2026-09-30
**Status:** accepted
**Context:** `zenborg`: the outcome loop (`docs/pitches/2026-09-30-the-outcome-loop.md`); fences that ask (PR #228)
**Supersedes:** the `ALWAYS = 1` rationale in `src/domain/intervention/rules/sessionFence.ts:73-78` ("a fence is asked for, not tested")
**Builds on:** kairos `2026-08-20-retire-the-baseline-gate-and-ship-derived-rules-at-a-randomi.md` and `docs/decisions/2026-09-30-regulate-drift-by-what-it-costs-attention-near-is-captured-f.md`

## Decision

1. **A fence the gardener declares ships at `deliveryProbability` 0.8, not 1.** At one decision point in five, the coin flip lets the crossing through unasked, and the log records that it did.
2. **A decision point is the first crossing per gardener prompt**, not every agent tool call. The later calls in that turn belong to the same moment of choice.
3. **The outcome is intention–action coupling, not return to an area.** For each decision point, the *on-plan share* is the part of the gardener's attention in the window after it that lands on what was planted at that moment: the cell's areas, else the active moment, else what the fence serves, plus the fence's own paths so near drift is visible.
4. **The effect of a fence is the difference in on-plan share between delivered and declined decision points**, split by declared distance, rung, and phase. Because the arm is randomised, that difference is causal, not a correlation.
5. **Reported per rule, never per person.** No score of the gardener appears anywhere.
6. **Fade is proposed, never applied.** When a fence's effect is near zero *and* the declined arm stays on plan, the garden proposes lowering its probability, then retiring it. The gardener decides.

## Rationale

**The question changed.** On 2026-08-20 a fence was "asked for, not tested": the gardener had already chosen it, so withholding it to measure it looked like withholding something asked for to learn something not asked about. The gardener is now asking that question: does naming an intention and fencing it actually raise the coupling between intention and outcome? At probability 1 there is no comparison, so the loop could only say how on-plan the gardener was, never whether the fence caused it.

**0.8, not 0.5.** A fence is still something asked for. Four in five crossings still get the question; one in five is the control. The cost of the control arm is bounded and visible (the log says the crossing went unasked), and the estimate converges more slowly than at 0.5, which is acceptable for a rule that is used daily.

**Why on-plan share, not `next_span_in`.** `next_span_in` asks a binary question at area level: did attention come back to the plot within the window. It cannot see near drift (same plot, different stream) and says nothing about *how much* of the window followed the plan. The spine of the model is `Discrepancy`, the gap between planted and observed; on-plan share is that gap read as a proportion. `get_day_trace` already computes traced vs elsewhere minutes per planted cell, so the measure extends what exists.

**Why the first crossing per prompt.** The DC fence's tally shows 338 declined points and 11 crossings, because every agent tool call was a decision point. That counts the agent's steps, not the gardener's choices, and it floods one arm with correlated samples.

**Alternative rejected: keep 1 and measure on-plan share only.** Correlation between fences and on-plan time would mostly measure *when* fences get declared (on focused days), not what they do.

**Alternative rejected: 0.5.** Halving an intervention the gardener asked for is a price the question does not need.

## Consequences

- `sessionFence.ts` changes its default from `ALWAYS` to 0.8, and its comment points here. Existing fences keep whatever probability they have; the DC fence goes from 0 (its bypass) to 0.8.
- The log gains one event per decision point, recorded whether or not it delivered: rule, delivered, probability, draw, rung, declared distance and reason, a snapshot of the planted cell, and the window. Without the snapshot the outcome cannot be settled from the log alone, which the spec requires.
- Declarations stop being deleted without a trace: they are logged at the decision point before the session file is cleared.
- Settlement is read-only and per rule. `/weather` and `/season` may show it; nothing shows a person score.
- **This is measurable, and it can be wrong.** If after a season the delivered and declined arms show no difference in on-plan share, fences do not do what they are for, and that is a finding, not a failure of the loop.
