# Derived Attention — pitch

**Date:** 2026-09-01
**Appetite:** small (1–2 sessions)
**Status:** shaped

> The garden shows what you intend but not what you attend. Sessions run dark,
> calendar events are invisible, and crafting on zenborg itself leaves no mark.
> The domain model for this is complete and tested — what's missing is the
> wiring: no adapter reads the log at runtime, no skill surfaces the results.

---

## Boundaries

**Problem.** Attention derivation is fully modelled in `src/domain/attention/`
(SpanDerivation, AreaMap, Discrepancy, Baseline — 80+ tests passing) and wired
as a use case (`deriveDiscrepancies.ts`). But the `ActivityLogPort.read()` has
no real implementation connecting to `~/.kairos/keel/log/`. The model runs in
tests and nowhere else. Meanwhile, sessions run dark because the existing nudge
requires explicit confirmation most users skip, and calendar events are
invisible to sunrise.

**What this is.** Wire the existing domain to the existing log. Surface derived
attention in skills. Show calendar context in sunrise. Strengthen the nudge
without crossing the Downstream Allocation line.

**What this is not.** Not new domain modelling (it's done). Not the calendar
zoom-ladder UI. Not EventKit or CalDAV. Not a time tracker. No new vault
collections.

**Appetite.** Small — the domain is built; this is adapter + skill changes.

---

## Existing domain (built, tested, unused at runtime)

| Module | What it does | Tests |
|---|---|---|
| `ActivityEvent.ts` | Read-side mirror of keel's log; human/agent/joint actor taxonomy | 8 |
| `AreaMap.ts` | cwd→area resolution via path/host rules, longest-prefix matching | 18 |
| `SpanDerivation.ts` | Events → attention spans; idle gap, planned boundaries, human-only | 32 |
| `Span.ts` | Half-open `[start, end)` interval with provenance | 8 |
| `Discrepancy.ts` | Gap between planted and observed: drift, absence, overrun, fragmentation | 10 |
| `Baseline.ts` | 21-day shadow mode stability check before trusting the model | 13 |
| `deriveDiscrepancies.ts` | Full use case: log → area → spans → discrepancies | 17 |
| `ports.ts` | `ActivityLogPort`, `GardenPort`, `DiscrepancyStorePort` — all portless | — |

**What's missing:** a real `ActivityLogPort` adapter that reads
`~/.kairos/keel/log/`, and callers in the skills that surface the output.

---

## Elements

### 1. ActivityLogPort adapter (new file)

**What:** Implement `ActivityLogPort.read()` against the keel JSONL log at
`~/.kairos/keel/log/`. The existing `store.mjs` in the plugin already has
`readEvents(LOG_DIR, now)` — the adapter wraps the same directory in the
domain's typed interface.

**Where:** `src/infrastructure/vault/` or `plugin/` — TBD based on which
runtime needs it first (the Tauri app for a future attention view, or the
plugin skills for recap/weather).

### 2. Smarter nudge on session start (plugin change)

**Where:** `plugin/keel.mjs` → `handleUserSubmit`

**Today:** `intentionNudge` fires once per session when nothing is active. It
asks the agent to infer the habit and propose it. The user must confirm. Most
skip it → session runs dark.

**Change:** Enrich the nudge with a **deterministic match**:

```
today's allocated moments  →  filter by cwd→area match  →  pick the one in the current phase
```

If exactly one moment matches, **name it in the nudge** so the agent can
propose it with confidence. If multiple match, list them. The agent still
proposes; the user still confirms. The nudge becomes more specific, not
bypassed.

**Principle 9 check:** "Who decided?" — the user. The system proposes with
better information; the user still says yes. This respects Downstream
Allocation. Auto-setting without asking would violate it.

### 3. Calendar overlay in sunrise (skill change)

**Where:** `plugin/skills/sunrise/SKILL.md`

**Change:** Add one parallel fetch:

```
mcp__claude_ai_Google_Calendar__list_events { calendarId: "primary", timeMin: today, timeMax: today }
```

Render as a **separate lane**, stone tones (not area colors):

```
Calendar:  09:00–10:00  Team standup
           14:00–15:30  Dentist
           19:00–20:00  Dinner w/ Alice
```

Calendar events are context, not intention. They show what's spoken for so the
gardener can plant around them. Read-only — zenborg never writes to calendar.

**Principle 4 check (Peripheral Presence):** calendar events are shown once at
sunrise, as ambient context. They don't push, badge, or alert. The user visits
the garden; the calendar data is there when they arrive.

### 4. Derived attention in recap/weather (skill change)

**Where:** `plugin/skills/recap/SKILL.md`, `plugin/skills/weather/SKILL.md`

**Change:** After reading moments and git, call the existing domain:

```
ActivityLogPort.read(window) → resolveArea() → deriveSpans() → aggregate by area
```

Surface as a separate section:

```
Attention (derived from sessions):
  equanimi.tech  3h 20m  (4 sessions)
  Themia         1h 45m  (2 sessions)
  unattributed   0h 30m  (1 session, no moment set)
```

**Principle check:** "Information, never score" — hours are neutral information.
No targets, budgets, comparisons, or judgments. The discrepancy model
(drift/absence) exists in the domain but is deliberately NOT surfaced yet —
that awaits the 21-day baseline from `Baseline.ts`.

---

## Risks

| Risk | Mitigation |
|---|---|
| Nudge proposes wrong moment | Conservative: cwd→area match + current phase + naming in nudge (not auto-setting). User still confirms. |
| Google Calendar MCP unavailable | Degrade gracefully: "(calendar not connected)" |
| Keel log unreadable (private tier) | The adapter must run inside the same trust boundary as the plugin. Skill-side reads go through the adapter, not raw log access. |
| Derived hours feel like a time tracker | Framing: "where attention landed" not "how long you worked." Information as mirror, never as judge. No targets. |
| Discrepancies surfaced too early | They aren't — element 4 surfaces spans/hours only. Discrepancy display is a separate decision gated on `Baseline.assessBaseline()` stability. |

---

## Principles alignment

| Principle | Verdict |
|---|---|
| **4. Peripheral Presence** | Calendar + derived attention are ambient context shown when the user visits. No push, no badge. ✓ |
| **5. Attentional Granularity** | Hours per area is coarse grain — appropriate for recap/weather altitude. ✓ |
| **6. Bounded Experiences** | Calendar lane and attention summary are finite sections with natural endpoints. ✓ |
| **8. Fade-by-Design** | Derived attention is a mirror the gardener reads, not a dashboard they depend on. ✓ |
| **9. Downstream Allocation** | The user decides what to tend. Nudge proposes with better data; never auto-sets. Calendar events are context, never converted to moments. ✓ |
| **"Information, never score"** | Hours are neutral. No targets, budgets, streaks, or comparisons. ✓ |

---

## Pitch

Wire what's built to where it's needed:

1. **Adapter** — implement `ActivityLogPort` against `~/.kairos/keel/log/`
2. **Smarter nudge** — enrich `intentionNudge` with cwd→area match so the
   proposal is specific (user still confirms)
3. **Calendar in sunrise** — read-only lane of today's events, stone tones
4. **Derived hours in recap/weather** — spans aggregated by area, neutral framing

The domain model is complete. This pitch wires it.

Supersedes: `2026-05-31-connect-calendar.md` (partially — the read side only).
Feeds into: `2026-06-03-calendar-zoom-ladder.md` (the UI this plumbing enables).
