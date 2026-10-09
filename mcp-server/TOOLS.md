# Zenborg MCP — Tool Inventory

**Version:** 0.4.0 (implemented)
**Tools:** 52 active + 19 deprecated wrappers (removed in 0.5.0)

---

## Vault

Collections are JSON keyed by UUID at `~/.zenborg` (release) / `~/.zenborg-dev` (debug).
Resolution: `--vault` → `$ZENBORG_HOME` → `$KAIROS_HOME` → `~/.zenborg`.

---

## Surface-wide conventions

### `response_format`

Every tool accepts `response_format: "concise" | "full"` (default `"concise"`).

- **Concise** omits timestamps (`createdAt`/`updatedAt`), `isDefault`, `order`, null-valued keys, and empty arrays. Writes echo `{ id, name }` + changed/derived fields only.
- **Full** returns the complete stored record.

### Annotations

All tools carry `openWorldHint: false` (local vault, no network). Read tools carry `readOnlyHint: true`. Hard deletes and cascades carry `destructiveHint: true`.

### Pagination

`list_moments` and `list_habits` are paginated:

```
limit:  number (1–200, default 50)
cursor: string (opaque, from previous response)
```

Response envelope: `{ items, total, truncated, nextCursor }`.
When `truncated` is true, pass `nextCursor` back with the same filters.

---

## Read/write boundary

### Read-side (safe to call freely)

`list_areas` · `get_area` · `list_habits` · `get_habit` · `list_moments` · `get_moment` · `list_cycles` · `get_cycle` · `get_running_cycle` · `get_cycle_planning_proposals` · `get_cycle_review` · `list_people` · `get_person` · `list_places` · `get_place` · `list_relationships` · `list_people_to_reach` · `list_phase_configs` · `list_tags` · `get_tag_profile` · `get_active_moment` · `search` · `get_fence`

### Write-side (require user authorization)

`create_area` · `update_area` · `delete_area` · `create_habit` · `update_habit` · `add_moment` · `update_moment` · `delete_moment` · `unallocate_moment` · `mention` · `plan_cycle` · `update_cycle` · `delete_cycle` · `create_person` · `update_person` · `delete_person` · `create_place` · `update_place` · `delete_place` · `create_relationship` · `delete_relationship` · `set_active_moment` · `update_phase_config` · `set_fence` · `set_host_block` · `set_browser_gate` · `set_browser_transform` · `seed_host_blocks` · `clear_fence` · `declare_drift`

---

## Tools by category

### Areas

| Tool | Key params | Notes |
|---|---|---|
| `list_areas` | `includeArchived?` | Sorted by `order`. |
| `get_area` | `idOrName` | By id or exact name. |
| `create_area` | `name, color, emoji, order` | |
| `update_area` | `idOrName, ...fields, archived?` | `archived: true/false` replaces archive/unarchive. |
| `delete_area` | `idOrName` | Must be archived + momentless. `destructiveHint`. |

### Habits

| Tool | Key params | Notes |
|---|---|---|
| `list_habits` | `areaId?, includeArchived?, health?, limit?, cursor?` | Paginated. `health: "wilting"` filters to wilting habits. |
| `get_habit` | `idOrName` | Includes `health`, `daysSinceLast`, `effectiveRhythm` in response. |
| `create_habit` | `name, areaId, order, ...` | Name 1–3 words. `schedule` fills `rhythm`+`phase`. `schedule.timezone` is an optional IANA zone: absent = floating, present = anchored to a fixed instant. |
| `update_habit` | `id, ...fields, archived?` | `archived: true` cascades: deletes cycle plans, preserves moments. A `schedule` rewrite that omits `timezone` keeps the stored anchor; `schedule.timezone: null` unanchors. |

### Moments

