# Zenborg jobs run in the daemon

**Date:** 2026-10-05
**Supersedes:** §2 "The scheduler" of
[`2026-08-21-background-agent-operating-the-observer-and-the-scheduler.md`](2026-08-21-background-agent-operating-the-observer-and-the-scheduler.md)

## What changed

- **The scheduler runs in `zenborg-daemon` only.** The app no longer starts one
  (`src-tauri/src/scheduler/` is gone), so quitting zenborg doesn't stop a job and no job
  runs twice. Runtime: `src-tauri/crates/zenborg-daemon/src/scheduler.rs`. Parsing:
  `observer_core::config::parse_jobs`.
- **Config moved to `<vault>/jobs.json`** — a JSON object keyed by job id, like the other
  vault collections. `config.json`'s `desktop.scheduler.jobs` is no longer read. No
  fallback.
- **The scheduler runs whether or not the observer does.** It has its own single-instance
  guard, `<vault>/log/.scheduler.lock`.

`<vault>` is the daemon's vault: `ZENBORG_HOME`, then `KAIROS_HOME`, then `~/.zenborg`. The
daemon is always a release binary, so there is no `-dev` vault for it.

## Shape

```jsonc
{
  "voicememos": {
    "id": "voicememos",
    "name": "voicememos",          // optional; defaults to the key
    "enabled": true,               // must be literally true
    "program": "murmur",           // bare name: resolved on the job's PATH
    "args": ["sync"],
    "env": {},                     // no PATH here → the default PATH below
    "trigger": {
      "kind": "watch",             // or "interval"
      "paths": [
        "~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db",
        "~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db-wal"
      ],
      "debounceSeconds": 300       // default 30
    }
  }
}
```

Interval trigger: `{ "kind": "interval", "seconds": 3600, "runAtLoad": true }`.

**Portable paths.** A leading `~` and `$HOME` / `${HOME}` expand to the daemon's home in
`program`, each `args` item, each `env` value and each watch path, so one jobs.json works on
any Mac. Nothing else is templated (`observer_core::config::localize_job`).

**Default PATH.** launchd gives the daemon a bare PATH. A job whose `env` sets no `PATH`
runs with `~/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, and
a bare `program` name is looked up on it. Set `env.PATH` to replace it, not extend it.

Unchanged from the app scheduler: 60 s interval floor; a watch subscribes to the containing
directory (SQLite replaces `-wal`) and fires once a burst has been quiet for
`debounceSeconds`; runs are sequential per job; an unreadable job is dropped and its
siblings still run; job stdout/stderr are discarded.

## Springs as jobs

A drawing spring is a job that writes `<vault>/log/<day>.<surface>.jsonl`; the MCP
server only reads those files and never calls a spring live. The git and Linear springs
are subcommands of the bundled `zenborg-mcp` sidecar, so `program` is its path inside the
app bundle. Both rewrite the last 7 days on every run (`--days N` to change it), so a
rerun replaces a day and never duplicates it. Both ship disabled:

```jsonc
{
  "git": {
    "id": "git",
    "enabled": false,
    "program": "/Applications/zenborg.app/Contents/MacOS/zenborg-mcp",
    "args": ["spring", "git"],
    "env": {},
    "trigger": { "kind": "interval", "seconds": 3600, "runAtLoad": true }
  },
  "linear": {
    "id": "linear",
    "enabled": false,
    "program": "/Applications/zenborg.app/Contents/MacOS/zenborg-mcp",
    "args": ["spring", "linear"],
    "env": {},
    "trigger": { "kind": "interval", "seconds": 3600, "runAtLoad": true }
  }
}
```

- **git** walks the repos under every area's `surfaces.paths`, two levels down, and
  writes one line per repo per waking day: `{ repo, cwd, commits }`. It counts the
  repo's own (`user.email`) non-merge commits on any ref, by author time. No messages,
  no diffs. The work surface resolves `cwd` to an area through the same area map.
- **linear** writes one `issue_moved` line per state change on the viewer's assigned
  issues: `{ issue, from, to }` at its `ts`. Identifiers and state names only: no
  titles, bodies or descriptions are ever requested.
- **The Linear key** comes from `LINEAR_API_KEY` in the job's environment and is never
  written anywhere. Don't put it in `jobs.json`: the vault is plain files. Give it to the
  daemon's launchd domain instead, then restart the daemon (see Editing jobs):
  `launchctl setenv LINEAR_API_KEY "$(security find-generic-password -s zenborg-linear -w)"`.
  `launchctl setenv` does not survive a reboot. Without a key the job exits 1 without a
  word, which the daemon logs as info.

The readback (`get_footprints`) shows both on the **work** surface as counts, commits
and issues moved, never minutes. A spring with no line in the week reads "not drawn".

### Garmin

Garmin was a launchd agent (`com.equanimitech.zenborg.garmin`) running keel's
`garmin_sync.py` hourly. The equivalent job:

```jsonc
{
  "garmin": {
    "id": "garmin",
    "enabled": true,
    "program": "$HOME/Developer/equanimitech/_archive/keel/integrations/garmin/garmin_sync.py",
    "args": [],
    "env": {
      "PATH": "$HOME/.pyenv/shims:$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      "KEEL_HOME": "$HOME/.zenborg"
    },
    "trigger": { "kind": "interval", "seconds": 3600, "runAtLoad": true }
  }
}
```

`$HOME` expands only in a leading position or as `$HOME`, never `~` after a colon, so the
PATH spells it out. The script is a `uv run --script`, so `uv` must be on that PATH.
`KEEL_HOME` points the script at the vault: it writes `$KEEL_HOME/log/*.garmin.jsonl`.
The plist's `/tmp/zenborg-garmin.log` goes away: the daemon discards job output.

## Editing jobs

jobs.json is read **once at startup**. After an edit, restart the daemon:

```bash
launchctl kickstart -k gui/$(id -u)/tech.equanimi.zenborg.daemon
```

## Where to look

The daemon's stderr, `/tmp/zenborg-daemon.err.log` (set by the launchd plist):

```
[scheduler] started: voicememos
[scheduler] voicememos started
[scheduler] voicememos finished in 41.2s
[scheduler] voicememos exited with exit status: 1 after 0.3s   # info, not warn — see below
```

A non-zero exit stays at info: jobs exit early on purpose when a dependency is down.

## Permissions

A job runs as a child of the daemon, so it inherits the daemon's TCC grants. A job that
reads a protected location (Voice Memos lives under `~/Library/Group Containers`) needs
**Full Disk Access granted to the daemon binary**:
`/Applications/zenborg.app/Contents/MacOS/zenborg-daemon`.
