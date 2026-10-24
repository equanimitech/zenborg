# domain/ — vendored, not shared

These files are a verbatim copy of zenborg's intervention slice, taken
from `zenborg@e5747ca192c8f2f022a207de12feef4caf098512` (`src/domain/attention/` and `src/domain/intervention/`).
The layout mirrors the source exactly so every relative import inside them
resolves unchanged, which is why `attention/` sits beside `intervention/`
here rather than inside it.

`intervention/scheduleWindow.ts` was added later (2026-10-24): the one reading of a
schedule window, also vendored into `extension/modules/fence/`. Its byte-identity
is pinned by `src/domain/intervention/__tests__/scheduleWindow.test.ts`, which the
root pre-commit hook runs.

## Why a copy and not a package

Two constraints, and neither is a preference.

**The marketplace clones this directory alone.** The entry is a `git-subdir`
source at `apps/plugin`, so a workspace package outside it would not exist on
an installed machine. Anything the hooks call at runtime has to live under this
directory.

**The original cannot move.** `src/application/use-cases/fences.ts`,
`src/application/ports.ts` and `mcp-server/fences.ts` all consume it, so the
app keeps its model. That is the design: *one model in TypeScript, and
everything outside the app reads data, not code.* This plugin is outside the
app. It reads `fences.json` and `habits.json` as data, and owns its own copy
of the vocabulary needed to interpret them.

## The drift rule

The copy is expected to stay byte-identical until it deliberately does not.
`drift.test.mjs` compares the two trees when a zenborg checkout is present
beside this repo and skips when it is not, so the check runs on the machine
where divergence would be introduced and never fails an install.

When the app moves into this repo, the copy collapses into the original and
this directory goes away.
