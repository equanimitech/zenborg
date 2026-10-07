# Expo mobile client + device sync

- Build a mobile client with Expo, inspired by the enurgy monorepo shape (`apps/mobile` + `apps/desktop` + `packages/`, pnpm workspaces, `eas.json`).
- Foundations are mostly in place: `src/domain` is pure TS and Legend State runs in React Native (MMKV/AsyncStorage persist plugins). Tauri coupling is confined to `src/infrastructure/vault/adapter.ts` — mobile just supplies a third adapter.
- Three gaps: (1) extract domain + store into a shared workspace package; (2) sync backend — none exists today, vault is local JSON in `~/.zenborg`; (3) mobile UI is a rewrite (Radix/Tailwind/dnd-kit don't port; landscape-only UX is a different design anyway).
- Sync lean: Legend State `sync-supabase` plugin over a hand-rolled Next API — CLAUDE.md Phase 2 already names Supabase + last-write-wins, entities are PostgreSQL-ready, and enurgy's `packages/supabase` is crib material.
- Questions:
  - Supabase cloud dependency vs local-first/sovereignty principle — self-host, or cloud sync as strictly optional-and-additive?
  - Is a PWA against a hosted Next instance a lazier first step than a full Expo app?

Don't shape yet.

---

## Note 2026-07-02 — this is the Sail's reach, and it's the real blocker

Framed against `torchbearer/docs/2026-05-31-the-boat.md`: zenborg is the **Sail**, but it's the one part not on the shared **hull** (git-resident markdown reachable from any device / claude.ai) — keel, secretariat, penceive all are; the Sail hides its state in a local Tauri JSON vault (`~/.zenborg`). That asymmetry *is* this idea. Felt acutely on the Marseille trip (2026-06-30 → 07-02): couldn't trim the Sail with no laptop, while calendar and Garmin — cloud-reachable — were fine. Reach is **upstream** of the integration work (`2026-05-31-connect-prompts-to-habits.md`): no point wiring a habit to Garmin if you can't reach the ritual that reads it. Still: don't shape yet.
