---
name: close-up
description: Close out a session - land the progress where that work is tracked, release the intention, name the carry-over. Routes by context - Themia repos → a Linear comment on the issue(s) touched; equanimitech and everything else → a journal entry. Use when Rafa says "/close-up", "close up", "let's close up", "closing up here", "wrap this up", "wrap the session", "wrap the block", "I'm moving on", "done with this one", "let's close this session", "shipping this and switching". Repeatable - several times a day is normal. Do NOT trigger for the day-close - "good night", "I'm done for the day", "calling it", "end of day", "wind down" belong to `sunset`, which closes the day in the garden.
user-invocable: true
allowed-tools: [Read, Write, Bash, Skill]
---

# Close-up

The **session close**. A session ends, its progress lands where that work is
tracked, the intention is released, and he moves on. Several times a day is
normal.

Not a read (`weather` reads a day or a week back and writes nothing), not a
compaction for another agent
(`handoff` — that's one of the exits here, not the point).

**This is not the day-close.** `sunset` owns that — the garden's day summary,
unrecorded moments, tomorrow's seeds. When he signals the day is over rather
than the session, hand off there and stop.

**It ends with him free.** No new rabbit holes, no "while we're here". If
closing up surfaces work, that's `/idea` or `/pain`, not this session.

---

## 1. Read the session

The conversation is the session — you already hold it. Don't sweep the
activity log for it.

Supplement with the diff only:

```bash
git -C "$(git rev-parse --show-toplevel)" log --since='<session start>' --oneline
git status --short
```

Session start = the active moment's `startTime` if it has one, else ~3h ago.
If he corrects the window, take his answer.

Synthesize into three lines, no more: **what moved · what's left · what's
blocked.** That synthesis is the payload for every branch below — write it once,
reuse it.

## 2. Route by context

`git rev-parse --show-toplevel`, then:

- `~/Developer/themia/*` → **Linear** (§3a)
- `~/Developer/equanimitech/*` → **journal** (§3b)
- anything else, or no repo at all → **journal**, unless he says otherwise

Work that spanned both gets both. Ask only when the routing is genuinely
ambiguous, not to confirm the obvious.

## 3a. Land it — Themia → Linear

Find the issue before writing anything:

1. Branch name — Linear embeds the id (`rafa/the-123-slug`).
2. Commit messages and PR title.
3. The active moment's `refs` (they're Linear URLs by convention).
4. Still nothing → `list_issues` for his in-progress ones and ask.

Then draft a comment from §1's synthesis and show it. Propose a state change
only when the session actually earned one.

**Draft before write. Nothing reaches Linear before he approves** — the same
rule `week-review` runs on. Post with `mcp__plugin_linear_linear__save_comment`
/ `save_issue` (fall back to `mcp__claude_ai_Linear__*` if that server is
unauthenticated).

## 3b. Land it — everything else → journal oracle

Read `~/.zenborg/oracles.json`. Look up `routes.journal` for the preference
chain. For each oracle name in the chain:

1. Find the oracle in `oracles.<name>` and read its `journal` protocol object.
2. Run its `check` command — if it fails, skip to the next oracle.
3. If `read` exists, fetch today's entry; append `## HH:MM — <what moved>` +
   synthesis bullets.
4. Write via its `write` command (`$CONTENT` = the full markdown entry).

If no oracle is reachable, name the failure in the close line — silent skipping
is how a dead beat survives for months.

One entry per session. Don't stack a second one on the same session because he
added a thought.

## 4. Release the intention

The active moment (zenborg) names the stream. Closing up releases it — that is
the whole beat.

```
mcp__zenborg__get_active_moment
```

- Produced a durable pointer (PR, issue, doc)? **Pin it first** —
  `mcp__zenborg__update_moment` with `refs`. The moment is the only place this
  session stays findable months later; the pointer is about to be
  released and takes the association with it.
- Then `mcp__zenborg__clear_active_moment`.

Moments have no done-flag — they're planted, not checked off. Releasing the
pointer *is* the close.

If nothing was active, skip the beat silently.

## 4b. Release worktrees

A session that entered a worktree holds its lock until exit. Unreleased
worktrees block other sessions from entering them and prevent cleanup.

```
ExitWorktree   action: "keep"    # if the worktree has commits worth keeping
ExitWorktree   action: "remove"  # if the work was merged or is throwaway
```

If the session made commits that were merged to main (or another target), remove
the worktree — the work already lives on the target branch. If commits exist
but haven't been merged, keep it. If there are no changes at all, remove it.

Skip this beat silently when the session never entered a worktree.

## 5. Carry-over, then the exits

**Carry-over** — one line: the next concrete step on this thread, so picking it
back up costs nothing. Capture it as `/idea` only if it's a real bid for future
work; otherwise the journal or Linear comment already holds it.

**Then the exits.** Offer only what the session actually earned — most closes
take none. Never present all three as a menu; name the one that fits, or stay
quiet.

- **Slack → Themia** — the session produced something the team needs *today*.
  Draft it (`smart-brevity`), show it, send on approval via
  `mcp__claude_ai_Slack__slack_send_message_draft`. **No `|` characters, so no
  markdown tables** — he pastes these.
- **Linear status update** — the session moved a whole *project*, not one issue.
  `save_status_update`, draft-then-approve, same as `week-review`.
- **`/handoff`** — he's stopping *mid-thread*, not at a clean edge. Invoke the
  skill; it writes to the OS temp dir, not the workspace.

Close in one line: what landed, where, what's next — plus any beat that
couldn't run. Then stop.

## Rules

- **Dependencies are checked, not assumed.** Every path, CLI and MCP tool named
  here can vanish — servers disconnect, tools get renamed, files move. Probe
  before use and degrade: **a close never fails because a dependency rotted.**
  Distinguish the two skips — a beat that *doesn't apply* passes in silence (§4,
  §4b); a beat that *can't run* is named once in the close line, because silent
  skipping is how a dead beat survives for months unnoticed.
- **Repeatable and light.** Several a day is normal, so keep each one cheap. A
  commitment worth attesting mid-day is `/decision`, not this.
- **Session-scoped, not day-scoped.** The day-close is `sunset`'s. Never ask
  "is this the last block of the day?" — it is not this skill's question.
- **Draft before write.** Linear and Slack both. Nothing posts unattended.
- **The journal is never a repo.** The journal oracle (`routes.journal` in
  `~/.zenborg/oracles.json`) picks the sink; skills never hardcode one.
- **Release the moment, don't fake a completion.** No done-flag exists.
- **Don't sweep the log.** The conversation plus a `git log` is the whole read.
- **No new work.** Findings become `/idea` · `/pain` · `/question`, or they wait.
- **Exits are earned, not offered.** Silence is the common case.

## Composition

- **Session scope.** `close-up` closes a session, repeatedly through the day.
  The day belongs to `sunrise` · `sunset`; the week to `weather` (week mode).
  Hand off rather than absorb.
- Sibling of `weather` (read-only, a day or a week); this is the write.
- Delegates the journal write to the journal oracle chain (`oracles.json`),
  the message to `smart-brevity`, the mid-thread stop to `handoff`.
- **zenborg is the only thing this skill writes.** The moment
  (`get_active_moment` · `update_moment` · `clear_active_moment`) and nothing
  else. Moments are planted, not completed — there is no done-flag to set, so
  releasing the pointer is the entire close.
- Linear via `mcp__plugin_linear_linear__*`, matching `week-review`.
