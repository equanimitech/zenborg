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
    "program": "/Users/rafa/.local/bin/murmur",   // absolute — launchd's PATH is bare
    "args": ["sync"],
    "env": { "PATH": "/opt/homebrew/bin:/Users/rafa/.local/bin:/usr/bin:/bin" },
    "trigger": {
      "kind": "watch",             // or "interval"
      "paths": ["…/CloudRecordings.db", "…/CloudRecordings.db-wal"],
      "debounceSeconds": 300       // default 30
    }
  }
}
```

Interval trigger: `{ "kind": "interval", "seconds": 3600, "runAtLoad": true }`.

Unchanged from the app scheduler: 60 s interval floor; a watch subscribes to the containing
directory (SQLite replaces `-wal`) and fires once a burst has been quiet for
`debounceSeconds`; runs are sequential per job; an unreadable job is dropped and its
siblings still run; job stdout/stderr are discarded.

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
