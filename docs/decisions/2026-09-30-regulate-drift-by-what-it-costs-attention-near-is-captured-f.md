---
$signature:
  $type: tech.equanimi.secretariat.signature
  signer: did:key:z6MkpcX3mHt44yNEDPDWJic8ocJdagzERxx5u2Qh1dWcVRVN
  signerRole: agent
  docHash: sha256:d49e33a2d5359b45251801a8954fd3fadce027c11be5390c8cfde2041eedf577
  signedAt: 2026-09-30T09:57:17.723715Z
  signature: ed25519:HQt5gPWyGuQ7EBSQT1WNbq4pDWsPYDT042qlpvWvJJS966xuKzhHTOByR5CS3vLHVQ3KFm2Uw6KdFiW0rQJZBQ==
type: decision
---
# Regulate drift by what it costs attention: near is captured, far waits for a break, away splits into rest and feed

**Date:** 2026-09-30
**Status:** accepted
**Context:** `zenborg`: session fences (`plugin/hooks/fences.mts`), and the pitch `docs/pitches/2026-09-30-fences-that-ask.md`
**Builds on:** `2026-08-20-grade-drift-by-distance-from-the-intention-in-three-classes.md` (kairos) and `docs/2026-08-20-evidence-check-on-graded-drift-and-the-premise-it-does-not-s.md`

## Decision

The three classes stay as graded on 2026-08-20: **near** (same plot, different intention), **far** (different plot, same kind of activity), **away** (different kind of activity).

What changes is the **response**. It follows what each departure costs attention, not how far it went:

| Class | Response | Friction |
|---|---|---|
| **inside** | the work | none |
| **near** | **capture only.** Note it (idea, Linear, moment) and return. No work. | the question + a capture suggestion; repeated near work climbs the ladder |
| **far** | **allowed at a breakpoint** (the gardener's next message, going idle, or leaving the task for another app), never mid-task, and declared | the question; no dwell |
| **away: rest** | **never gated.** A walk, the park, meditation | none |
| **away: feed** | left to the feed's own fences (LinkedIn feed, watering hours) | the only place dwells remain |

Capture is allowed at every distance. The line is not "outside the fence", it is **substantial work** outside the fence.

The primary lever is the declaration itself (`⌗ inside`, `⌗ near: …`, `⌗ far: …`, `⌗ away: …`). Naming the departure is an act of noticing, and noticing is the strongest restoration evidence the base synthesis has.

## Rationale

**The 2026-08-20 ladder climbed with distance: the lightest charge for near, the heaviest for away. The evidence runs the other way on cost.**

- **Near costs most.** Similarity between a departure and the primary task *increases* disruption through working-memory interference, and recovery is harder (Gillie & Broadbent, the interruption-similarity effect). Task-A thinking persists into Task-B, worse under time pressure (Leroy 2009, attention residue). Themia data → Themia billing is the expensive switch, not the cheap one.
- **Far is a real switch but a cleaner one.** It competes less for working memory, and it still costs ~23 minutes to refocus after a meaningful interrupt (Mark 2008). So it goes where interrupts are cheapest: at breakpoints (Iqbal & Bailey 2008). This is also principle 1 of the base synthesis.
- **Away is two different things.** The base synthesis lists information overload and continuous partial attention as degradation, and meta-awareness/meditation as the strongest restoration. A feed is the first; a walk or a sit is closer to the second. One class cannot carry both responses.
- **Keep the friction light for this principal.** Mark 2018: blocking *increased* workload for users with high perceived work control. Someone who sets their own schedule is that case. Punitive feedback draws 6–10% adoption. The question and the capture suggestion are nudges; the dwell stays only where a feed has already shown it wins against intention.

**Distance still classifies; cost now responds.** The evidence check ruled that distance grades *commitment fit*, never *cognitive cost*, and that ruling stands for the classification. This decision adds the other half: once a departure is classified, the response is set by what it costs. The two are not in conflict. The 2026-08-20 decision never fixed a direction for the ladder; it said "the response can fit the departure". This decision fixes it.

**Alternative rejected: keep the ladder climbing with distance.** It would wave through near work, the costliest departure, and charge a walk more than a context switch inside the same repo.

**Alternative rejected: treat all away as rest.** Feeds are the documented failure mode. The LinkedIn-feed and watering-hours fences already exist because of them.

**Alternative rejected: a separate model judges the class.** The session's own model holds the whole conversation. A second model would see a truncated transcript and add seconds per turn. See the pitch.

## Consequences

- **This resolves the evidence check's open tension** (dwells firing mid-action) by generalizing its option 2: dwells live only on feeds, far waits for a breakpoint, near gets a question, not a wait.
- **The rest/feed split needs a label that does not exist yet.** Plot tags cannot draw it: `Playful` (tag `texture`) holds both the park and weed; `Entertainment` shares `texture`. Candidates are `wellness` and `inner` plots as rest, plus a habit-level mark for the rest that lives elsewhere (park, walk). That vocabulary is the principal's to set, not derived.
- **Claim discipline.** The base synthesis forbids claiming to restore lost capacity. "Rest is never gated" is a claim about *not charging* a departure, not about what the walk does for the mind. Copy must stay on that side.
- **In an agent session, the live classes are inside, near and far.** Away rarely reaches a coding hook; it lives on the browser, DNS and phone surfaces. The fence plan builds near and far first.
- **Sources outside the two reference docs are unverified here** and must be checked before any copy cites them: Albulescu et al. 2022 (micro-breaks meta-analysis), Kaplan (Attention Restoration Theory), Reinecke (media use, recovery, and guilt). The decision does not rest on them.
- **Still no measurement.** Like 2026-08-20, this rests on literature and the principal's report, not on data. Every declaration is now logged with its class and reason, so it becomes measurable. If near-capture does not reduce time-to-return compared with near-work, this decision was wrong.
