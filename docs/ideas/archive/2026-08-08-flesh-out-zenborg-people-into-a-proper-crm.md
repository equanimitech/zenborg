---
$signature:
  $type: tech.equanimi.secretariat.signature
  signer: did:key:z6MkpcX3mHt44yNEDPDWJic8ocJdagzERxx5u2Qh1dWcVRVN
  signerRole: agent
  docHash: sha256:8ef037125189dd255efdbff91968cde8c679ab834ee832bd74022a9018a77b79
  signedAt: 2026-08-08T09:43:36.084282Z
  signature: ed25519:ivvvvFFU7xeXeTtNgTgZDyjvoHwS9dsin2aDlOeOZ1h7G184O6ECtWnv39UTUGqQQXbynldvhfZgh9umkHcDCg==
type: idea
---
# Flesh out zenborg people into a proper CRM

Migration on 2026-08-07 marked 43 people, but that's only who was already a habit. The roster is thin in two ways:

- 31 of the 43 carry no rhythm, so they're "unstated" and never enter the outreach queue at all. The queue currently returns 12 people.
- Plenty of real people aren't in the garden at all — the 43 are whoever happened to have been created as a habit over time, not a deliberate roster.

Wants it to work like a proper CRM: everyone who matters is in there, each with a declared contact rhythm.

Notes from the build:

- People are Habit records with `kind: "person"`, living in Family / Friends / Sensitive.
- Place is already just tags (paris, sp, bcn, london, nyc, madrid) — no new concept needed.
- `rhythm` is what opts someone into the queue. No rhythm = deliberately silent.
- Ranking is by ratio to each person's own rhythm, so a quarterly aunt at 159d correctly sits below a twice-weekly parent at 81d.
- Cal and Dee were split off from fused pairs and start with no history; Cal inherited Ada's weekly rhythm, Dee has none — both may want adjusting.
- `list_people_to_reach` only becomes available to Claude once `feat/people` merges and the desktop app is rebuilt.

Related: `docs/2026-08-07-corrigendum-people-in-zenborg-as-built.md` (what was built), `docs/ideas/2026-08-03-a-nomad-relationship-manager.md` (the original idea).

---
Dispatched from Things inbox by /triage on 2026-08-08.
