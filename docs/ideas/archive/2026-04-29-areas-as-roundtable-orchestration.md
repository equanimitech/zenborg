# Areas as roundtable orchestration

Raw capture — 2026-04-29.
**→ Pitched 2026-04-29:** [`docs/pitches/areas-as-orchestration-layer.md`](../pitches/areas-as-orchestration-layer.md)

- Extend `Area` schema with `repoPaths: string[]` and `domainNames: string[]` (or similar) so areas become the orchestration layer for cross-project triage (the `/roundtable` skill).
- Not 1:1 area↔repo. One area can fan out to many repos.
  - **Themia** (⚖️, `tags: [work, craft]`) → `~/Developer/themia`, `~/Developer/themia/leggia`, `~/Developer/themia/minerva`, `~/Developer/themia/openoutreach`
  - **Torchbearer** (🗽, `tags: [purpose, spike]`) → equanimitech repos? `~/Developer/equanimitech/zenborg`, `~/Developer/equanimitech/equanimi` — confirm naming
  - Need to clarify: does "Torchbearer" mean equanimitech, or is that a separate area to add?
- `domainNames` could capture web domains the area governs (themia.pro, equanimi.tech, zenborg.app, etc.) — useful for routing other tools (analytics, posthog, etc.) by area.
- Roundtable then reads areas via zenborg MCP, walks each `repoPath/docs/{ideas,pain}` per area, aggregates. Replaces `~/.claude/roundtable/projects.json`.
- Pitches written back into the source repo's `docs/pitches/` (already in skill).
- Possible bonus: `wilting habits` per area → already a friction signal zenborg tracks. Could feed pain candidates without writing markdown.
- Open questions:
  - Schema: optional fields on `Area`, or a separate `AreaContext` entity (dev-tooling concerns separate from the intention/cultivation core)?
  - Does this violate Zenborg principles (red lines)? Areas are life domains; adding repoPaths feels orthogonal but not extractive — purely informational, doesn't show up in UI, doesn't drive notifications.
  - Where does the "global" scope (`~/.claude/ideas`) live? A pseudo-area? Or kept outside the area system?
  - r4tb area (🎨 craft) — what's that for? Does it need a repoPath too?
  - Migration: backfill repoPaths from current `projects.json` once schema lands.
- **Update — 2026-04-29 (later):** r4tb = equanimitech repos, each habit owns its own repo. So area→repos is many-to-many at the habit level: an `r4tb` area's *habits* each map to a repo (zenborg, equanimi, …) rather than the area itself owning a flat list. Implication: `repoPaths` may belong on **Habit** as well as / instead of **Area**.
- **Bigger frame: areas as bounded context.** Area = bounded context (DDD). Owns: repos, domains, agents, principles refs, vocabulary. Moment within area auto-activates that context's agents (e.g. opening a Themia moment loads themia-copywriting + sentry + posthog scoped to themia project; r4tb moment loads zenborg/equanimi-specific agents).
- Mechanism sketch:
  - `Area.context = { repoPaths?, domainNames?, agentIds?, mcpScopes?, principlesPath? }`
  - `Habit.repoPath?` (overrides area, when habit owns one repo — r4tb case)
  - When a moment becomes "current" (timeline focus), zenborg emits a context activation event → CC harness picks it up → activates matching agents/MCPs.
- Open questions (additional):
  - How does CC actually receive activation? Hook reading zenborg state? Local file the harness watches? MCP call?
  - Agents per area vs per habit — granularity. r4tb suggests habit-level wins for repo-bound work.
  - Does this turn zenborg from intention-cultivation into IDE control plane? Risk of scope creep — flag for principles review.
  - Inverse direction: agent activity (commits, PRs) feeds zenborg signals (wilting habit detection, "moment in progress" inference).
- **Update — 2026-04-29 (alignment with Things3):** eventually fully align zenborg areas with Things3 areas. **Zenborg controls** — it's the canonical store of life-domain context (repos, agents, MCPs, principles, attitude). Things3 mirrors zenborg's areas as a downstream view, not the other way round. Cross-ref `~/.claude/ideas/2026-04-29-things3-to-filesystem-sync.md` — once the sync exists, the Things3 areas list is generated *from* zenborg areas (write direction: zenborg → Things3, possibly via Things3 URL scheme `things:///add-project?area=...`). Reverse direction (Things3 area drift back into zenborg) is rejected — that's where Things3 becomes the orchestrator and we lose principle alignment.
- Don't shape yet.
