---
name: oracle-probe
description: >-
  Probe an oracle or surface to see what it returns, capture a sample trace,
  and store it so future sessions can learn the output shape without re-probing.
  Use when the user says "/oracle-probe", "probe garmin", "probe body",
  "what does hey return", "show me the garmin output", "trace the oracle",
  or when a skill needs to understand an unfamiliar oracle's or surface's
  output shape. Also use before building or debugging any skill that reads
  external data.
user-invocable: true
allowed-tools: [Bash, Read, Write, AskUserQuestion]
---

# Oracle probe

Run an oracle's commands or MCP tools, capture the output, and write a sample
trace to `~/.zenborg/oracles/traces/<surface>/<source>.sample.md` so any
future session can read the shape without re-probing.

## Surfaces vs oracles

**Surfaces** are what the gardener sees — body, screen, work, journal, comms.
**Oracles** are infrastructure that feed surfaces — garmin feeds body,
hey feeds journal + comms, etc.

Surface profiles live in `plugin/surfaces/<surface>.md`. Each profile declares:
- Which sources feed it (oracles, local files, app-internal tools)
- Which tools/commands to probe
- Which fields matter and which are noise
- Gotchas

**Always read the surface profile before probing.** It tells you what to
extract and what to skip.

## When to invoke

- "/oracle-probe", "/oracle-probe garmin", "/oracle-probe body"
- "probe garmin", "probe body", "what does hey return"
- "show me the garmin sleep output", "trace the oracle"
- Before building a skill that calls an oracle you haven't probed yet

## Surface → source mapping

| Surface | Sources | Profile |
|---------|---------|---------|
| body | garmin | `plugin/surfaces/body.md` |
| screen | desktop sensor, browser extension | `plugin/surfaces/screen.md` (browser half: `browser.md`) |
| work | agent sessions; git, linear, things (no spring yet) | `plugin/surfaces/work.md` |
| journal | hey, penceive, supernote | `plugin/surfaces/journal.md` |
| comms | hey, gmail, slack | `plugin/surfaces/comms.md` |

These are the reading surfaces `mcp__zenborg__get_footprints` returns. "browser",
"agent" and "tasks" resolve to screen, work and work.

The user may say either "probe garmin" (oracle) or "probe body" (surface).
Resolve to the right profile either way.

## Workflow

### 1. Parse the argument

The user may pass:
- Nothing → list surfaces and ask which to probe
- Surface name → read its profile, probe all sources
- Oracle name → find which surfaces it feeds, probe those capabilities
- Oracle + capability → probe that specific capability

### 2. Read the surface profile

```
plugin/surfaces/<surface>.md
```

The profile's **Probe tools** column tells you exactly what to call. The **Key
fields** section tells you what to extract. The **Noise** section tells you
what to skip.

### 3. Read the oracle config

```bash
cat ~/.zenborg/oracles.json
```

Cross-reference with the surface profile to identify the interface type:
- **CLI oracle** — has protocol objects with `check`, `read`, `write` commands
- **MCP oracle** — entry is `{}`, tools are `mcp__<oracle>__*`
- **Local source** — not in oracles.json (git, the activity log, browser fences); probe with
  the commands listed in the surface profile

### 4. Probe

#### CLI oracles

Run the `check` command first. Then run each read-family command from the
surface profile with sensible defaults:
- Replace `$LIMIT` with `3`
- Replace `$QUERY` with a broad recent query
- Replace `$DATE_RANGE` with the last 7 days
- Replace `$BOX` with `imbox` (HEY's term)
- Do NOT run `write` commands — probe is read-only

#### MCP oracles

Call the tools listed in the surface profile's **Probe tools** column.
Use today's date for date-scoped tools. Minimal limits for list tools.

#### Local sources (screen, work)

Run the commands from the surface profile directly. These aren't oracles —
they're filesystem reads or zenborg MCP calls.

### 5. Capture the trace

For each probed command/tool, record:

```markdown
## <command or tool name>

**Invoked:** `<exact command or tool call with params>`
**When:** <ISO timestamp>

### Output

\`\`\`json
<raw output, truncated to ~200 lines if massive>
\`\`\`

### Shape

- <field>: <type> — <what it means>
- ...
```

Compare what you got against the surface profile's **Key fields**. Flag any
field the profile expects but the oracle didn't return (schema drift).

### 6. Write the trace file

```
~/.zenborg/oracles/traces/<surface>/<source>.sample.md
```

Examples:
- `~/.zenborg/oracles/traces/body/garmin.sample.md`
- `~/.zenborg/oracles/traces/comms/hey.sample.md`
- `~/.zenborg/oracles/traces/work/git.sample.md`

Structure:

```markdown
# <Surface> — <source> trace

Probed: <ISO date>
Source type: CLI | MCP | local
Surface profile: plugin/surfaces/<surface>.md

<per-command sections from step 5>

## Summary

Key fields confirmed:
- ...

Missing vs profile:
- ...

Gotchas discovered:
- ...
```

Overwrite prior samples (freshness matters). Create dirs as needed.

### 7. Report

Show the user:
- What was probed (surface + source)
- The output shape (confirmed key fields, not raw dump)
- Any schema drift from the surface profile
- Where the trace was saved

## Rules

- **Read-only.** Never call write/compose/reply/delete commands.
- **Surface profile first.** Always read it before probing. It's the contract.
- **Minimal parameters.** Smallest query that reveals the shape.
- **Truncate large output.** Cap at ~200 lines per command.
- **Don't probe what's down.** If `check` fails or MCP tool errors, note and move on.
- **Trace path is by surface, not oracle.** `traces/body/garmin.sample.md`, not
  `traces/garmin/body.sample.md`. The reader asks "what does the body surface
  look like?", not "what does garmin return?"
- Traces live outside the git repo (`~/.zenborg/`), not in the codebase.
