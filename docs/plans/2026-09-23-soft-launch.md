# Soft launch — next cycle

## What we want

**Learn whether zenborg holds for someone who isn't its builder.**

- **Who:** four people close to the gardener — one developer collaborator, three friends. Invited by hand, one link each.
- **Success at cycle end:**
  1. All four installed without the builder touching their machine.
  2. At least two tended their garden in week 2 unprompted.
  3. A friction log ranked by what real people hit.
- **Not the goal:** growth, sign-ups, metrics. No analytics — the calls are the feedback channel.

## How to explain it

> A garden for your attention. Plant what you want to grow, with the people and places you care about. Cultivate it every day: tend what matters, fence out the weeds. Harvest what it teaches you, and tune the next season.

**You are the gardener.** Your garden is your habit ecosystem, digital and physical. You are
responsible for tending it and already do; zenborg is the toolshed that helps you tend with
more consistency and return with more resilience. Hero question: "What will I tend to today?"

Three tabs, two verbs each (the app's own navigation is the explanation):

| Tab | Verbs | In the app |
|---|---|---|
| Plant | habits · people · places | areas, habits, people, places |
| Cultivate | tend · fence | the day's moments, phases; fences (#216 lives here) |
| Harvest | reflect · tune | season readback, heatmap; retune rhythms and attitudes |

**What it is NOT** (the 2025 launch voice, kept): not a task manager, not a habit tracker,
not a calendar that nags, not a screen-time app, not a platform. The tabs say what it
is; the NOT list says what it refuses to be. Never "a better X".

The landscape (oracles: body, calendar, journal, tasks) and the toolshed (app, Claude, extension) stay out of the first explanation.

Vocabulary: "pruning" is the habit attitude (deliberate taper). Sites and feeds kept out are **weeds**, not pruning.

## Front doors

- **App** — for everyone. The garden is a passive surface; it must work alone, with no oracles.
- **Claude** — optional second door (Claude Code plugin now; Claude Desktop `.mcpb` later).

## Roadmap (~6 build sessions)

**Prep (rest of current cycle)** — confirm who is on Apple Silicon. No code.

**Week 1 — works without the builder** · must-have
1. Notarize (`release.yml`, uncomment `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`).
2. Clean-Mac first run: empty vault, no oracles. Fix what's confusing.
3. Landing page at `equanimi.tech/zenborg` (site repo, same design system): what it is · how it looks · get it. No sign-up, no waitlist. README shrinks to point there.
4. Bundle the MCP server into the plugin (compiled binary, declared in `plugin.json`); make the marketplace installable over public HTTPS.

**Week 2 — first 2–3, by hand** · must-have
- One developer, one or two non-developers. 30-minute install call each; watch, don't guide. One friction log.

**Week 3 — fix, then the rest** · should-have
- Fence screen in the app (#216, urgent) — see and clear any fence, set a basic site fence.
- Top 3 friction items. Fences phase in `/onboarding`. Invite the remainder. 20-minute check-in with all.

**Next cycle, depending on who asked** · nice-to-have
- Claude Desktop `.mcpb`, extension in the Chrome Web Store, Intel build.

## Rule for the cycle

Fix only what a real person hit.

## Known blockers (2026-09-23 audit)

See `.claude/attently/onboarding-for-a-stranger.md`.
