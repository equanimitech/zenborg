---
name: midday
description: Morning-to-afternoon transition — audit all running sessions, land idle ones, migrate active work to cloud agents, then the user can step away from the machine. Use when Rafa says "/midday", "lunch break", "going to lunch", "stepping away", "closing the laptop", "I need to leave", "park everything", "migrate to cloud", "shut everything down", "morning wrap", or wants to close the morning block and step away without losing progress. This is the ritual between MORNING and AFTERNOON phases. Do NOT trigger for a single-session wrap (that is `close-up`), nor for the day-close (`sunset`).
user-invocable: true
allowed-tools: [Read, Bash, Agent, ToolSearch]
---

# Midday

The morning-to-afternoon transition. Land the morning's sessions, migrate
anything mid-flight to cloud, and walk away from the machine.

Not a day-close (`sunset`), not a single-session wrap (`close-up`). This is the
phase boundary — the morning block ends, the laptop closes for lunch, and the
afternoon starts fresh.

---

## 0. Load tools

```
ToolSearch  query: "select:SendMessage"
```

SendMessage is deferred — load it before step 2.

## 1. Survey the fleet

```
ListAgents
```

Categorize each peer session:

| State | What it means |
|-------|---------------|
| **idle** | No active work — safe to kill |
| **shell** | Running a command — needs triage |

Show the table with age. Skip self.

## 2. Message every peer

For **each** peer session, send one message. Send them **all in one turn**
(parallel SendMessage calls):

> Rafa is stepping away. Please land your work:
> 1. If you have uncommitted changes, `git stash -u` them.
> 2. Run `/close-up` if the conversation has meaningful progress to land.
> 3. Then `/exit`.
>
> If you're mid-build or mid-test and the result matters, say so in your
> reply — Rafa will decide whether to migrate you to cloud.

Don't wait for responses — the sessions process asynchronously. The messages
are fire-and-forget; Rafa will see them in each terminal.

## 3. Triage carry-over

After sending, ask Rafa **once**:

> Sent close-up to N sessions. Any of these doing work that should continue
> on the cloud while you're away?
>
> [list sessions in `shell` state with their age]

If he names sessions to migrate → §4. If he says "no" or "just kill them" → §5.

## 4. Migrate to cloud

For each session Rafa wants to continue, spawn a **cloud agent**:

```
Agent
  isolation: "remote"
  prompt: "<self-contained prompt with: repo path, branch, what was done, what remains, any env setup needed>"
```

The cloud agent has **zero context** from the original session. The prompt must
be fully self-contained — include the repo, the branch, what was already done,
what's left, and any setup steps (`.env` copy, `pnpm install`, etc.).

If you don't know what the session was doing, say so — don't guess. Rafa can
check that terminal before closing it.

## 5. Release the intention

Same beat as `close-up` §4 — release the active moment:

```
mcp__zenborg__get_active_moment
```

If active: pin any durable pointer (`refs`), then `clear_active_moment`.
If nothing active: skip silently.

## 6. Close line

One compact summary:

```
✓ Messaged N sessions to close up
✓ M cloud agents spawned: [one-liner each]
✓ Intention released

Safe to close the laptop. Cloud agents will notify when done.
Terminals to Ctrl+C: [list session names]
```

Then stop. No new work. No rabbit holes.

## Rules

- **Parallel sends.** All SendMessage calls in one turn — don't round-trip per
  session.
- **Don't wait.** Sessions close asynchronously. The skill triggers the close,
  it doesn't verify it.
- **Cloud is opt-in per session.** Never migrate without asking — cloud agents
  cost money and the work might not matter.
- **Self-contained cloud prompts.** The cloud agent knows nothing. Give it
  everything.
- **No new work.** Findings become `/idea` or `/pain`, not this session's
  problem.
- **Dependencies are checked, not assumed.** If SendMessage or a zenborg tool
  is unreachable, name the failure in the close line. A midday never fails
  because a dependency rotted.

## Composition

- Batch wrapper over `close-up` — each peer runs its own close-up internally.
- Uses `SendMessage` (peer messaging), `Agent` with `isolation: "remote"`
  (cloud migration), zenborg MCP (moment release).
- Sibling of `close-up` (single session), `sunset` (day-close), `sunrise`
  (day-open). This is the phase boundary — between session and day.
