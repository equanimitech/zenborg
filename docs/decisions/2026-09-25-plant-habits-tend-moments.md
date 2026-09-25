---
$signatures:
- v: 0
  signer: did:key:z6MktoEs7PURX3JWXun1MbZVxdS8MA1DP1kB26MrJTYnxavp
  act: attest
  doc_hash: sha256:e3c1c8264569b3e77ea9da9c8287f4397e0b04134acb8eb2263fda65a79cdaee
  signed_at: 2026-09-25T13:20:18.933791Z
  signature: ed25519:NIGPJtH3LU3o+KUBKlBv5lXIhsSZmQM24SWFexoecNtR0L6iyTra1QpiF8VNeOiYbTQjpl4nxu3J2NDoV6CXBQ==
---
# Plant habits, tend moments; habits read as routines, routines become rituals

**Date:** 2026-09-25
**Context:** zenborg
**Supplements:** docs/decisions/2026-09-25-garden-vocabulary.md

## Decision

- **Verbs:** the gardener **plants** a habit (once, as a perennial) and **tends** a moment (each tending waters a habit).
- **Copy:** habits read as **routines** in user-facing copy. The domain keeps `Habit`.
- **Rituals:** the existing `Routine` entity (an ordered set of habits that plants itself at a phase boundary, e.g. the wake-up sequence) is renamed **Ritual**, in both domain and copy.

## Rationale

"Plant" was doing double duty: 235 uses name the act of placing a moment, which the vocabulary decision reframed as tending. Splitting the verbs gives each object one act. "Routine" is the warmer word for a recurring practice (the gardener used to call them rootines), so it goes to habits in copy; the boundary sequence was already ceremonial in use, and "ritual" names that. Keeping `Habit` in the domain avoids renaming the most-referenced entity in the code.

Rejected: keeping "habits" in copy (colder than what the gardener uses); habits and the boundary sequence both called routines (one word, two concepts).

## Consequences

- `Routine` → `Ritual`: entity, `routines.json`, `create_routine`, `materialize_routine`, and the ritual copy. The vault rename needs a fail-soft read of the old file.
- #221 (garden copy) and #213 (onboarding) rebase onto plant = habit and tend = moment before merging.
- `CLAUDE.md` domain table gains Ritual.
