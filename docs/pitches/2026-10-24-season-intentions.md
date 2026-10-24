---
tag: pitch
appetite: small
status: draft
source: conversation 2026-10-24 — "attitudes get stale quickly, especially with the frequency goals"
slice_id: A
closes: ["#88"]
---

# Pitch — Season intentions on areas and people

**Bet:** At `/season`, the gardener writes a few words per area and per person for the season ahead. They live on the cycle, expire with it, and are read back at the season's close.

**Why it matters:** Attitudes and rhythms go stale because nothing expires them. A season intention is declared and dies with the season, so it can't drift. This slice tests whether writing them sticks before slice B (`2026-10-24-retire-cycle-plans-derive-readings.md`) removes what they replace.

---

## Boundaries

**JBTD:** When I open a season, I want to say what each plot and each person means to me *this* season, so that the review reads against my direction, not a ladder I set months ago. Baseline today: the cycle holds one `intention` string (`src/domain/entities/Cycle.ts:12`); areas and people hold nothing per season.

**Out:**
- Retiring `CyclePlan`, deriving attitude or health. That is slice B.
- An app UI for writing intentions. They are written through `/season` and the MCP server; the app only preserves them.
- Person `cadence`. It stays as is.
- Intentions on habits. The habit is the practice; direction lives on the area or the person.

## Elements

- **Two fields on `Cycle`** (`src/domain/entities/Cycle.ts:28`, `mcp-server/vault.ts:193`). `areaIntentions?: Record<areaId, string>` and `people?: Record<personId, string>`, each text 1–12 words. A person listed with empty text means "on this season's roster" (#88). Same precedent as `placeIds`: per-season lists sit on the cycle row, no new collection. `fs.rs` carries no cycle fields, so the Rust side passes them through untouched.

- **MCP read and write** (`mcp-server/index.ts:2286`, `:2415`, `:2186`). `update_cycle` and `plan_cycle` accept both fields; `get_running_cycle` returns them with area and person names resolved. Unknown area or person ids are rejected with the id named.

- **`/season` asks, then writes** (`plugin/skills/season/SKILL.md`). Planning asks one question per area the gardener names, and per person they want to see this season, then writes the answers in one `update_cycle`. Fix the drift at `:114` (`plan_cycle` does not create budget plans). BCT 1.1 (goal setting, behaviour), written by the gardener in their own words.

- **Read back at the season's close** (`plugin/skills/season/SKILL.md:66`). "Reflect on the intention" extends to each area and person intention, shown beside that plot's moments and that person's moments. BCT 1.5 (review behaviour goals), as plain observation.

## Risks

**Rabbit holes:**
- Building a picker for which areas get an intention. The gardener names them; areas left unnamed get none.
- Validating the 1–12 word range with a parser. Count on whitespace, reject outside the range, done.

**Off-sides:**
- A verdict on whether the season honoured the intention. "I meant X, the season held Y" is one step from "you failed at X" (#72 names the same trap). Show both side by side and stop there.
- Showing intentions on cards or the day view. Later, if the read-back earns it.

**Domain knowledge:**
- Confirm the app's cycle write path spreads the stored row, so editing a cycle's name in the app keeps the new fields.

## Acceptance

1. `update_cycle` with `areaIntentions` and `people` persists both; `get_running_cycle` returns them with names.
2. Renaming the cycle in the app leaves both fields intact in `cycles.json`.
3. An unknown area or person id is rejected with that id in the error.
4. `/season` planning writes one intention per named area and person in a single call.
5. `/season` review shows each intention beside the matching moments, with no score or verdict.
6. `pnpm test` and `pnpm smoke` (in `mcp-server/`) pass; #88 closes with a pointer to the merge.

---

_Supersedes: 2026-10-24-season-intentions-replace-cycle-plans.md. Drafted by Claude (scribe)._