| Tool | Key params | Notes |
|---|---|---|
| `add_moment` | `habitId?, name?, areaId?, day?, phase?, fromPlan?, ...` | **The one creation path.** `habitId` → inherit from habit. `day` → allocate. `fromPlan: true` → link to cycle budget. Reports `dayViewOverflow` past 3. |
| `update_moment` | `id, day?, order?, phase?, ...` | `day` allocates/moves. `day: null` returns spontaneous moments to drawing board (refuses plan-linked — use `unallocate_moment`). |
| `list_moments` | `filter?, limit?, cursor?` | Paginated. Filter: `areaId, habitId, cycleId, day, phase, allocation, tags`. |
| `get_moment` | `id` | |
| `delete_moment` | `id` | `destructiveHint`. |
| `unallocate_moment` | `id` | Deletes plan-linked moment row; deck ghost reappears. Refuses spontaneous (use `delete_moment`). |
| `mention` | `momentId, entities[]` | Resolve names against people+places registries, additive attach. |

### Active moment

| Tool | Key params | Notes |
|---|---|---|
| `set_active_moment` | `momentIdOrName` | By id or name on today's board. Pass `null` to clear. Keel reads this pointer. |
| `get_active_moment` | — | Resolved to moment+area. Reports `stale` when deleted/off-day. |

### Cycles

| Tool | Key params | Notes |
|---|---|---|
| `list_cycles` | `filter?` | `"active"/"current"/"upcoming"/"all"`. |
| `get_cycle` | `idOrName` | |
| `get_running_cycle` | — | Orientation snapshot: active cycle + per-habit health + wilting list. |
| `get_cycle_planning_proposals` | `cycleId` | Attitude + rhythm + health proposals. |
| `get_cycle_review` | `cycleId` | Descriptive review — no aggregate scores. |
| `plan_cycle` | `name, template?, startDate?, endDate?, ...` | `template: "week"/"month"/"quarter"` computes endDate (7/28/90 days). Pass template OR endDate. |
| `update_cycle` | `id, ...fields` | Set `endDate` to close a cycle. `reflection` stamps `reflectionSource: "machine"`. |
| `delete_cycle` | `id` | Cascades: deletes all moments + plans. `destructiveHint`. |

### People

| Tool | Key params | Notes |
|---|---|---|
| `list_people` | `status?, category?` | |
| `get_person` | `idOrKey` | |
| `create_person` | `name, cadence?, category?, ...` | `key` derived from name via slugify. |
| `update_person` | `idOrKey, ...fields` | |
| `delete_person` | `idOrKey` | Does not remove key from existing moments. `destructiveHint`. |
| `list_people_to_reach` | `category?, limit?, far?` | Outreach queue ordered by `overdueRatio`. |

### Places

| Tool | Key params | Notes |
|---|---|---|
| `list_places` | — | |
| `get_place` | `idOrKey` | |
| `create_place` | `name, parentKey?, address?, coordinates?, ...` | |
| `update_place` | `idOrKey, ...fields` | |
| `delete_place` | `idOrKey` | `destructiveHint`. |

### Relationships

| Tool | Key params | Notes |
|---|---|---|
| `list_relationships` | `entityType?, entityId?, label?` | Filter by entity or label. |
| `create_relationship` | `fromType, fromId, toType, toId, label` | `direction` defaults to `"mutual"`. |
| `delete_relationship` | `id` | `destructiveHint`. |

### Search

| Tool | Key params | Notes |
|---|---|---|
| `search` | `type, query, areaId?, includeArchived?` | `type: "habit"/"person"/"place"`. Fuzzy match ranked by confidence. |

### Tags (derived, read-only)

| Tool | Key params | Notes |
|---|---|---|
| `list_tags` | `prefix?` | Every tag in use with counts + first/last day. |
| `get_tag_profile` | `tag` | Tag's graph neighbourhood: habits, areas, co-tags, sample. |

### Phases

| Tool | Key params | Notes |
|---|---|---|
| `list_phase_configs` | — | 4 rows, sorted by order. |
| `update_phase_config` | `id, ...fields` | Configs are seeded; update only. |

### Fences (8 tools)

