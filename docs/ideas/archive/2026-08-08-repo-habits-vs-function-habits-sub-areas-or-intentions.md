---
$signature:
  $type: tech.equanimi.secretariat.signature
  signer: did:key:z6MkpcX3mHt44yNEDPDWJic8ocJdagzERxx5u2Qh1dWcVRVN
  signerRole: agent
  docHash: sha256:360d02f32947de108992bde9d36d8abce93678355edae6e855f612cc26c9b813
  signedAt: 2026-08-08T09:43:48.444793Z
  signature: ed25519:/zpwo5hWndQ6PXWC6gcIyKt/3xTDcxY8kRx4nbaR5NZ6DkE069+vh0jmSdgDeywjN9VqASuqWKH2pHtLGKWPBw==
$attestation:
  $type: tech.equanimi.secretariat.stamp
  signer: did:key:z6MkjB8PQaN1vuUzdtnJsxyXR2f8d3tckGHkUYZMDytQsfak
  act: attest
  docHash: sha256:360d02f32947de108992bde9d36d8abce93678355edae6e855f612cc26c9b813
  docFilename: 2026-08-08-repo-habits-vs-function-habits-sub-areas-or-intentions.md
  stampedAt: 2026-08-08T09:45:03.844242Z
  signature: ed25519:WXzcujlUQAjKo87XUdzJHVb4g6qS7Mr+yzOP2l4p9cP8pXRdod8YD5E9+lpnsD0sPHcYxLPsfClfqye9wavuDA==
---
# Repo-habits vs function-habits — sub-areas, or intentions?

Sidenote from cycle-planning, 2026-08-07.

The asymmetry: for equanimi.tech the habits are repos (keel, zenborg, secretariat, torchbearer, respost). For Themia they're functions (build, support, grow, admin, meeting). Same level in the model, different kind of thing.

Questions:

- Is this a case for sub-areas in Zenborg?
- Or are these really intentions (moment names) rather than habits? A moment name is already a 1–3 word intention — "jurimetria X" under `build` does what a repo-named habit does under equanimi.tech.

Downstream constraint: the goal is for keel to show the digital footprint of these. So any sub-area concept would also need to land in keel's area scoping — `~/.kairos/areas.json` (kernel-owned, written by zenborg, read by keel) and `packages/domain/areas.ts`. Not a zenborg-local change.

First-pass take (not decided): sub-areas add a level to fix one asymmetry — likely a rung too high. The habit is the recurring *kind* of session; the moment name is the specific intention. Both shapes may be legitimate as-is.

---
Dispatched from Things inbox by /triage on 2026-08-08.
