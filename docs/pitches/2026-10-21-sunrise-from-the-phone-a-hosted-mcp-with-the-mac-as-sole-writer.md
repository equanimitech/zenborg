---
tag: pitch
appetite: medium
status: draft
source: "Rafa, 2026-10-21: I need to do sunrise/sunset (planning out moments for the day) from my phone. Working notes in .claude/attently/phone-planning.md"
supersedes: []
related:
  - ../decisions/2026-08-06-reach-via-snapshot-and-intent-queue.md
  - 2026-08-07-the-relay-a-phone-can-plant-into-the-garden.md
  - 2026-08-07-the-mirror-a-phone-can-see-the-garden.md
hard_dependency: "Host decision (piaf + Cloudflare Tunnel, or a paid host). One call, see Risks."
slice_id: R
---

# Pitch -- Sunrise from the phone: a hosted MCP with the Mac as sole writer

> **Parked 2026-10-21.** A personal tool, not product: it serves one gardener and competes with the soft-launch question due 2026-10-23. Revisit after that decision. If built, the host becomes piaf + Tailscale (the private network for Mac sync, Funnel for the public connector), replacing Cloudflare Tunnel and the VPS alternative.

**Bet:** Run the existing `mcp-server` on piaf over Streamable HTTP, against a snapshot the Mac pushes, with every write tool turned into a queued intent. The Claude iOS app adds it as a custom connector; `/sunrise` and `/sunset` run as conversations against it. The Mac drains the queue when it wakes.

**Why it matters:** Planning the day happens at its edges, in bed or on the way out, when the Mac is asleep or elsewhere. Today that means no planning. This builds the reach decision as designed, with no new UI, no second writer, and no fork of the domain.

---

## Boundaries

**JBTD:** As the gardener, when it is sunrise or sunset and the Mac is asleep or not with me, I want to open Claude on my phone and plan today's or tomorrow's moments so that the board is set before the day starts. Baseline today: I wait for the Mac, or I don't plan.

**Out:**
- A native or Expo app. The mirror pitch's UI half is superseded for planning; the conversation is the interface.
- A server-side replica, CRDT, or merge. One writer: the Mac (`docs/decisions/2026-08-06-reach-via-snapshot-and-intent-queue.md`).
- Live writes. Phone writes are queued until the Mac wakes; the price was accepted in the same decision.
- Any Next API route or Vercel surface. #211 removed `src/app/api`; the app is a static export with nothing hosted.
- Push notifications, badges, reminders to plan. Red lines (`docs/principles.md`).

## Elements

- **`createServer()` + `serve-http.ts`** (`mcp-server/index.ts:240`, `:4323`). Lift the `McpServer` build out of the stdio entry so a second entry can `connect` a `StreamableHTTPServerTransport` (SDK 1.29 ships it) behind express and `mcpAuthRouter`. Auth is a file-backed `OAuthServerProvider` with one client, one `/authorize` page that asks for a passphrase, and tokens in a JSON file on piaf. claude.ai connectors speak OAuth or nothing; a static bearer is not an option.

- **Intent capture in `defineTool`** (`mcp-server/tooling.ts:48`). When `ZENBORG_INTENT_DIR` is set and the tool lacks `readOnlyHint`, zod validates as usual, then the wrapper writes `intents/<ts>-<uuid>.json` as `{ tool, params }` and returns `{ queued: true, intentId, pending: N }` without running the handler. Read tools run unchanged against the snapshot and add `snapshotAt`. One new read tool, `list_pending_intents`, returns the queue and anything in `intents/failed/`. That is the "N pending, not yet applied" the phone needs.

- **Snapshot push and drain, one job** (`mcp-server/drain.ts`, new; `~/.zenborg/jobs.json`). An interval job in the daemon (`docs/2026-10-05-zenborg-jobs-run-in-the-daemon.md`) runs a script: `rsync` the eight collections to `piaf:~/.zenborg-mirror`, `rsync` the intents down, move each file to `applied/` before replay, replay through `mcp-server` as an MCP client over stdio, write failures to `failed/` with the error, delete the drained files on piaf, push again. Move-then-replay makes a crash lose at most one intent, never duplicate one. The same zod schemas validate the replay as validate Claude.

