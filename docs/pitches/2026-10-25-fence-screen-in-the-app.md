---
tag: pitch
appetite: medium
status: draft
source: "equanimitech/zenborg#216 (soft launch is soon, confirmed 2026-10-25)"
slice_id: A
---

# Pitch -- A fence screen in the app: see, pause, clear, fence a site

**Bet:** the Cultivate tab lists every fence with what, when and why, pauses or clears any of them inline, and fences one site, with no Claude. The fence logic already lives in `src/application`; the app only needs a store for `fences.json`.

**Why it matters:** the landing page promises Fence, and a friend without Claude can't see, stop or make one. A boundary you can't see or switch off breaks Holistic Control.

---

## Boundaries

**JBTD:** As a gardener who uses only the app, when a site keeps pulling me in (or a fence I forgot about blocks me), I want to see, pause and set fences in the garden, so that I stay the one who decides. Baseline today: fences are set, seen and cleared only through Claude; nothing under `src/` renders `fences.json`.

**Out:**
- Authoring watering hours, gates, transforms, ladders, openings or passes in the app. They show and pause like any fence, but are declared through Claude.
- DNS/resolver enforcement. The resolver path is dead (#246).
- Editing a fence in place. Clear it and fence again.
- Crossing counts as a score. "Crossed 3 times" is information, never a streak (`docs/principles.md:134`).
- The web runtime. It has no vault; the screen is Tauri-only.
- The extension install flow (Web Store comes next cycle, `docs/plans/2026-09-23-soft-launch.md`).

## Elements

- **Tauri fence store** (`src-tauri/src/vault/fs.rs:47`, `src/application/ports.ts:112`). Add `fences` to `ALLOWED_COLLECTIONS` and write a `FenceStorePort` adapter over `vault_read_collection` / `vault_write_collection`. Rust stays shape-blind: a string in, a string out. Move the merge that keeps openings and the pass allowance (`mcp-server/fences.ts:81`) into `src/` so both adapters share it. Ownership doesn't change: the app and the MCP server are both zenborg, as with every other collection.
- **Fences on Cultivate** (`src/app/cultivate/page.tsx`). One section listing `fenceReport` (`src/application/use-cases/fences.ts:1078`): what it fences (hosts or scope), when (window or "always"), why (its description and the season it serves), paused or standing. Stone tones; area colour only when the rule is scoped to an area. The watcher already maps `fences.json` once it's allowed (`fs.rs:155`); route that event to this section, not the domain store.
- **Pause, resume, clear inline** (`fences.ts:976` `setFencesEnabled`, `fences.ts:1034` `clearFences`). Pause is the first action because the boundary can come back; clear sits behind an inline confirm row, no modal. Every reader already skips a paused fence (6617696).
- **Fence a site** (`fences.ts:653` `declareHostBlock`, browser only). One inline row: host, then "always" or "from HH:MM to HH:MM". Problems print all at once, as `validateRuleSpec` does. Lens: BCT 12.3 *avoidance / reducing exposure to cues*, declared by the gardener, never suggested by the app.
- **Who enforces this** (`log/*.browser.jsonl`). Each row says where it bites, from the latest browser footprint: "enforced in the browser, seen 2 min ago", or "nothing enforces this yet: the extension isn't installed". A fence that enforces nothing must say so.

## Risks

**Rabbit holes:**
- The app and the MCP server both read-modify-write `fences.json`; last write wins. Write fences immediately, not through the 2 s debounce.
- Live refresh rides on the watcher. The MCP writes via temp file + rename (`mcp-server/fences.ts:96`), which is a suspect in #208. Land #208 first or verify the event fires.

**Off-sides:** friends will ask to edit a schedule, use a pass, or set watering hours from the app. Each is its own pitch once someone hits it ("fix only what a real person hit").

**Fat cut:** a typed Rust fence struct. It would make Rust learn a shape TypeScript already owns, and pay twice for every rule change.

**Domain knowledge:**
- CLAUDE.md's vault list omits `fences.json`, and the parity test (`src/infrastructure/vault/__tests__/collections-sync.test.ts`) may force a decision: declare it a kernel root collection outside the domain store, like `activeMoment`.
- #246 should land first, so the app never offers `at: "resolver"`.

## Acceptance

1. With fences declared through the MCP, Cultivate lists every rule with what, when and why; openings and the pass allowance are not listed, and survive any app write (unit test on the shared merge).
2. Pausing in the app sets `defaultEnabled: false` in `fences.json`, and the extension stops enforcing on its next sync; resuming reverses it.
3. Clearing removes exactly that record; every other record is unchanged.
4. "Fence a site" with `youtube.com`, 16:00 to 23:00, produces a browser host block the extension enforces, with no Claude involved.
5. A fence declared through the MCP while the app is open appears without a reload.
6. With no browser footprint in the last 7 days, every row says nothing enforces it.
7. Stone tones or area colour only, inline editing, no modals; covered by one Tauri e2e test (`e2e/*.tauri.spec.ts`).

---

_Drafted by Claude (scribe)._
