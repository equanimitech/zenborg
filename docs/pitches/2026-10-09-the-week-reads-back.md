---
tag: pitch
appetite: big
status: draft
source: "conversation 2026-10-09: /weekly-moments-review, then 'compare what I planted with what I actually did on screen'; Entertainment read 238 → 472 min ('doubled'), a recount from desktop logs gave ~9–16 h of viewing in both weeks"
supersedes: []
related: ["docs/pitches/2026-08-14-harvest-the-season-reads-back.md", "docs/pitches/2026-09-16-background-audible-dwell.md", "docs/decisions/2026-09-25-garden-vocabulary.md", "docs/2026-10-05-zenborg-jobs-run-in-the-daemon.md"]
issues: ["#199", "#202", "#194", "#187", "#237"]
---

# Pitch -- The week reads back: one mirror in the app, interpretation in conversation

**Bet:** One pure function reads a week from the vault: what was planted, the footprints each surface left, and how much of the week each surface could see. The app's `/week` renders it with no network and no model. One MCP tool returns the same object, so the rituals become "fetch, then talk". Before any of it is trusted, the two sensor gaps that made viewing vanish get closed.

**Why it matters:** On 2026-10-09 `get_attention` reported Entertainment "doubled" (238 → 472 min). A recount from the desktop log found ~9–16 h of viewing in *both* weeks; only the source moved, from Stremio to YouTube. The mirror lied by a factor of two to four and said nothing about what it could not see. Today:
- no skill reads footprints: `recap` was removed 2026-09-10 (`575dfe3`), and no skill calls `get_attention` or `get_day_trace`;
- `weather` and `weekly-moments-review` both render the same day-by-day board;
- the app cannot read the activity log at all: `ActivityLogPort` (`src/application/ports.ts:37`) has no adapter, and `/week` redirects to `/cultivate`.

---

## Boundaries

**JBTD:** As the gardener, at the end of a week, I want to see what I planted next to where my attention actually went, and how much of that the garden could see, so that next week's planting answers to what happened, not to a number that is off by 4×.

**Baseline today:** I run `/weekly-moments-review`. Claude makes 7 + 3 MCP calls, rebuilds the board by hand, and has no footprints. When I ask for them, it calls `get_attention`. That tool counts no idle time as viewing, maps two Entertainment hosts, knows no desktop apps, and reports no blind spots.

**Out (no-gos):**
- **No score.** No alignment %, no completion rate, no "doubled". Planted and footprints sit side by side in minutes. Week over week means two numbers, never a ratio or an arrow (`docs/principles.md`, Red Lines; `harvestViewModel.ts:22`).
- **No push.** The snapshot is a file. Nothing notifies, emails or badges. You visit `/week`; it does not visit you.
- **No scheduled LLM.** Interpretation happens only in a conversation you start.
- **No number without its coverage.** Every footprint total carries the hours its surface saw, the minutes credited through idle, and the unmapped minutes. Moments off screen are marked untraceable, never "missed".
- **No titles, messages or URLs** in any new spring. Repo + count; issue id + state. This keeps the privacy tier of `mcp-server/attention.ts:4`.
- **No new oracle machinery.** Springs draw into `log/*.jsonl` through `jobs.json`, per the 2026-09-25 vocabulary decision. `oracles.json` gains nothing.

## Elements

Slices ship in this order; each is one PR. **Must = 1–4. Should = 5–6. Nice = 7, cut first.**

1. **The readback core + one MCP tool** (`src/domain/readback/`; reuses `dwellRows`/`byArea`/`coverage` at `src/domain/attention/AttentionSummary.ts:54,316`, `nightsOf`/`workoutsOf` at `src/domain/garmin/BodyLog.ts:39,60`).
   - `weekReadback({ events, moments, habits, areas, phaseConfigs }, from, to)` returns: the board per day and phase; the planted count per area; footprints per surface and area, with coverage; this week and last week as two plain counts; wilting habits.
   - It groups footprints by the reading surfaces: **body** (garmin), **screen** (desktop + browser), **work** (agent, later git/Linear), **journal**, **comms**. A surface with no spring reads "not drawn", not zero.
   - A week is **Monday → Sunday**, built from `wakingDayWindow` (days roll at 04:00). It is not a rolling 7 days.
   - The MCP tool is **`get_footprints`**, following the 2026-09-25 vocabulary decision. It returns that object. `get_attention` and `get_day_trace` are retired in this slice.
   - Move `normalise` from `mcp-server/activity-log.ts` into the domain so the app and the MCP server parse lines the same way.
   - BCT lens: self-monitoring of behaviour (2.3) and feedback on behaviour (2.2). The discrepancy between plan and footprints (1.6) is *shown*, never computed. Reading it is the gardener's job.

2. **`/week` renders it** (`src/app/week/page.tsx:9`, today `router.replace("/cultivate")`).
   - Add one Tauri command, `activity_read(from, to)`, that returns raw lines. Rust does no parsing, so the shape is not paid for twice. It implements the dormant `ActivityLogPort`.
   - Gross → subtle: week totals per area first, then per surface, then the coverage line. Stone tones; colour only for areas. No modal.

3. **The rituals fetch, then talk** (`plugin/skills/weather/SKILL.md:30,40,165`; `plugin/skills/weekly-moments-review/`).
   - `weather` gains a week mode that makes one tool call, then renders and asks one question. Delete `weekly-moments-review`.
   - Remove the dead `recap` references in `weather` and `close-up`.
   - Add `plugin/surfaces/screen.md`. Rewrite `browser.md`, which still says there is no duration tracking. Fold `tasks.md` into `work`.
   - PDP lens: Reduction. The rituals do 1 call instead of 10, and they stop re-deriving the board.

