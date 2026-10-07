---
tag: pitch
appetite: small
status: draft
source: "readiness audit .claude/attently/zenborg-shareability.md (2026-10-07); docs/plans/2026-09-23-soft-launch.md"
hard_dependency: "Rafa re-accepts the Apple DPLA (human-only step, 2026-10-07) before PR #232 can notarize"
related: ["docs/plans/2026-09-23-soft-launch.md", "docs/pitches/2026-08-24-ship-zenborg-to-three-testers.md"]
---

# Pitch -- Open the gate: zenborg a friend can install alone

**Bet:** One build day clears what stops a friend before they can hit any friction: Gatekeeper, a dead link, a blank first screen, a Rafa-shaped plugin. Everything else waits for the friction log.

**Why it matters:** The soft launch asks, by 2026-10-23, whether zenborg holds for someone who isn't its builder. "Fix only what a real person hit" needs a real person inside the app first. Today every non-developer stops at Gatekeeper. Week 2 tending needs installs by ~10-12.

**Stance (decided):** zenborg is **app-first, with an optional agent**. Everyone is invited. The app must stand alone; Claude is a second door anyone may open. Onboarding, rituals, routines and fences being Claude-only is the product's shape this cycle, not a bug.

---

## Boundaries

**JBTD:** As a friend Rafa sends one link to, when I open it on my Mac, I want to reach a planted moment without calling him, so that what I report is about the garden, not the installer. Baseline today: the README link 404s, the .dmg is unnotarized (off since 08-21), and first launch is an empty /plant with no word of what to do.

**Out:**
- No Intel or universal build. Ask the four first.
- No Windows, Linux or mobile.
- No onboarding wizard or welcome screen. PR #213 stays parked.
- No silent seeding. Boot still seeds nothing (`initialize.ts:71`, commit 7e000e2); an area exists only after the gardener's click.
- No Node-free hooks, no one-install Claude door (#230), no .mcpb.
- No fence screen (#216) or routine UI (#136) before launch. The fence screen is a post-launch commitment: the landing page promises it "in an update during your first weeks".
- No analytics. The calls are the channel.

## Elements

Must-have = 1, 2, 3. Should-have = 4. Nice-to-have, only if the day has room: repoint the plan's dead audit link to the shareability audit; fix the plugin README skill count.

1. **Notarize** (`.github/workflows/release.yml:151-153`, PR #232). Rafa accepts the DPLA today, merge #232, tag 0.49.0. A fresh download passes `spctl -a -vv` as "Notarized Developer ID".
2. **One front door at equanimi.tech/projects/zenborg** (site PR #4, `src/pages/projects/zenborg.astro`, `/zenborg` redirects). States: Apple Silicon Macs; "no badges, no sounds"; works with Claude, optional, needs Node 22.7+; fences arrive in the first weeks. README (`README.md:7`) and plugin links shrink to that URL; the retired views go.
3. **First run: one line plus one-click starter areas** (`src/app/plant/page.tsx:49`, `src/domain/entities/Area.ts:39`). With zero areas, /plant shows one quiet line and the six `DEFAULT_AREAS`, each one click to keep. Unclicked offers write nothing. Rafa runs it first on a fresh macOS account; fix only what stops him reaching a moment.
   - Lens: BCT 4.1 *instruction on how to perform the behavior* plus PDP *reduction* and *suggestion*: strong defaults, offered, never placed (principle 9). Not *tunneling*. No return reminder (red line), so week 2 tending stays honest.
4. **Take Rafa out of the Claude door** (`plugin/skills/midday`, `plugin/skills/close-up/SKILL.md:49`, `plugin/surfaces/tasks.md`). Midday moves to a personal plugin. Close-up lands in the journal unless a route is declared. Themia examples go neutral. The marketplace drops the phantom `recap`. Gates only friends who open the Claude door.

## Risks

**Rabbit holes:**
- *The offer growing into #213.* One line, six chips, stone tones plus each area's own color. No picker, no steps.
- *Site PR #4 polish.* Ship once it states the facts.

**Off-sides:** oracle-to-spring renames, `KEEL_HOME`, package.json versions. Each waits for a friend to hit it.

**Domain knowledge:** `mcp_install.rs` misses `claude` installed via nvm or npm-global; a Claude-door friend may need `claude mcp add` by hand. Log it.

## Acceptance

1. All four friends confirmed on Apple Silicon.
2. A .dmg downloaded in Safari opens on a clean account with only the standard "downloaded from the Internet" prompt.
3. equanimi.tech/projects/zenborg returns 200 and links the latest release; /zenborg redirects there; every README and plugin link points to it.
4. On an empty vault, /plant shows one line and six starter areas; the vault holds zero areas until Rafa clicks or types one; he reaches a moment on Cultivate in under 5 minutes, no docs.
5. (4) `grep -rli "rafa\|themia" plugin/skills plugin/surfaces` returns nothing.

---

_Drafted by Claude (scribe)._
