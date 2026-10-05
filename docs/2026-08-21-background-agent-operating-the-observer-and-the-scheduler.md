# Background agent — operating the observer and the scheduler

**Date:** 2026-08-21
**Context:** migration B ("the garden absorbs keel"), steps 3 and 4
**Decision:** `kairos/docs/decisions/2026-08-21-run-the-writer-as-a-background-agent-rather-than-a-menubar-tray.md`

zenborg can now do the two things `apps/tray` and three launchd agents were doing:
write the desktop activity log, and run the classify and Garmin schedules. Both are
**off by default** and stay off until you say otherwise, because `apps/tray` is still
installed and the three plists may still be loaded. Two writers on one collection would
double every event.

Everything below is configured in **one file**: `<vault>/keel/config.json`, the same
document keel's own `desktop.inputActivity` opt-in lives in.

**`<vault>` is whatever `crate::vault::fs::vault_root()` resolves**, not whatever keel
resolves. That is deliberate and it is the one place the two rules differ: a **debug**
zenborg reads and writes `~/.kairos-dev`, a release build `~/.kairos`, and `KAIROS_HOME`
overrides both. Copying keel's rule into the observer would have made `pnpm dev:tauri`
append desktop events to the production log. So a parity run from a dev build needs
`KAIROS_HOME=$HOME/.kairos` set, or it will quietly write nothing you were looking for.

---

## 1. The observer (step 3)

`src-tauri/src/observer/` — a behavioural port of `keel/apps/tray/src-tauri/src/{domain,writer}.rs`.
Same two sensors (frontmost app via `x-win`, idle via IOKit `HIDIdleTime`), the same
opt-in input-count rollup, the same `surface: "desktop"` tag, the same day-file naming,
and the same fail-open posture. Kept line-comparable on purpose: the parity check below
is a diff, and a diff is only evidence if the two sides were meant to be identical.

### Config

```jsonc
{
  "desktop": {
    "backgroundObserver": {
      "enabled": true,          // default false — nothing runs without this
      "logDirName": "log-zenborg", // default; "log" is the real collection
      "startHidden": false      // launch without raising the window
    }
  }
}
```

`logDirName` is a **directory name**, never a path. A value containing `/` is refused
rather than sanitized, and falls back to the parity directory.

Environment overrides exist for the parity run and for tests, not as the supported way
to turn this on: `ZENBORG_OBSERVER=1|0`, `ZENBORG_OBSERVER_LOG_DIR=<name>`.

### Running parity against the old tray

1. Leave `apps/tray` installed and running. It keeps writing `~/.kairos/keel/log/`.
2. Set `enabled: true` and leave `logDirName` at its default. zenborg writes
   `~/.kairos/keel/log-zenborg/`.
3. Restart zenborg. Look for `[observer] writing to …` in the app log.
4. Use the machine for a normal stretch — long enough to cover several app switches and
   at least one idle span crossing the 120s threshold.
5. Diff the day files. They are JSONL with a random `id` and a per-observation `ts`, so
   compare the shape rather than the bytes:

   ```bash
   day=$(date +%F)
   for dir in log log-zenborg; do
     jq -c '{kind, surface, app: .payload.app_name, hasDuration: (.durationMs != null)}' \
       "$HOME/.kairos/keel/$dir/$day.desktop.jsonl" | sort | uniq -c | sort -rn > "/tmp/$dir.tally"
   done
   diff /tmp/log.tally /tmp/log-zenborg.tally
   ```

   What should match: the set of `kind`s, the app-switch sequence, and which events carry
   `durationMs`. What will not match, and should not: event ids, and the first
   `writer_started` / first `app_switched` of each writer, since the two processes start
   at different instants and neither fabricates a duration across its own start.

6. When satisfied, and **only after** `launchctl bootout gui/$(id -u)/com.equanimitech.keel.tray`,
   set `logDirName: "log"` and restart. That single line is the handover.

### What moved off the menubar

| tray menu item | now |
|---|---|
| status ("keel — observing") | `observer_status` command; `[observer]` lines in the app log |
| Pause / Resume logging | `observer_set_paused` command — still emits `writer_paused` / `writer_resumed` |
| Granularity submenu | unchanged: the dial is `state.json`, set by `keel granularity` |
| Screen Recording needed | `observer://permission-needed` event + a `log::warn!` |
| Step away | **not ported** — see the decision doc; `apps/tray` still has it |
| Open data folder | not ported |

### Window behaviour

When `enabled` is true, closing the window **hides** it and the observer keeps writing.
Cmd-Q still quits. `startHidden: true` launches without raising the window, which is what
makes the login item honest — otherwise "allow in the background" would raise a window
every morning.

---

## 2. The scheduler (step 4)

