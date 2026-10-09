# Work

What the gardener built and tracked: agent sessions by repo, commits, issues
and todos. One reading surface; today only the agent spring draws into the
activity log.

## Sources

| Source | Type | Probe method |
|--------|------|-------------|
| zenborg plugin (Claude Code hooks) | local log | `mcp__zenborg__get_footprints` → `work`; raw: `~/.zenborg/log/<day>.agent.jsonl` |
| git | CLI | `git log --since=<date> --format='%H %aI %s' -- <repo>` across workspace (no spring yet) |
| linear | MCP | `mcp__claude_ai_Linear__list_issues`, `mcp__claude_ai_Linear__list_projects` (no spring yet) |
| things | MCP | `mcp__things-mcp__get_today`, `mcp__things-mcp__get_inbox`, `mcp__things-mcp__get_areas` (no spring yet) |

Git and Linear springs that write `log/<day>.git.jsonl` and
`log/<day>.linear.jsonl` are pitch slice 6. Until then `get_footprints` reads
work from agent sessions only.

## Key fields

### `get_footprints` → `footprints[surface="work"]`

- `thisWeek.byArea[]` / `lastWeek.byArea[]` — minutes per area, from human
  `prompt` events resolved by `cwd` (or the touched file) against the areas'
  `surfaces.paths`. Each prompt dwells until the next human event, capped at
  5 min.
- `thisWeek.unmapped[]` / `lastWeek.unmapped[]` — cwds no area path claims.
- `thisWeek.coverage` / `lastWeek.coverage` — `{ seenHours, idleCreditedMin,
  unmappedMin }`; `seenHours` is the union of the agent spans traced.

### Git log

- `commitHash`, `authorDate` (ISO), `subject` — per commit
- `repo` — derived from which `.git` dir the log came from

### Linear

- `list_issues` — id, title, state (name + type), priority, assignee, dueDate, project
- `list_projects` — id, name, state, lead, targetDate

### Things

- `get_today` — title, notes, tags, project, dueDate, checklistItems
- `get_inbox` — uncategorized captures waiting for processing
- `get_areas` — area name, active projects count

## Noise (skip on probe)

- Prompts, tool inputs and outputs — never surfaced (privacy tier: cwd + timing)
- Full commit diffs — capture stats only (`--stat`)
- Linear issue descriptions and comments; Things internal UUIDs

## Gotchas

- The last prompt of a run adds 0 min: only a following human event bounds it.
- Agent work overlaps screen time (the terminal is in front); never add the two.
- Git log across `~/Developer/*/*/.git` must filter out `.claude/worktrees/`;
  dedup by commit hash.
- Linear is Themia work; a future Linear spring writes ids and state changes
  only, never titles. Things is personal captures.
- zenborg issues go to GitHub Issues (`gh issue create`), not Linear or Things.
