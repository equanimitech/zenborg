---
$signatures:
- v: 0
  signer: did:key:z6MktoEs7PURX3JWXun1MbZVxdS8MA1DP1kB26MrJTYnxavp
  act: attest
  doc_hash: sha256:25399e8348ca2d2158def471d04a0136ed81f42f2e95853dbc8877d771172cb8
  signed_at: 2026-09-25T13:14:18.569273Z
  signature: ed25519:IkxHSpln/SMOYrQNc3E+tI9Iq/k3zZRFSrbTU6wzRVOnpYctsrVLHqoaI7AkKB4rDzKF/96h+U7H3lJD+HDkBg==
---
# Adopt the garden vocabulary: tendings, footprints, springs, fences

**Date:** 2026-09-25
**Context:** zenborg

## Decision

Zenborg's model rests on intention versus action, named in the garden's language:

- **Moments are tendings.** Each moment waters a habit (a perennial). A habit wilts when it goes untended.
- **Footprints are activity.** The activity log records where the gardener actually walked, one surface per source (desktop, agent, browser, garmin, chess).
- **Springs are outside systems.** One record per spring replaces both `oracles.json` and `integrations.json`. It holds how to reach the system, what it records (`records({from,to})` with a privacy tier), and where it belongs (area, habit). A spring has two kinds of capability: `draw` pulls records into footprints; `send` pushes content out (journal, email, DNS).
- **Fences are boundaries.** They are enforced through surfaces and through springs' `send`.

Renames follow: `get_attention` and `get_day_trace` become one `get_footprints`; `/oracle-wizard` becomes `/new-spring`; `oracle-probe` and `OracleRouter` follow. The word "oracle" retires.

## Rationale

Oracles and integrations are two halves of one concept kept in two files under two names, and neither implements the integration contract. Two readers over one activity log drifted apart; that drift produced the `traceSurfaces` bug that blocked the v0.41.0 and v0.42.0 releases. Tendings versus footprints is the model's spine: the garden compares what was intended with what happened. Garden words keep the domain language the same in code, skills, and UI; tool descriptions carry the plain meaning so agents still route correctly.

Rejected: "oracle" (not garden, and it overlaps with "integration"); "pond" (already retired on 2026-08-21); "gate" (taken by `fence-gate`); springs plus channels (two words for one record).

## Consequences

- `get_footprints` must cover date ranges, per-area totals, and unmapped sites before the old readers go.
- Drawing springs write into the footprint log; the MCP server never calls a spring live.
- chess.com is the first new spring.
- Eventually all of this surfaces in the UI.