- **Sunrise and sunset as MCP prompts** (`plugin/skills/sunrise/SKILL.md:31`, `plugin/skills/sunset/SKILL.md`). Claude iOS does not load plugins, so the hosted server registers both skill bodies with `registerPrompt`, read from the plugin files at start. The ritual is the same text on both doors. Behavioral lever: action planning (BCT 1.4) moved to the environment where the cue fires; the phone is already in hand at both edges of the day, so the restructuring is of the setting, not the habit.

- **Host: piaf behind Cloudflare Tunnel** (`.claude/attently/piaf-repurpose.md`). A systemd unit runs `serve-http.ts` with `ZENBORG_HOME=~/.zenborg-mirror`; `cloudflared` publishes it at one HTTPS hostname. Anthropic's servers call the connector, so the endpoint must be public; the tunnel is the only infra piece and costs nothing. Add the connector in Claude iOS, sign in once with the passphrase.

## Risks

**Rabbit holes:**
- A real OAuth provider: DCR for many clients, refresh rotation, PKCE edge cases. One client, one user, tokens that live a month. Rotate by deleting the file.
- Applying intents to the mirror so the phone sees its own plants mid-conversation. That is a second writer in miniature. The LLM holds the pending list; `list_pending_intents` is the mirror.
- Drain latency. The daemon's 60 s floor is the floor; a 5 min interval is the whole requirement.
- Reaching piaf from away. On the LAN rsync just works. Off-LAN the job fails soft and retries at home. Tailscale is one install when that ceiling bites, not code.

**Off-sides:**
- `/tend` from the phone (same server, free once this ships), `/weather`, the body report. Not this bet.
- Startup migrations that write (`mcp-server/index.ts:4311`). The mirror is overwritten by `rsync --delete` on the next push, so a stray write is harmless, but the hosted entry should skip them.
- #111 (MCP reachable outside the project) and #230 (two installs, two versions) both get lighter once the server has a second entry; neither is built here.

**Fat cut:**
- Vercel, Upstash, Blob. `@upstash/redis` is still in `package.json` with no caller; drop it. The server reads a filesystem vault (`mcp-server/vault.ts:441`); a serverless host would mean reimplementing `readCollection` over KV, which is the domain fork this pitch refuses.
- A separate `GET /intents` + `PUT /snapshot` API with its own bearer for the Mac. rsync over SSH is the same thing with no code.

**Domain knowledge:**
- **The host is the one decision.** Recommendation: piaf + Cloudflare Tunnel. It keeps the vault a filesystem, keeps the server one codebase, and is already the always-on home for Claude jobs. The alternative is a small VPS (Fly, Hetzner) running the identical unit; same code, a monthly bill, no LAN rsync. Decide before the build starts.
- claude.ai custom connectors require OAuth (DCR or a manually entered client id/secret). Verify on the connector form before writing the provider; if DCR is mandatory the provider must answer `/register` for one client.
- `materialize_routine` is a write and will queue. Sunrise step 0 reports "queued" instead of "planted"; the board it reads next will not show the routine. The prompt text must say so.
- Synthetic vault for every test (`pnpm test:e2e` already seeds one). Never point the hosted server at `~/.zenborg` itself.

## Acceptance

1. With the Mac asleep, Claude iOS lists the zenborg tools through the connector, and `list_moments` for today returns the snapshot with `snapshotAt`.
2. `add_moment` from the phone returns `{ queued: true, intentId, pending: N }`; no file under `~/.zenborg-mirror` changes.
3. `list_pending_intents` shows that intent with its tool name and params; after a second plant it shows two.
4. Within one job interval of the Mac waking at home, both moments exist in `~/.zenborg/moments.json`, the queue on piaf is empty, and the phone's next `list_moments` shows them with `pending: 0`.
5. An intent that fails zod or the handler at drain lands in `intents/failed/` with its error, and `list_pending_intents` reports it as failed.
6. Running the drain twice applies each intent once.
7. An unauthenticated POST to the MCP URL returns 401. The unit on piaf restarts on reboot.
8. `/sunrise` appears as a connector prompt in Claude iOS and runs the plugin's sequence, including the yesterday-and-today board read.
9. The reach decision is amended in one line: storage is a filesystem mirror on piaf, not Vercel Blob.

---

_Related: the relay (2026-08-07) and the mirror (2026-08-07) were the Shortcut and Expo halves of the same decision; this pitch replaces both for planning. Drafted by Claude (scribe)._
