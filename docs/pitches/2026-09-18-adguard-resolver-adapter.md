---
tag: pitch
appetite: medium
status: draft
source: "conversation: Pi 5 + AdGuard Home setup, 2026-09-18"
---

# Pitch -- AdGuard Home resolver adapter

**Bet:** Ship an infrastructure adapter that actuates resolver-enforcement fences against AdGuard Home's REST API, so `hostBlock` and `wateringHours` rules with `{ at: "resolver" }` actually block DNS on the Pi.

**Why it matters:** The domain already expresses resolver enforcement (`Primitive.ts:146`), but nothing writes it. Today a `resolver` fence is a description with no teeth. This adapter closes the loop: zenborg declares the policy, AdGuard enforces it on every paired device.

---

## Boundaries

**JBTD:** As a gardener who runs AdGuard Home on a local Pi, I want my standing fences and watering-hours policies to toggle DNS blocks automatically so I don't manage two systems by hand. Baseline today: log into `http://piaf.local`, manually block/unblock services, no schedule support.

**Out:**
- No AdGuard Home installation/provisioning (done by hand, already working)
- No router-level DHCP changes (per-device MAC config, already working)
- No remote/VPN fencing (WireGuard is a separate pitch)
- No new domain concepts -- the domain is complete; this is pure infrastructure

## Elements

- **Oracle registration** (`~/.zenborg/oracles.json`). Add `"adguard"` with base URL and credentials. The oracle-wizard pattern already exists for this. Skills resolve the oracle before calling.

- **Resolver adapter** (new: `mcp-server/adapters/adguard.ts`). Implements the actuation side of `CooldownEnforcement { at: "resolver" }`. Two operations: `block(hosts[], clientId?)` and `unblock(hosts[], clientId?)` via AdGuard's `/control/filtering/set_rules` or `/control/blocked_services/set` endpoints. Per-client filtering via AdGuard's persistent client API.

- **Fence actuation hook** (extend `mcp-server/fences.ts` or a new use-case). When `set_fence` / `set_watering_hours` writes a rule with resolver enforcement, the adapter is called to sync the block state to AdGuard. On `clear_fence`, the adapter lifts it.

- **Schedule daemon** (for watering-hours windows). A systemd timer on the Pi that reads `fences.json` from the vault (synced or SSH-mounted) and calls AdGuard's local API at window boundaries. Self-contained: survives reboots, no dependency on the Mac being awake. The `ScheduleSpec.window` already carries `fromHour`/`toHour`/`weekdays`. **Design decision:** the MCP server is stateless (spawned per-session), so it cannot own a long-running timer. The Pi is always-on, making it the natural home for the cron. This is the hardest element -- it introduces a second deployment target.

## Risks

**Rabbit holes:**
- AdGuard API auth: basic auth over HTTP on LAN is fine for a home Pi. Don't build OAuth.
- Per-client vs global blocking: AdGuard supports both. Start with global custom filtering rules scoped to the gardener's registered MAC clients. Don't build a client management UI.
- Vault sync to the Pi: don't build a sync protocol. Start with the MCP server writing to AdGuard directly on fence-set; the schedule daemon reads a simple JSON state file the adapter writes, not the full vault.

**Off-sides:**
- A full "ZenBox" product (pre-flash image, onboarding wizard, packaging) is a separate pitch.
- WireGuard for remote fencing is a separate pitch.

**Domain knowledge:**
- AdGuard Home REST API requires basic auth (username:password set during setup wizard). Verify the exact endpoints for per-client service blocking.
- The Pi must be reachable from wherever the MCP server runs (same LAN, or via tailscale/VPN later).

## Acceptance

1. `set_fence` with `mode: "dry"` and `restricts.hosts: ["youtube.com"]` blocks YouTube DNS resolution on registered devices (verified after flushing local DNS cache).
2. `clear_fence` on the same fence restores YouTube DNS resolution (verified after flushing local DNS cache).
3. `set_watering_hours` with `window: { fromHour: 13, toHour: 15 }` and `restricts.hosts: ["youtube.com"]` blocks YouTube outside 13:00-15:00 and unblocks it inside the window, automatically.
4. Fences with `enforcement: { at: "browser" }` (the default) are unaffected -- no regression.
5. AdGuard credentials stored in `oracles.json`, never in code or vault collections.

---

_Drafted by Claude (scribe)._
