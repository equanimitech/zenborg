---
tag: pitch
appetite: small
status: draft
source: "docs/pitches/2026-09-18-adguard-resolver-adapter.md (parked scope)"
---

# Pitch -- WireGuard tunnel for off-LAN resolver fences

**Bet:** Route device DNS through a WireGuard tunnel back to piaf so resolver fences hold off the home network -- via Tailscale, not raw WireGuard.

**Why it matters:** The AdGuard adapter shipped (850b522). Resolver fences block DNS on every LAN device. Leave the house and fences go silent: the phone falls back to carrier DNS, the laptop to coffee-shop DNS. This closes that gap with zero zenborg code changes.

---

## Boundaries

**JBTD:** As a gardener who declared resolver fences at home, I want those fences to hold when I leave the house so a fence set at 8am still blocks at noon from a cafe. Baseline today: resolver fences work on-LAN only; off-LAN, the declared policy has no enforcement surface.

**Out:**
- No zenborg code changes (the adapter already works; this is network infrastructure)
- No "ZenBox" product (pre-flash image, onboarding wizard, packaging)
- No tunnel-status UI in the app (browser fences hold regardless; resolver reach is best-effort)
- No full-tunnel VPN (only DNS routes through the Pi, not all traffic)
- No cloud DNS fallback (e.g. NextDNS when tunnel drops -- adds a dependency to the enforcement path, violates sovereignty)

## Elements

- **Tailscale on piaf.** Install the Tailscale client on the Pi and register it on the tailnet. AdGuard Home already listens on `:53`. Configure Tailscale's admin console to set the Pi's Tailscale IP as the tailnet's DNS nameserver. One install, one admin-panel toggle.

- **DNS-only routing, not exit node.** Split DNS: only DNS queries route through the Pi, not all traffic. Avoids pushing web traffic through a residential uplink, keeps battery impact minimal, and sidesteps latency from hairpinning. Tailscale's `--accept-routes` + admin-console nameserver config handles this without manual WireGuard configs.

- **Always-on VPN on each device.** iOS: Settings > VPN > Tailscale > Connect On Demand. macOS: Tailscale menubar > "Connect on login." WireGuard is kernel-level on both platforms -- DNS-only tunneling draws negligible battery. Each device needs the Tailscale client installed once.

- **Env var update.** Point `ADGUARD_URL` to the Pi's stable Tailscale IP (`100.x.y.z`) or MagicDNS hostname (`piaf`) instead of `http://piaf.local`, so `syncResolverFences` reaches AdGuard from off-LAN too (`mcp-server/adapters/adguard.ts:151`).

## Risks

**Rabbit holes:**
- Tailscale vs raw WireGuard: Tailscale. Raw WireGuard means port forwarding, DDNS, manual key rotation -- ongoing maintenance for solved problems. Tailscale's free tier (100 devices, 3 users) covers this use case. The data path is P2P WireGuard; only key exchange uses Tailscale's coordination server.
- Full exit node vs DNS-only: DNS-only. Full exit node routes all traffic through a residential uplink, kills battery, and adds latency for zero fence benefit.

**Off-sides:**
- A tunnel-health indicator in the zenborg UI. The adapter already degrades gracefully: `checkReachable()` returns false, sync skips silently (`mcp-server/adapters/adguard.ts:237-239`). Browser fences hold regardless.
- Automatic fence escalation (resolver down, so promote to device-level). Separate pitch if needed.

**Domain knowledge:**
- iOS "Connect On Demand" keeps the tunnel alive across network transitions (wifi to cellular). Verify battery impact over one week before relying on it.
- Tailscale's coordination server is a cloud dependency for key exchange only, not the data path. Existing tunnels survive a Tailscale outage. Sovereignty cost is acceptable: the enforcement path (DNS through the Pi) stays sovereign.

## Acceptance

1. Phone on cellular data resolves a fenced host through AdGuard Home (verified via AdGuard query log showing the phone's Tailscale IP as client).
2. Laptop on coffee-shop wifi with an active resolver fence cannot resolve a fenced host (verified after DNS cache flush).
3. Tailscale stopped on a device: fenced host resolves normally (graceful degradation, no crash, no error surfaced to the user). Browser-level fences still block.
4. `syncResolverFences` reaches AdGuard from the Mac off-LAN via Tailscale IP (the Mac runs Tailscale too).
5. No regression: on-LAN resolver fences continue to work with the updated `ADGUARD_URL`.

---

_Drafted by Claude (scribe)._