| Tool | Key params | Notes |
|---|---|---|
| `set_fence` | `label, paths, areas` | Session fence: "only this stream". |
| `set_host_block` | `host, returnsTo, unlockNote` | Standing block on a host. |
| `set_browser_gate` | `host, returnsTo, everyMinutes, prompt` | Recurring dwell-time cue. |
| `set_browser_transform` | `host, selectors, returnsTo` | DOM transform (hide/restyle). |
| `seed_host_blocks` | `returnsTo, unlockNote, hosts` | Batch blocklist. Idempotent. |
| `clear_fence` | `id` or `all` | Take fences down. `destructiveHint`. |
| `get_fence` | — | Standing fences with crossing tallies. |
| `declare_drift` | `distance, reason` | Name a departure from the session fence; the fence hook reads it. Ack only. |

### Footprints (read-only, from the activity log)

| Tool | Key params | Notes |
|---|---|---|
| `get_footprints` | `day?` or `from?, to?` | The week read back (Monday → Sunday, days roll at 04:00): board per day/phase, planted per area (this week + last), footprints per surface by area in minutes with coverage `{ seenHours, idleCreditedMin, unmappedMin }`, wilting habits. Work also carries `counts`: commits (git) and issues moved (Linear), never minutes. Journal and comms, and a counted spring with no line, read `"not drawn"`. No ratios. Replaced `get_attention` and `get_day_trace`. |
| `get_body` | `day?` or `from?, to?` | Garmin nights and workouts. |
| `get_area_map` | — | Path, host and app rules that resolve footprints to areas. |
| `map_area` | `kind, key, area` | Add or remove one rule. `area: null` removes. |

---

## Migration from 0.3.0

19 tools are deprecated. They still work (thin wrappers over new code paths) and will be removed in 0.5.0 after the transcript-verified gate.

| Deprecated | Use instead |
|---|---|
| `create_moment`, `create_standalone_moment`, `spawn_spontaneous_from_habit`, `allocate_from_plan` | `add_moment` |
| `allocate_moment` | `update_moment { day }` |
| `quick_create_cycle` | `plan_cycle { template }` |
| `archive_area` / `unarchive_area` | `update_area { archived }` |
| `archive_habit` / `unarchive_habit` | `update_habit { archived }` |
| `get_habit_health` | `get_habit` (health in response) |
| `list_wilting_habits` | `list_habits { health: "wilting" }` |
| `clear_active_moment` | `set_active_moment { momentIdOrName: null }` |
| `end_cycle` | `update_cycle { endDate }` |
| `search_habits` / `search_people` / `search_places` | `search { type }` |
| `get_related` | `list_relationships { entityType, entityId }` |
| `get_related_habits` | `get_tag_profile` (related habits in response) |

---

## Habit schedules — `timezone`

Optional IANA identifier — `"America/Sao_Paulo"`, `"Europe/Paris"`, or bare `"UTC"`.

- **Absent = floating.** `"09:00"` means nine in the morning wherever you are. Right for a run, a sit, a gym session — and the behaviour every existing habit keeps, so this is purely additive.
- **Present = anchored.** `"09:00"` + `"America/Sao_Paulo"` is a fixed instant that someone else keeps — a remote lesson. Travel to Paris and the same lesson reads `14:00`; the appointment did not move, your clock did.
- **A fixed offset (`"+05:00"`) is rejected** even though `Intl` accepts it. The Swift calendar sidecar resolves the stored string via `TimeZone(identifier:)`, which returns nil for an offset and then silently falls back to the device's zone — firing the event at the wrong hour with nothing logged. The write boundary refuses it so the three readers cannot disagree.
- **Rewriting a schedule preserves the anchor.** `timezone` omitted inherits whatever was stored, so a caller that only knows how to move the hour cannot unanchor a habit as a side effect. Pass `timezone: null` to unanchor deliberately.

Readers today: the calendar sidecar (`calendar-sidecar/Sources/EventStore.swift`, `resolveTimezone`) applies it to the EventKit event. `scheduleLocalStartTime()` in `src/domain/value-objects/Schedule.ts` converts for display; wiring it into the app's own cards is still open.