> **Superseded 2026-10-05** by [`2026-10-05-zenborg-jobs-run-in-the-daemon.md`](2026-10-05-zenborg-jobs-run-in-the-daemon.md):
> the scheduler runs in `zenborg-daemon`, configured by `<vault>/jobs.json`. The config
> below is no longer read.

`src-tauri/src/scheduler/` — the two triggers launchd offered, and nothing else. It knows
nothing about Garmin or Things; a job is data.

```jsonc
{
  "desktop": {
    "scheduler": {
      "jobs": [
        {
          "name": "garmin",
          "enabled": true,
          "program": "/Users/rafa/Developer/equanimitech/keel/integrations/garmin/garmin_sync.py",
          "env": { "PATH": "/Users/rafa/.pyenv/shims:/Users/rafa/.local/bin:/opt/homebrew/bin:/usr/bin:/bin" },
          "trigger": { "kind": "interval", "seconds": 3600, "runAtLoad": true }
        },
        {
          "name": "classify",
          "enabled": true,
          "program": "/Users/rafa/Library/pnpm/node",
          "args": ["/Users/rafa/Developer/equanimitech/keel/apps/agent/keel-classify.mjs"],
          "trigger": {
            "kind": "watch",
            "paths": [
              "/Users/rafa/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-851R6/Things Database.thingsdatabase/main.sqlite",
              "/Users/rafa/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-851R6/Things Database.thingsdatabase/main.sqlite-wal"
            ],
            "debounceSeconds": 30
          }
        }
      ]
    }
  }
}
```

Notes carried over from the plists, and what changed:

- **`ThingsData-851R6` is this machine's directory name.** It was hardcoded in the plist
  because launchd needs a literal; here it is config, which is the same literal in a file
  you actually edit.
- **The watch subscribes to the containing directory**, not to the two files. SQLite
  replaces `-wal` on checkpoint, and a watch bound to the old inode goes quiet without
  ever erroring.
- **Debounce.** One commit touches `main.sqlite` and `-wal`; a checkpoint touches them
  again. `debounceSeconds` is the quiet period a burst has to settle for. Default 30.
- **Interval floor.** 60s, whatever the config says. `ThrottleInterval` by another name.
- **Runs are sequential per job.** The next tick cannot start until this one returns, so
  a slow Garmin poll delays rather than overlaps.
- **`enabled` must be literally `true`.** A job that cannot be parsed is dropped, and its
  siblings still run.
- **Output goes to the app log**, not `/tmp/keel-garmin.log` and `~/.kairos/keel/log/classify.err`.
- **A non-zero exit is logged at info, not warn.** Both jobs are documented to exit early
  when their dependency is down (`ollama serve` for classify; the watch's cloud sync for
  Garmin), and a scheduler that treated that as a failure would cry wolf hourly.

Enable each job **in the same breath** as you bootout its plist. Both running is a double
Garmin poll and a classifier racing its own second copy.

---

## 3. The login item (step 4)

`src-tauri/src/login_item.rs`. `SMAppService.mainApp`, called through the plain
Objective-C runtime so macOS 11 and 12 report `unsupported` and keep running rather than
aborting.

Three commands: `login_item_status`, `login_item_register`, `login_item_unregister`.
**No UI is wired to them yet** — they are callable from the frontend or from devtools:

```js
await window.__TAURI__.core.invoke("login_item_register");
// → { status: "enabled" | "requiresApproval" | "notFound" | ..., bundled: true }
```

- Registration only works from a **built `.app`**. `tauri dev` is unbundled and reports
  `notFound`; the command refuses up front and says so.
- `requiresApproval` is a *successful* registration that does nothing until you flip the
  switch in System Settings › General › Login Items & Extensions › Allow in the
  Background. The command re-reads `status()` after registering rather than trusting the
  call's boolean, so it will tell you.

### The full step-4 cutover, in order

```bash
# 1. See what is loaded today
launchctl print gui/$(id -u)/com.equanimitech.keel.tray    | head -20
launchctl print gui/$(id -u)/tech.equanimi.keel.classify   | head -20
launchctl print gui/$(id -u)/com.equanimitech.keel.garmin  | head -20

# 2. Build and install zenborg.app, then register the login item from the built app
#    (invoke login_item_register, or from a devtools console as above)

# 3. Approve it if macOS says requiresApproval:
open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"

# 4. One at a time, with its config job enabled in the same breath:
launchctl bootout gui/$(id -u)/com.equanimitech.keel.garmin
launchctl bootout gui/$(id -u)/tech.equanimi.keel.classify
launchctl bootout gui/$(id -u)/com.equanimitech.keel.tray     # last — see below

# 5. Only after the tray is bootout, flip logDirName to "log" and restart zenborg.
```

The tray goes last because its plist is the only one with `KeepAlive`, and it is the one
whose collection zenborg is taking over. Nothing here deletes a plist: the files stay on
disk, and re-bootstrapping one is how you back out. Deletion is migration step 6.
