# Claude-code observer as oracle

Moved from Things Someday on 2026-10-07 (it was captured 2026-09-22). The original text is kept verbatim below.

> The observer (observe.mjs) already logs every session lifecycle event to ~/.zenborg/log/YYYY-MM-DD.agent.jsonl — 11k+ events/day.
>
> Wire it as a claude-code oracle in oracles.json with a `read` command that:
> 1. Reads today's .agent.jsonl
> 2. Collapses subagent churn into contiguous work spans (gap > N min = new span)
> 3. Converts UTC timestamps to local timezone
> 4. Emits start/end/duration per span
>
> Then sunset reads the oracle instead of git logs to auto-tend build moments.

## Note (2026-10-07)

Vocabulary since 2026-09-25: this would be a drawing **spring**, not an oracle (see `docs/decisions/2026-09-25-garden-vocabulary.md`). `get_day_trace` already derives agent spans with an `idleGapMin` setting and reports them per area. Before building this, check whether the oracle is still needed or whether sunset can read the day trace directly.
