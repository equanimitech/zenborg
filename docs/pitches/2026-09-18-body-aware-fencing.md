---
tag: pitch
appetite: medium
status: draft
source: "conversation: Pi 5 + AdGuard Home setup, 2026-09-18"
hard_dependency: "2026-09-18-adguard-resolver-adapter.md (the pipe to AdGuard must exist first)"
---

# Pitch -- Body-aware fencing

**Bet:** Use overnight Garmin data (sleep score, HRV, recovery) to adjust morning fence strictness automatically, so the garden responds to your body state rather than running a fixed schedule.

**Why it matters:** A fixed fence treats every morning the same. A bad night followed by an open YouTube window is the exact moment willpower is lowest and the fence matters most. The Pi is the only device awake overnight to act on it.

---

## Boundaries

**JBTD:** As a gardener who wears a Garmin to bed, I want my morning fences to be stricter after poor sleep and looser after good recovery, so the garden adapts to my actual capacity rather than assuming a constant. Baseline today: all fences are static schedules; body data exists in Garmin but never influences attention policy.

**Out:**
- No Garmin account provisioning (oracle already registered in `oracles.json`)
- No intraday biometric tracking (morning adjustment only, not live HRV reactivity)
- No custom thresholds UI (hardcoded tiers to start: bad / ok / good)
- No notification to the user explaining why fences shifted (check the dashboard if curious)

## Elements

- **Overnight poll** (zenborg-home daemon on Pi). Polls Garmin API after wake anchor (from sleep data) for sleep score, HRV status, and body battery at wake. The Garmin MCP oracle already exposes `get_sleep_data`, `get_hrv_data`, `get_body_battery`, `get_training_readiness`.

- **Recovery tier derivation**. Map Garmin signals to three tiers:
  - **Low** (sleep score < 60 or HRV below baseline): tighten -- extend dry windows, block distractions through MORNING
  - **Normal** (60-80): default schedule, no adjustment
  - **High** (> 80, high HRV, strong body battery): loosen -- shorten dry windows, earlier unblock

- **Fence modifier**. The daemon reads standing watering-hours fences with resolver enforcement, shifts `fromHour`/`toHour` by the tier's offset, and writes adjusted rules to AdGuard via the resolver adapter. Original schedule preserved in vault; only the AdGuard actuation shifts.

- **Morning log entry**. Write a one-line entry to the day's garden trace: "Fences adjusted: LOW recovery (sleep 48, HRV below baseline). YouTube blocked until 15:00 instead of 13:00." Observable, auditable, no mystery.

## Risks

**Rabbit holes:**
- Garmin API rate limits and auth token refresh. The MCP oracle handles this; don't reimplement.
- Defining "baseline HRV" -- Garmin already computes a 7-day rolling average. Use theirs, don't build a second.
- Overcomplicating tiers. Three is enough. Don't build a continuous curve.

**Off-sides:**
- Intraday reactivity ("you've been sitting for 2 hours, loosen the fence") -- different pitch, different signal.
- Workout-aware fencing ("you're running, unblock Spotify") -- different pitch, real-time not overnight.
- Suggesting bedtime or sleep habits based on fence-crossing data -- crosses into prescriptive health territory.

**Domain knowledge:**
- Garmin sleep data availability: typically synced within 30 min of waking. The poll needs a retry window, not a fixed time.
- `get_training_readiness` is the single best composite signal (combines sleep, HRV, recovery, stress). May be enough on its own without reading each sub-signal.

## Acceptance

1. After a night with sleep score < 60, morning fences are measurably stricter (YouTube blocked for longer) before the gardener opens any device.
2. After a night with sleep score > 80, fences are looser than the default schedule.
3. A normal night produces no change to the default schedule.
4. The garden trace for the day shows which tier was applied and why.
5. If Garmin data is unavailable (watch not worn, sync delayed), fences fall back to the default schedule -- never fail to "no fences."

---

_Depends on: [[2026-09-18-adguard-resolver-adapter]]. Drafted by Claude (scribe)._
