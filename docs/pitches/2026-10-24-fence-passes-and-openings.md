---
tag: pitch
appetite: medium
status: draft
source: "Session 2026-10-24: 'what happens if friends are over in the evening and we want to watch YouTube? maybe skips monthly'"
---

# Pitch -- Passes and openings: a rationed way through a time block

**Bet:** time blocks get two bounded exits. A **pass** from the block page (4 a month, 3 hours, this site only, one line of why), and a **planned opening** declared ahead through Claude (a time-boxed window that closes by itself).

**Why it matters:** after 16:00 YouTube is blocked twice over (`afternoon-only`, `no-late-browsing`), and the block page has no exit. Friends over on a Saturday evening means hand-pausing a policy through Claude, and nothing resumes it. A boundary with no humane exception gets torn down whole.

---

## Boundaries

**JBTD:** As the gardener, when friends are over or an evening calls for a film, I want to open one blocked site for a few hours without dismantling the policy, so that the boundary survives the exception. Baseline today: the block page shows only its unlock note; the only way through is `set_fence_enabled`, which never turns itself back on.

**Out:**
- Passes on standing blocks with no schedule. Passes are for time windows; a standing block keeps its out-of-band unlock.
- Rollover, banking or buying passes. The allowance resets on the 1st, local time.
- Any score or streak around passes. "3 of 4 left this month" is information about the allowance, never progress (`docs/principles.md:126`, `:154`).
- An app UI for openings. Through Claude for now; the app comes with #216.

## Elements

- **Pass on the block page** (`extension/entrypoints/block/main.ts`). It shows "Use a pass, N of 4 left in <month>". A required one-line "what for?" comes first; the button stays disabled until the line has text. Using a pass opens **this host** for 3 hours. At 0 left: "No passes left this month. A planned opening can be set through Claude." Passes are counted from `pass_used` events in the vault log this local month (host `events_slice` merged with the outbox, `mergeById` in `modules/fence/deliveries.ts`), so the count survives a reinstall and has one source.
- **What a pass or opening lifts.** On its host until `until`: scheduled blocks (`schedule` + cooldown) and dwell/entry/click gates. Hides (transforms) stay. The background excludes the host from DNR projection (`modules/fence/project.ts`) and from gate evaluation (`friction/gate/decide.ts`). A one-shot alarm at `until` re-syncs, next to `zenborg-schedule-edge` (`entrypoints/background.ts`). The page can't write a pass; only the background does, on a validated message, as with settlements.
- **Planned opening** (`mcp-server/fences.ts`, `mcp-server/index.ts`). `set_opening { hosts[], from, until, reason }` writes an `opening` record to `fences.json`: `{ id: "opening:<from>:<host-slug>", kind: "opening", hosts, from, until, reason }`. `parseFences` reads it as a time-boxed lift with the same effect as a pass, and expired openings are ignored. It doesn't draw on the allowance. `clear_fence` removes one early.
- **Allowance as data.** A `pass-allowance` record in `fences.json`: `{ perMonth: 4, hours: 3 }`. The extension falls back to these values when the record is absent. `set_pass_allowance` on the MCP side changes it.
- **Events.** `pass_used { domain, reason, until }`, and `opening_active { hosts, until, reason }` written once when an opening takes effect. Both are allowlisted in the writer and carry domains only. The behavioural lens is BCT 1.4 *action planning* (openings declared ahead) and 15.4 *self-talk* via the "what for?" line. The pass is a commitment device with a priced exception: scarcity keeps it a choice, not a reflex.

## Risks

**Rabbit holes:**
- *DNR timing.* The block is a declarative rule, so lifting means re-projecting without the host, then restoring it at `until`. Reuse `syncFenceRules` and one alarm; don't add a second rule-id space.
- *Overlap.* A pass used while an opening is active should not burn. If the host is already open, the block page never shows.

**Off-sides:**
- "Share a pass with a friend", or passes per site. One allowance across sites keeps it legible.

**Domain knowledge:**
- `reach: "navigation"` blocks only page loads, so after `until` a tab left open keeps playing. That's acceptable, matching how a game is spared.

## Acceptance

1. At 17:00, youtube.com shows the block page with "Use a pass, 4 of 4 left in October". The button is disabled until "what for?" has text. Using it opens youtube.com for 3h and leaves chess.com blocked.
2. During the pass, no YouTube gate fires and no `decision_point` is written for youtube rules. Hides stay applied.
3. At `until`, the block returns without a reload of the extension (alarm-driven).
4. The 5th pass in a month is refused with the 0-left message. On the 1st of the next month the count is back to 4.
5. `set_opening { hosts:["youtube.com"], from: 20:00, until: 01:00 }` opens YouTube for exactly that window and doesn't change the pass count.
6. `pass_used` and `opening_active` events land in `~/.zenborg/log/*.browser.jsonl` with domain and reason only.
7. Extension `pnpm test` + `typecheck`, root `pnpm test` and `mcp-server` build all pass, with unit tests for the pass count by month, the lift window, and opening parsing.

---

_Drafted by Claude (scribe)._
