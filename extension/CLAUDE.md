# zenborg extension — Development Guide

**A Chrome extension (WXT) that observes — activity writer, per-domain sensors, friction primitives, and the blocklist drogue.**

Part of zenborg. Run locally with `pnpm dev` from `extension/`.

---

## Architecture

```
extension/
├── entrypoints/
│   ├── background.ts                # SW — activity writer + DNR sync + cooldown lapse alarm
│   ├── popup/                       # Status (event count, fences) + cooldown button
│   ├── manage/                      # Fence dashboard + area map + log export
│   ├── newtab/                      # New-tab override
│   ├── block/                       # Drogue block page
│   ├── sensor.content/              # ONE generic sensor, all pages, observe-gated
│   └── transform.content/           # CSS transform injector
├── modules/
│   ├── activity/                    # Writer: events.ts (pure) + writer.ts (chrome.*) + log.ts (IndexedDB)
│   ├── sensors/
│   │   ├── events.ts                # Pure: kind allowlist, payload caps, observe gate, arm query
│   │   ├── senses/                  # TYPE-based detection: video.ts, feed.ts, shopping.ts, game.ts
│   │   ├── adapters.ts              # Site-specific probes as DATA — the only place a domain may appear
│   │   └── send.ts                  # Content-script channel
│   ├── watchlist/                   # DERIVED observe tier (fence domains ∪ area-map domains, not manual)
│   ├── fence/                       # Fence parsing, projection, cache — the standing state
│   ├── friction/
│   │   ├── cooldown/                # state.ts (pure) + store.ts (chrome) + arm.ts (the one gesture)
│   │   ├── gate/                    # dwell gate: state.ts + decide.ts (pure) + overlay.ts + arm.ts
│   │   ├── policy/                  # store.ts — areas, area map, transforms from the host
│   │   ├── transform/               # CSS hiding rules applied per-page
│   │   └── areas/                   # scope.ts + days.ts — which areas a rule applies to, when
│   ├── relay/                       # Native messaging bridge to the vault host
│   └── domain/                      # Pure domain logic: bouts, runs, routes, moment-friction
```

## Key design decisions

**The observe tier is derived, not maintained.** Since 2026-08-26, a domain is
auto-observed when it appears in any fence or area map assignment. The manual
watchlist is retired. `derivedObserveDomains()` in `modules/watchlist/store.ts`
reads `fenceCache ∪ areaMap ∪ observeDomains` fresh on every call, where
`observeDomains` is the native host's `observe` push: every host the vault maps
to an area (`map_area` kind=host). Mapping a site is what makes it observed.

**The sensor runs in every frame** (`allFrames`, `matchAboutBlank`), so embedded
players are sensed. Events are credited to the tab's domain (`senderDomain`),
never the iframe host, and one frame per tab holds playback at a time
(`claimPlayback`), so players in several frames never read as two. Subframes
arm the video sense only.

**Sensors are type-based, never company-based.** Generic senses (video, feed,
shopping, game) self-select by DOM shape on any observed domain. Site adapters in
`adapters.ts` exist only where generic detection fails, and they are data.

**Friction primitives: fences, gates, cooldowns, transforms.** zenborg (via MCP)
declares what is fenced; the extension decides when it fires. The fence state is
pushed over native messaging and cached in `chrome.storage.local`, so actuation
never waits on a round trip and a dead host never lifts a fence.

`friction/cooldown/state.ts` holds the behavioural rule: **setting is
write-forward-only.** Re-setting may push the stamp out, never pull it in, and
there is deliberately no way to lift early — the unlock path is `wait`.

## The hostile-page boundary

Sensor content scripts are untrusted. The background:
- accepts only allowlisted kinds (`modules/sensors/events.ts` SENSOR_KINDS),
- reduces payloads to capped scalars,
- derives `domain` from the browser-attested `sender.tab.url` — never the message,
- writes nothing unless the domain is on the derived observe tier.

## Privacy posture (load-bearing)

- Payloads carry **domains only** — never full URLs, never page titles.
- Counts and timings, never content.
- Everything stays in extension-local IndexedDB until the relay flushes to the vault.
- The manifest requests no `host_permissions` and no `webRequest`.

## Commands

```bash
pnpm dev          # WXT dev server (run from extension/)
pnpm build        # production build → dist/chrome-mv3/
pnpm test         # vitest (pure modules)
pnpm typecheck    # tsc --noEmit
```

- Never run the dev server. The user runs it manually.