4. **Viewing survives idle** (`src-tauri/crates/zenborg-daemon/src/sensors.rs:200`; `AttentionSummary.ts:220` `findBoundary`).
   - **Probe 2026-10-09:** while Brave played audio, `pmset -g assertions` showed only `NoIdleSleepAssertion named: "Playing audio"` (pid Brave). `PreventUserIdleDisplaySleep` stayed at 0. Chromium takes the display wake lock only while a video is *visible*, so it is absent in the case that matters most: video playing behind cmux. The daemon therefore samples **both** assertion types. It credits the idle span to **the app that holds the assertion**, not to the frontmost app. A second probe with the video visible showed Brave also holding `NoDisplaySleepAssertion named: "Video Wake Lock"`. So: visible video gives both assertions, background video gives "Playing audio" only. The assertion type name differs from `PreventUserIdleDisplaySleep`, so match on the owning process and the assertion name, not on the summary counter. Stremio, Netflix and a streaming site still need probing.
   - The daemon also samples which app holds a macOS `PreventUserIdleDisplaySleep` assertion. Players take it during playback, including Stremio and browsers playing iframe or DRM video. The daemon emits `display_held_start`/`_end` with the app name.
   - A plain `idle_start` no longer closes a desktop span while the frontmost app holds the assertion. A lock still closes it. The span is capped at 3 h, overriding the 30-min desktop cap (`mcp-server/attention.ts:30`), so a laptop left on overnight does not count.
   - Coverage reports these minutes as "credited through idle".

5. **Iframe players sense** (`extension/entrypoints/sensor.content/index.ts:21`).
   - Set `allFrames: true` (+ `matchAboutBlank`). The domain already comes from `sender.tab.url` (`extension/modules/sensors/events.ts:140`), so the embedded player is credited to the tab's domain, not the iframe host.
   - Viewing sites must also be on the watchlist's observe tier. Without that the sensor stays dormant, iframe or not.

6. **Git and Linear springs** (`<vault>/jobs.json`; `ActivitySurface` at `src/domain/attention/ActivityEvent.ts:15`).
   - Git, local: one job that walks the repos under the areas' `surfaces.paths` and writes `log/<day>.git.jsonl` with `{ repo, commits }`.
   - Linear: one job that writes `log/<day>.linear.jsonl` with `{ issue id, from → to state, ts }`. **Ids and state changes only.** No titles and no bodies: Themia content stays out of the personal vault.
   - Move Garmin's launchd plist, which runs `_archive/keel/.../garmin_sync.py`, into `jobs.json`.
   - Things comes later.

7. **Friday snapshot** (bundled `zenborg-mcp` sidecar; interval trigger).
   - A daily interval job runs `zenborg-mcp readback --last-week`. It writes `readbacks/<iso-week>.json` once, when the week has closed. The scheduler has no calendar trigger, and this slice does not add one.

## Risks

**Rabbit holes:**
- *Two health implementations.* Wilting lives in `mcp-server/health.ts:49` (`computeHealth`) and separately in `src/domain/services/HabitHealthService.ts`. The core must use the domain one. Test that both agree on a fixture before deleting either.
- *Display-sleep assertions.* Some players hold the assertion while paused; some apps hold it for other reasons (Zoom, Keynote). Cap and lock bound the error. Do not classify reasons.
- *A third reader.* Settled 2026-10-09: the new tool **is** `get_footprints`, and `get_attention` + `get_day_trace` are retired in slice 1. Three overlapping readers is the drift this fixes.
- *Week boundary.* Settled 2026-10-09: Monday → Sunday. Days start at 04:00 (`mcp-server/attention.ts:36`), so the week must reuse `wakingDayWindow`, or Sunday night leaks into Monday.

**Off-sides:** A trend chart across many weeks. Per-site breakdowns of viewing. A TRMNL render of the snapshot (`docs/trmnl-template.liquid` exists; the settings were removed in `d70e991`). Sunset proposing moments from unplanted spans (#237) builds on slice 1 but is its own bet.

**Fat cut:**
- Slice 7. No log pruning exists, so the live view loses nothing without a snapshot. Build it when the logs start to fade or a TRMNL hangs on the wall.
- Slice 6 can slip. Agent sessions already show work by cwd.

**Domain knowledge:**
- Verify that Stremio, Brave (YouTube, an iframe player, Netflix) and QuickTime hold `PreventUserIdleDisplaySleep` during playback. Use `pmset -g assertions` while each one plays. If one does not, fall back to a fullscreen flag. `app_switched` already carries `is_full_screen`, but Slack and Brave report it for Spaces, so it is weak alone.
- The Entertainment mapping fix is happening outside this pitch. Slice 1 must still report unmapped minutes, because the next unmapped site will be different.

## Acceptance

1. `weekReadback` on a fixture week returns the board, the per-area planted count, and per-surface footprints. Every footprint total has `coverage: { seenHours, idleCreditedMin, unmappedMin }`. No field is a ratio.
2. The MCP tool and `/week` render identical minutes for the same week, and both use the one domain function.
3. `/week` opens in the app without a redirect and works offline. Journal and comms read "not drawn".
4. `/weather week` makes one readback call. `weekly-moments-review` is gone, and no skill mentions `recap`.
5. A 2-h film in Stremio with no input logs ≥ 110 min of desktop dwell. A Mac left awake overnight credits ≤ 3 h. A lock closes the span.
6. A video in a cross-origin iframe on an observe-tier site writes `video_started`/`video_paused` credited to the top tab's domain.
7. (6) `log/<day>.git.jsonl` holds repo + count and no commit message. Garmin runs from `jobs.json`, and its launchd plist is gone.
8. (7) Running the snapshot job twice in one week writes one file.

---

_Drafted by Claude (scribe)._
