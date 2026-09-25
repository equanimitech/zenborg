---
tag: pitch
appetite: small
status: draft
source: "conversation: fence enforcement gap analysis, 2026-09-21"
depends_on:
  - "2026-09-18-adguard-resolver-adapter.md (shipped: 850b522)"
---

# Pitch -- Multi-surface fence enforcement

**Bet:** A fence is a declaration of intent — "reddit is off during dry hours." Enforcement is a separate concern that fans out to every available surface. Today, fences have no teeth: the plumbing writes rules, calls sync, but nothing actually blocks. Fix: when a fence goes up, every available surface enforces it. When a surface fails, the gardener knows.

**Why it matters:** `syncResolverFences()` runs after every fence write. But `collectResolverHosts()` filters for `enforcement?.at === "resolver"` — a field nothing in the codebase ever sets. Every sync delivers zero hosts to AdGuard. Meanwhile, the browser extension resolver is unbuilt. Result: fences are paper.

---

## Boundaries

**JBTD:** As a gardener who has declared standing blocks and dry watering-hours policies, I want those fences to block at the DNS level too (not just in the browser extension), so that a phone on the same network and a laptop without the extension are covered by the same declaration I already made.

**Baseline today:** `syncResolverFences()` runs. `collectResolverHosts()` returns an empty set. AdGuard receives nothing. The browser extension enforces browser-scoped fences, but that is the only surface with teeth.

**Out:**

- **cmux browser gate integration.** Standalone MCP tool (`set_browser_gate`), not composed. Keep it standalone -- it has its own scope model.
- **Automatic fence escalation.** "Resolver down, so promote to device-level" is a separate pitch.
- **VPN bypass detection.** ProtonVPN overriding DNS is real but out of scope. The WireGuard pitch (2026-09-19) addresses off-LAN reach; on-LAN VPN bypass is a network configuration problem, not an app one.
- **Browser extension build.** The extension already exists, reads `fences.json`, and actuates browser fences. This pitch does not touch the extension.
- **New domain concepts.** `CooldownEnforcement`, `RuleScope`, `RuleSpec` are complete as-is. This pitch is pure infrastructure wiring.

## Elements

### 1. Fan-out: every blocking fence reaches every available surface

When a fence declares a host block (standing blocks, dry watering hours), enforcement fans out to all registered surfaces — not just the one the rule was originally scoped to. Today that means: browser (fences.json) + DNS (AdGuard). Tomorrow: host file, cmux gate.

Concretely: broaden the AdGuard sync filter. Any browser-scoped rule with a standing or long cooldown contributes its domains to the resolver sync set. The "one rule, one enforcement point" principle (hostBlock.ts) is about delivery attribution, not about limiting which surfaces enforce a block.

```
fence declaration ("block reddit")
  ├→ fences.json     (browser extension reads — today)
  ├→ AdGuard Home    (DNS block — this pitch)
  ├→ /etc/hosts      (stub interface — future)
  └→ cmux gate       (standalone — future)
```

### 2. Health check: which surfaces are holding?

Add a `reach` field to the `get_fence` response per fence:

```
reach: {
  browser: "extension"     # always, if scope.surface === "browser"
  resolver: "synced"       # if host was in last syncResolverFences set
  resolver: "unreachable"  # if AdGuard checkReachable() returned false
  resolver: "skipped"      # if rule doesn't qualify for resolver sync
}
```

This is informational. Not an alarm, not a notification. The gardener checks `get_fence` when curious; the agent reads it during sunrise/recap.

### 3. Fence down = surfaces down

Clearing a fence must clear all surfaces, not just fences.json. Today `clear_fence` doesn't call `syncResolverFences`, so AdGuard rules linger until the next unrelated fence write. Wire it: fence up fans out, fence down fans out.

### 4. Graceful degradation record

When `syncResolverFences` finds AdGuard unreachable, log that fact to a sidecar file (`~/.zenborg/plugin/resolver-health.json`) with a timestamp. The health check in element 2 reads this file. No retry loop, no daemon -- just a record of the last attempt's outcome so `get_fence` can report it.

## Risks

**Rabbit holes:**

- **Schedule-wrapped cooldowns.** Dry watering hours wrap cooldowns inside `ScheduleSpec`. `collectResolverHosts` needs to unwrap through `schedule` to find the inner cooldown, same way `carriesExit` already does (Primitive.ts:237-247). Straightforward recursion, not a design question.
- **AdGuard schedule sync.** The AdGuard adapter has no schedule support -- it blocks or unblocks, full stop. Watering hours that are active only on certain days/hours would need AdGuard to block at window boundaries. **Park this for now:** sync the hosts that are standing (always-on) blocks; schedule-gated blocks are browser-only until a cron/daemon element is built (already called out in the AdGuard adapter pitch as its hardest element).
- **The www prefix.** `fences.json` carries both `chess.com` and `www.chess.com` as separate rules. `collectResolverHosts` should deduplicate or AdGuard gets both -- but AdGuard's `||chess.com^` already catches `www.chess.com`, so the redundancy is harmless. Don't over-engineer dedup.

**Off-sides:**

- **/etc/hosts writer.** A host-file adapter (sudo, deliberate friction) is a natural third surface. Not in this pitch. Stub the interface if the refactoring is free, but do not build the adapter.
- **cmux browser gate composition.** The cmux gate is a different mechanism (it gates the cmux browser surface, not DNS). Keep it as a standalone tool.
- **Per-device filtering.** AdGuard supports per-client blocking by MAC. Start with global rules; per-device is a later pitch.

**Domain knowledge:**

- AdGuard's `||host^` filter rule syntax already blocks subdomains (`||chess.com^` blocks `www.chess.com`). Verified in the adapter's existing test suite (adguard.test.ts).
- `syncResolverFences` is already best-effort: it catches errors and logs them, never throws (adguard.ts:232-254). The graceful-degradation record (element 4) extends this, does not replace it.
- The "one rule, one enforcement point" comment in hostBlock.ts is about delivery attribution for proximal outcomes, not about limiting which surfaces enforce a block. A resolver sync that mirrors standing browser blocks does not violate this -- it adds a surface, it does not split the delivery record.

## Acceptance

1. After declaring `set_watering_hours` with `mode: "dry"` and `restricts.hosts: ["youtube.com"]`, `collectResolverHosts` returns `youtube.com` in its set (unit test).
2. After declaring `set_host_block` for `chess.com` (default browser enforcement), `syncResolverFences` syncs `chess.com` to AdGuard (integration test against mock).
3. `clear_fence` on a host-block fence removes the host from AdGuard's filter rules on the next sync.
4. `get_fence` includes a `reach` field showing `{ browser: "extension", resolver: "synced" }` for a standing block when AdGuard is reachable.
5. `get_fence` shows `{ resolver: "unreachable" }` when AdGuard is down, and the fence still functions in the browser.
6. Schedule-wrapped cooldowns (dry watering hours) contribute their hosts to the resolver sync set.
7. No regression: browser-only fences (gates, transforms, regular watering hours) are unaffected.

---

_Drafted by Claude (scribe)._
