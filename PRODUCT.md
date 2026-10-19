# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The gardener:** one person tending their own life, alone, on their own machine. Today that is primarily the builder.
- **Soft-launch friends:** each installs the macOS app alone from a single link (`docs/pitches/2026-10-07-make-zenborg-shareable-for-the-soft-launch.md`).
- **The job:** answer, each day, "Where will I place my consciousness today?" Then, later, see where attention actually went.

## Product Purpose

Zenborg is an intention-cultivation garden. The gardener plants moments (1–3 word intentions) into a day and phase, drawn from habits that live in areas of life. The garden then reflects intention against footprints: where the gardener actually walked, read from local sensors and springs.

Success is fade-by-design. A gardener who internalizes the skill and stops needing the tool is a success, not churn.

## Positioning

Zenborg is defined by refusal. It is not a task manager, not a habit tracker, not a calendar. It never scores, streaks, pushes or curates. It is local-first and accountless: the vault is plain JSON on the gardener's disk, and an optional agent (MCP server and Claude Code plugin) reads the same vault.

## Operating Context

- **Desktop:** a macOS app (Tauri 2 wrapping a Next.js static export). The web build also stays live, using IndexedDB with no vault. Mobile is landscape-only.
- **Rituals and conversation:** an agent can open and close the day (`/sunrise`, `/sunset`). Rituals plant their habits when those skills run.
- **Ambient e-ink (idea, not committed):** a TRMNL OG (800×480, e-ink, roughly 15-minute refresh) on a self-hosted server could show one practice as a perennial plant, placed where the practice's anchor happens.
  - Personal first. It may later become an optional surface for gardeners who own a TRMNL.
  - **Undecided:** which self-hosted server, and how images reach it.

## Capabilities and Constraints

- **Vocabulary:** area (plot), habit (perennial), ritual, moment (a tending), cycle (season), phase, attitude, rhythm/health, footprints, spring, fence. Stamped in `docs/decisions/2026-09-25-garden-vocabulary.md`.
- **Vault rules:** one writer per collection; ids are UUIDs; time is UTC ISO-8601; order is explicit; fail soft; preserve unknown fields. Two implementations (Rust and TypeScript) pay for every shape change.
- **Health today:** `blooming / wilting / dormant`, derived from rhythm.
- **Red lines** (`docs/principles.md`): no completion checkboxes or done states, streaks, progress bars against targets, push notifications or badges, algorithmic curation, leaderboards or scoring, engagement-based revenue.
- **Permitted:** counting allocations as information ("3rd time"), neutral history ("2 days ago"), passive surfaces the gardener visits, ambient chips.
- **Suggestions are never auto-placed.** The allocation decision belongs to the gardener (principle 9, Downstream Allocation). Confirmed 2026-10-19: a practice the system plants by itself reads as an assignment.
- **Self-declared friction is allowed.** A pause or fence the gardener declares, and can take down, is a commitment, not an assignment.

## Brand Commitments

- The garden metaphor and its vocabulary, used consistently in user-facing copy: "tend", "set aside"; never "allocate".
- System marks are hand-drawn botanical glyphs. Emoji only for things the user chose.
- The org-wide design system `../DESIGN.md` is canonical for visual decisions.

## Evidence on Hand

- **The gardener's own vault** (`~/.zenborg`): moments, habits, cycles (which double as a place log) and activity logs from 2026-06-12. It never enters the repo.
- **Probe:** `.claude/attently/natural-seasons.md`. Practice and foreground pull trade places within a day. A planted sit happens 87% of the time. Long gaps between sits open at weekends and at place changes.
- **No testimonials, users or metrics beyond the builder's own data.** Do not fabricate any.

## Product Principles

1. **Sovereignty first:** local, inspectable, forkable, works offline.
2. **The gardener visits; the garden never calls.** Surfaces are peripheral and safe to ignore.
3. **Mirror, don't direct.** Show intention against footprints. Suggestions come only from what the gardener declared, and are never placed for them.
4. **Returning is the practice.** Gaps are seasons, not failures. Nothing resets to zero.
5. **Bounded and fading.** Every surface has a natural end, and the tool aims to be outgrown.
