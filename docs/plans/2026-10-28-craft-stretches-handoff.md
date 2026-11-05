# Handoff: craft stretches, /phase, workspace-ranked band (2026-10-28)

Start a fresh session in `~/Developer/equanimitech/zenborg` and read this first.

## Where things stand

| What | Where | State |
|---|---|---|
| `/phase` pane: area tree, emojis, `/phase [day] [phase]`, Haiku preview-then-apply, `open_phase_pane` tool used by sunrise/sunset | branch `feat/phase-pane` (cf62c82, ed826fb), worktree `.claude/worktrees/agent-a54f11a9e68f3770c` | **merged as #262**; round 1 tried live and liked, round 2 not tried live |
| Band ranks plant taps by workspace area (from `areas.json` `surfaces.paths`, else name match), then `craft`-tagged areas | branch `fix/band-ranks-by-workspace` (2399520), worktree `.claude/worktrees/agent-a17d09d6cc33718db` | **merged as #263**, not tried live |
| Pitch: phase whispers (thirst + phase fit + season intention + where you are) | `docs/pitches/2026-10-28-phase-whispers.md` | draft, depends on `/phase` merging |
| Pitch: **craft is long stretches, repos and kinds are tags** | `docs/pitches/2026-10-28-craft-stretches-tagged-not-split.md` | draft, **next to build** |

Garden changes already applied via MCP: `secretariat` archived, `torchbearer` set to PRUNING (3/wk kept).

## Open questions for the gardener

- Is a tool-initiated pane "unasked" (only seats on 144+ columns)? Unverified live.
- Do pane hotkeys fire while typing in the Haiku input? Unverified live.
- Gitignore `plugin/tsconfig.json` (the engine writes it, pointing at a gitignored types folder)?
- Plugin tool `open_phase_pane` shows as `mcp__zenborg__…`, sharing the MCP server's prefix.

## Next: build the stretches pitch

1. **Migrate habits over MCP, each change confirmed by the gardener first.** Rename Themia `build` (52d30e7f) to the stretch habit. Add stretch habits to equanimi.tech (08bad0bd) and r4tb (c2b2ea2e). Archive `shape`, `strategy`, `zenborg`, `oliba`, `attently`, `vakigne`. Keep `admin`, `support`, `demo`, `office`.
2. **Verify before coding:** a rename keeps `habitId` and health; moment-name fallback (repo tag as the moment's name?).
3. **Sunset proposals** (#237): idle-capped spans (`get_day_trace`, 15 min), wall-clock union per area, merge gaps < 30 min, propose stretches > 45 min with a repo tag from the folder, nothing written before Enter.

## Evidence used

`get_attention` agent surface, 2026-10-14 to 2026-10-28: Themia about 2,750 visits, equanimi.tech about 640. Session minutes are inflated by sessions left open overnight, so read spans, not durations. Before the changes, `build` read wilting (8 days) and `zenborg` read 33 days since last, despite near-daily sessions.
