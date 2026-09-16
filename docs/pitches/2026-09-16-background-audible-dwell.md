---
tag: pitch
appetite: small
status: draft
source: "desktop log analysis — 54-min Zoom in Brave showed 11 min dwell"
supersedes: []
hard_dependency: none
---

# Pitch -- Background-audible dwell tracking

**Bet:** Count background-but-audible tab time as a separate dwell dimension so calls and media that run in-browser stop vanishing from attention data. Small appetite: two event kinds in the writer, one new gating branch in bouts.

**Why it matters:** A 54-minute Zoom call in Brave showed 11 minutes because the tab was backgrounded. The weekly attention breakdown (#202, #199) and the recap skill both consume bouts -- if the raw data is wrong by 4x, every downstream surface lies. Fixing the writer fixes all readers at once.

---

## Boundaries

**JBTD:** As a gardener reviewing where my attention went, I want browser calls and background media counted so that a 54-minute Zoom call reads as ~54 minutes, not 11. Baseline today: `bouts()` and `runs()` credit time only while the tab's domain is in the foreground AND the browser has OS focus AND the user is not idle. A backgrounded audible tab accumulates zero.

**Out:**
- Conflating audible dwell with foreground dwell (they stay separate dimensions)
- Detecting call vs. music vs. notification sounds (kind of audio is out of scope)
- Changing the 30-minute segment cap or bout gap for audible spans
- New UI surfaces for audible time (the new-tab circles consume `runs()` -- they get it for free)
- Sensor-level integration (no content-script changes)

## Elements

- **Audible span events** (`modules/activity/events.ts`). Two new pure functions: `audibleTransition(spanStart, isAudible, tabId, domain, now) -> SpanTransition & { tabId, domain }`. Same start/end pattern as `focusTransition` and `idleTransition`. Emits `audible_start` (payload: `{ domain, tab }`) and `audible_end` (payload: `{ domain, tab }`, durationMs). BCT anchor: these events are the data that makes self-monitoring of behaviour (BCT 2.3) accurate for in-browser calls -- the existing awareness surface gains truthful numbers without any new UI.

- **Writer listener** (`modules/activity/writer.ts:171`). The existing `onUpdated` handler checks `changeInfo.url`. Add a parallel branch: when `changeInfo.audible !== undefined`, resolve the tab's domain from `tab.url` (not `changeInfo`, which carries no URL on audible flips), look up the tab uuid, and feed `audibleTransition`. One `Map<number, number>` tracks audible-start timestamps per tab, same pattern as `idleSince` / `focusSinceItem`.

- **Bouts: audible-gated dwell** (`modules/domain/bouts.ts:204`). Today the walk skips time when `attending` is false (focus_end or idle_start). Add a parallel boolean `audible` per domain (a `Set<Domain>`). When `attending` is false but the domain is audible, credit the gap as `audibleDwellMs` instead of dropping it. New field on `Bout` and `Run`: `audibleDwellMs: Duration` (defaults to 0). Existing `dwellMs` stays foreground-only so nothing downstream changes meaning.

- **Domain resolution for audible tabs** (`modules/activity/writer.ts`). `changeInfo.audible` fires on `onUpdated` but does not carry `changeInfo.url`. Use `browser.tabs.get(tabId)` to read `tab.url` -- the same call `onActivated` already makes. The domain comes from the browser, not the page (hostile-page boundary preserved).

## Risks

**Rabbit holes:**
- Service worker death mid-audible-span. The `audibleSince` map lives in memory like `idleSince`. If the SW dies, `audible_end` never fires for that span. Acceptable: `bouts()` already handles missing `focus_end` and `idle_end` via the segment cap. Same ceiling applies -- a 30-min audible gap without a closing event caps at 30 min, never inflates overnight.
- Multiple audible tabs at once (two calls, or a call + music). Each tab gets its own audible span; `bouts()` credits domain-level audible dwell per tab. No double-counting because each event carries a tab uuid and `byDomain` accumulates per domain.

**Off-sides:**
- "Audible = engaged" heuristic. A tab playing background music is audible but not attended the same way a call is. This pitch deliberately does not distinguish -- it records the fact (audible), not the inference (engaged). Distinguishing call vs. music is a separate pitch if the data shows it matters.
- Fencing audible tabs. A fence could block a tab that's been audible too long. Out -- fences act on navigation, not on audio state.

**Domain knowledge:**
- `chrome.tabs.onUpdated` fires with `changeInfo.audible` set to `true` or `false` when a tab starts or stops producing audio. Confirmed in Chrome Tabs API docs. No extra permission beyond `tabs` (already granted).

## Acceptance

1. A Zoom/Meet/Teams call running in a background tab for 30+ minutes produces an `audible_start` event at the beginning and an `audible_end` event (with `durationMs`) when audio stops or the tab closes.
2. `bouts()` returns a `Bout` whose `audibleDwellMs` reflects the background-audible time, separate from `dwellMs`.
3. `runs()` returns a `Run` whose `audibleDwellMs` reflects the same, so the new-tab circles show the call's domain with accurate total time.
4. Foreground dwell (`dwellMs`) is unchanged -- no existing numbers shift.
5. A tab that is both audible AND in the foreground does NOT double-count: foreground dwell wins (audible dwell counts only while backgrounded).
6. The extension requests no new permissions.

---

_Drafted by Claude (scribe)._
