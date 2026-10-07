# Gap Practice Guidance

> Shaped 2026-09-01. Appetite: **medium**.

## Boundaries

**Problem:** Gap practices exist as tagged habits in the vault but have no
living delivery surface. The plugin hook emits text into the status line —
invisible, untimed, rhythm-unaware. 45.6% of active session time sits in
AI-wait gaps, with drift excess at 15–60s and median time-to-first-drift at
38s. The practices (breathwork, chest openers, look far) are the substitution
for that drift, but a substitution nobody sees substitutes nothing.

**Appetite:** medium — the guidance surface is net-new UI in the Tauri app, but
gap practice is the forcing function that keeps it concrete.

**Not doing:**
- Timer/stopwatch for the practice itself
- Tracking whether the practice was performed (Garmin already logs breathwork)
- Adding new habits or tags — the roster is the garden's, authored by the principal
- Streak/completion UI — engagement, not equanimity
- Removing the plugin hook's text cue — it stays as fallback when the app isn't running

## Elements

### 1. Guidance primitive in the app

A transient, non-blocking message surface — the app's voice. Shows at the
bottom/edge of the screen (not center — not a modal). Auto-dismisses after a
timeout or on explicit skip.

Carries:
- `source` — what triggered it (gap practice, wilting habit, etc.)
- `message` — the offer text
- `action` — skip/dismiss, nothing else for now
- `ttl` — how long before it fades

Stone tones, no area color (this isn't attributed to an area). Flat, no
shadow. Square corners per design system.

The guidance surface is bigger than gap practice. It's the channel through
which zenborg speaks to the principal unprompted — gap practices first, but
eventually cycle reflections, wilting-habit nudges, watering-hours
transitions. Building it for one use case means designing it for all of them.

### 2. Guidance trigger protocol

The Rust side exposes a `show_guidance(source, message, ttl)` command. First
consumer: the gap-practice watcher. Future consumers call the same thing.

### 3. Gap-start watcher

The Tauri app watches `~/.kairos/keel/log/` for `prompt` events (already
written by the plugin's `UserPromptSubmit` hook). When one lands, a timer
starts. After `OFFER_AFTER_MS` (8s default — past instant turns, before p25 of
the drift curve at 12s), the guidance fires.

### 4. Rhythm-aware practice selection

`practicesForGap()` already filters by tag, size, and place. Add: check each
gap habit's `rhythm` to determine which is *due*. A habit with
`rhythm: { period: "hour", count: 3 }` is due every 20 minutes. The one most
overdue wins. Falls back to smallest-fit if no rhythms are declared.

### 5. Gap-end dismissal

When the agent responds (next activity log event after the prompt), the
guidance dismisses if still showing. The gap is over — the offer has no reason
to stay.

## Risks

| Risk | Mitigation |
|---|---|
| Offer fires on instant turns | 8s delay handles this — turns under 8s never trigger |
| Over-firing becomes noise | Rhythm is the natural rate limiter. Plus existing 30min floor |
| Log-watching adds complexity | App already watches the vault via Rust file watcher; extending to keel/log/ is the same mechanism |
| Two runtimes reading the same log | Read-only on the app side — no conflict with the plugin writer |
| Guidance surface design is wrong for future uses | Gap practice is concrete enough to design against; the surface carries source/message/ttl/action, generic enough for wilting nudges and watering-hours transitions |

## What this unlocks

The guidance surface is the app's voice. Once it exists:
- Wilting habits can nudge through it
- Watering hours can announce transitions
- Cycle reflections can surface at sunset
- The app stops being purely passive

## Signal path

```
plugin (UserPromptSubmit)
  │  writes prompt event to ~/.kairos/keel/log/
  │
zenborg app (Tauri, Rust watcher)
  │  detects prompt event
  │  waits 8s (OFFER_AFTER_MS)
  │  calls practicesForGap() + rhythm check
  │
guidance surface (frontend)
  │  shows practice name + sizing
  │  skip/dismiss or auto-fade after ttl
  │
next log event (agent responds)
     dismisses guidance
```
