# Moment Band Implementation Plan

**Goal:** When the active moment is stale or none is set, a one-line band above the Claude Code prompt offers this phase's moments to tend (or habits to plant), the status line carries the active moment, and `moment-awareness.mts` stops asking Claude to propose.

**Architecture:** A pure reader, `plugin/hooks/garden.ts`, turns the vault JSON and a `Date` into `{ status, band }`; it is tested under `node --test`. A Claude Code mod, `plugin/hooks/moment-band.tsx`, reads the vault through `$.fs`, calls `reading()`, sets `$.ui.status`, keeps the band in a `$.state` atom, draws it on `AbovePrompt`, and writes only through zenborg's MCP tools via `$.tool.call`. The shell hook keeps reporting facts.

**Tech Stack:** Claude Code mods (hooks module, `claude-code` API, `claude-code/testing`), TypeScript with Node 24 type stripping, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-27-moment-band-design.md`

## Global Constraints

- Branch `feat/moment-band` from `origin/main`; one PR against `main`. Do not touch the uncommitted `extension/entrypoints/popup/style.css`.
- pnpm only. Plugin checks: `cd plugin && pnpm test`, `claude plugin test plugin`, `claude plugin validate plugin`. The repo pre-commit hook runs root `pnpm test`; it must stay green.
- No em dashes in new code, comments, copy, commits or PR text.
- Copy: "tend", never "allocate"; the only system mark is `≋`; emoji only the gardener's own (moment, else habit, else area); no counts, streaks, highlighted or pre-focused suggestion.
- The vault has one writer: the mod reads JSON and writes only through `set_active_moment` and `add_moment`. Readers never mutate.
- Versions stay as they are; the release commit bumps them (`chore: bump version to …`).
- API reference for mods: `/private/tmp/claude-501/bundled-skills/2.1.311/ee3951e73b0857fd9cc5711f145436d6/plugin-authoring/types/claude-code.d.ts` and `reference.md` beside it. Grep the event name (`'fs.read':`, `'tool.call':`) for input and result shapes. In tests, a call on `$` is answered `{ value }`; an event (`tool.call`, `turn.start`, `session.start`) by its own result.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The garden reader (pure)

**Files:**
- Create: `plugin/types/index.d.ts`
- Create: `plugin/hooks/garden.ts`
- Test: `plugin/hooks/garden.test.mjs`

**Interfaces:**
- Consumes: `staleReason`, `wakingDayKey` from `plugin/domain/attention/ActiveMoment.ts` (vendored, dependency-free).
- Produces: `reading(v: Vault, now: Date): Reading | null`; types `Vault`, `Reading`, `Tap`, `Band`; `STALE_AFTER_MIN = 120`.

- [ ] **Step 1: Write the state contract and shared types**

`plugin/types/index.d.ts`:

```ts
export type Tap =
  | { kind: 'tend'; momentId: string; label: string }
  | { kind: 'plant'; habitId: string; label: string }

/** The band's one line and its taps, for one (day, phase). */
export type Band = { day: string; phase: string; line: string; taps: Tap[] }

declare module 'claude-code' {
  interface PluginState {
    zenborg: { band: Band | null; later: string | null }
  }
}
```

- [ ] **Step 2: Write the failing test**

`plugin/hooks/garden.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

const { reading } = await import("./garden.ts");

const TODAY = "2026-10-27";
const at = (h, m = 0) => new Date(2026, 9, 27, h, m);
const phases = {
  m: { phase: "MORNING", label: "Morning", startHour: 7, endHour: 13 },
  a: { phase: "AFTERNOON", label: "Afternoon", startHour: 13, endHour: 19 },
};
const areas = { fun: { id: "fun", name: "Entertainment", emoji: "🍿" } };
const vault = (over = {}) => ({ active: {}, moments: {}, habits: {}, areas, phases, ...over });
const moment = (id, name, phase, extra = {}) => ({ id, name, day: TODAY, phase, ...extra });
const netflix = (phase) => moment("n", "Netflix", phase, { areaId: "fun" });

test("a fresh active moment: status only, no band", () => {
  const r = reading(
    vault({ active: { momentId: "n", at: at(8).toISOString() }, moments: { n: netflix("MORNING") } }),
    at(9),
  );
  assert.deepEqual(r, { status: "≋ 🍿 Netflix", band: null });
});

test("an active moment from another phase offers three of this phase's moments, in order", () => {
  const r = reading(
    vault({
      active: { momentId: "n", at: at(8).toISOString() },
      moments: {
        n: netflix("AFTERNOON"),
        d: moment("d", "read", "MORNING", { order: 4 }),
        b: moment("b", "breakfast", "MORNING", { emoji: "🥐", order: 2 }),
        a: moment("a", "meditation", "MORNING", { emoji: "🧘", order: 1 }),
        c: moment("c", "quality time", "MORNING", { emoji: "🟰", order: 3 }),
      },
    }),
    at(9),
  );
  assert.equal(r.status, "≋ 🍿 Netflix · from the afternoon");
  assert.deepEqual(r.band, {
    day: TODAY,
    phase: "MORNING",
    line: "≋ Netflix is from the afternoon",
    taps: [
      { kind: "tend", momentId: "a", label: "🧘 meditation" },
      { kind: "tend", momentId: "b", label: "🥐 breakfast" },
      { kind: "tend", momentId: "c", label: "🟰 quality time" },
    ],
  });
});

test("an active moment set over two hours ago is stale, and is not offered to itself", () => {
  const r = reading(
    vault({
      active: { momentId: "n", at: at(7).toISOString() },
      moments: { n: netflix("MORNING"), a: moment("a", "meditation", "MORNING", { emoji: "🧘" }) },
    }),
    at(10),
  );
  assert.equal(r.status, "≋ 🍿 Netflix · set 3h ago");
  assert.equal(r.band.line, "≋ Netflix was set 3h ago");
  assert.deepEqual(r.band.taps, [{ kind: "tend", momentId: "a", label: "🧘 meditation" }]);
});

test("nothing planted: habits of this phase, unarchived, in order, as plant taps", () => {
  const r = reading(
    vault({
      habits: {
        h2: { id: "h2", name: "run", phase: "MORNING", order: 2 },
        h1: { id: "h1", name: "meditation", phase: "MORNING", emoji: "🧘", order: 1 },
        h0: { id: "h0", name: "old", phase: "MORNING", order: 0, isArchived: true },
        h4: { id: "h4", name: "nap", phase: "AFTERNOON", order: 0 },
      },
    }),
    at(9),
  );
  assert.equal(r.status, "≋ Morning");
  assert.equal(r.band.line, "≋ Nothing planted this morning");
  assert.deepEqual(r.band.taps, [
    { kind: "plant", habitId: "h1", label: "+ 🧘 meditation" },
    { kind: "plant", habitId: "h2", label: "+ run" },
  ]);
});

test("a pointer to a moment off today's board reads as none", () => {
  const r = reading(
    vault({
      active: { momentId: "n", at: at(8).toISOString() },
      moments: { n: { ...netflix("MORNING"), day: "2026-10-20" }, a: moment("a", "meditation", "MORNING") },
    }),
    at(9),
  );
  assert.equal(r.status, "≋ Morning");
  assert.equal(r.band.line, "≋ No intention this morning");
});

test("nothing to offer: status only", () => {
  assert.deepEqual(reading(vault(), at(9)), { status: "≋ Morning", band: null });
});

test("outside every phase: nothing at all", () => {
  assert.equal(reading(vault(), at(22)), null);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd plugin && node --test hooks/garden.test.mjs`
Expected: FAIL, `Cannot find module` for `./garden.ts`.

- [ ] **Step 4: Write the reader**

`plugin/hooks/garden.ts`:

```ts
/**
 * The garden as the moment band reads it. Pure: no I/O, so it runs under
 * `node --test` and inside the Claude Code mod alike.
 */
import type { Band, Tap } from "../types";
import { staleReason, wakingDayKey } from "../domain/attention/ActiveMoment.ts";

export interface PhaseConfig {
  phase: string;
  label: string;
  startHour: number;
  endHour: number;
}
interface Named {
  name: string;
  emoji?: string | null;
  areaId?: string | null;
  order?: number;
}
export interface Moment extends Named {
  id: string;
  day?: string | null;
  phase?: string | null;
}
export interface Habit extends Named {
  id: string;
  phase?: string | null;
  isArchived?: boolean;
}
export interface Area {
  id: string;
  name: string;
  emoji?: string | null;
}
export interface Vault {
  active: { momentId?: string; at?: string };
  moments: Record<string, Moment>;
  habits: Record<string, Habit>;
  areas: Record<string, Area>;
  phases: Record<string, PhaseConfig>;
}
export interface Reading {
  status: string;
  band: Band | null;
}

/** A moment set longer ago than this reads as stale, as in moment-awareness. */
export const STALE_AFTER_MIN = 120;
const MAX_TAPS = 3;

export function currentPhase(phases: PhaseConfig[], now: Date): PhaseConfig | null {
  const hour = now.getHours();
  for (const cfg of phases) {
    const { startHour, endHour } = cfg;
    const inside =
      endHour <= startHour
        ? hour >= startHour || hour < endHour
        : hour >= startHour && hour < endHour;
    if (inside) return cfg;
  }
  return null;
}

/** "this morning", "tonight". */
const thisPhase = (label: string) =>
  label.toLowerCase() === "night" ? "tonight" : `this ${label.toLowerCase()}`;

export function reading(v: Vault, now: Date): Reading | null {
  const phase = currentPhase(Object.values(v.phases), now);
  if (!phase) return null;
  const today = wakingDayKey(now);
  const label = (x: Named) => {
    const emoji = x.emoji ?? (x.areaId ? v.areas[x.areaId]?.emoji : undefined);
    return emoji ? `${emoji} ${x.name}` : x.name;
  };
  const byOrder = (a: Named, b: Named) => (a.order ?? 0) - (b.order ?? 0);

  // A pointer to a moment off today's board reads as none (staleReason).
  const pointed = v.active.momentId ? v.moments[v.active.momentId] : undefined;
  const active = pointed && staleReason(pointed, today) === null ? pointed : null;

  const fromPhase =
    active?.phase && active.phase !== phase.phase
      ? (Object.values(v.phases).find((p) => p.phase === active.phase)?.label ?? active.phase).toLowerCase()
      : null;
  const ageMin = active && v.active.at ? (now.getTime() - Date.parse(v.active.at)) / 60_000 : 0;
  const why = fromPhase !== null ? `from the ${fromPhase}` : `set ${Math.floor(ageMin / 60)}h ago`;

  if (active && fromPhase === null && ageMin <= STALE_AFTER_MIN) {
    return { status: `≋ ${label(active)}`, band: null };
  }
  const status = active ? `≋ ${label(active)} · ${why}` : `≋ ${phase.label}`;

  const planted = Object.values(v.moments)
    .filter((m) => m.day === today && m.phase === phase.phase && m.id !== active?.id)
    .sort(byOrder);
  const taps: Tap[] =
    planted.length > 0
      ? planted
          .slice(0, MAX_TAPS)
          .map((m) => ({ kind: "tend" as const, momentId: m.id, label: label(m) }))
      : Object.values(v.habits)
          .filter((h) => !h.isArchived && h.phase === phase.phase)
          .sort(byOrder)
          .slice(0, MAX_TAPS)
          .map((h) => ({ kind: "plant" as const, habitId: h.id, label: `+ ${label(h)}` }));
  if (taps.length === 0) return { status, band: null };

  const line = active
    ? `≋ ${active.name} ${fromPhase !== null ? "is" : "was"} ${why}`
    : `≋ ${planted.length > 0 ? "No intention" : "Nothing planted"} ${thisPhase(phase.label)}`;
  return { status, band: { day: today, phase: phase.phase, line, taps } };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd plugin && node --test hooks/garden.test.mjs`
Expected: 7 pass, 0 fail. Then `cd plugin && pnpm test`: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugin/types/index.d.ts plugin/hooks/garden.ts plugin/hooks/garden.test.mjs
git commit -m "feat(plugin): read the garden for the moment band"
```

---

### Task 2: The moment band mod

**Files:**
- Create: `plugin/hooks/moment-band.tsx`
- Test: `plugin/hooks/moment-band.test.tsx`
- Modify: `plugin/hooks/hooks.json` (add top-level `"modules"`)
- Modify: `plugin/.claude-plugin/plugin.json` (add `"types"`)
- Modify: `tsconfig.json` (root: add `"plugin"` to `exclude`, so `next build` never typechecks a mod against Next's types)
- Modify: `plugin/README.md` (one line naming the band)

**Interfaces:**
- Consumes: `reading`, `Vault` from `./garden.ts`; `Band`, `Tap` from `../types`.
- Produces: atoms `zenborg.band: Band | null`, `zenborg.later: string | null` (`"<day> <phase>"`).

- [ ] **Step 1: Wire the module and its contract**

In `plugin/hooks/hooks.json`, add beside `"hooks"` (top level): `"modules": ["./moment-band.tsx"]`.
In `plugin/.claude-plugin/plugin.json`, add `"types": "./types/index.d.ts"`.
In root `tsconfig.json`, add `"plugin"` to the `exclude` array.

- [ ] **Step 2: Write the failing test**

`plugin/hooks/moment-band.test.tsx`:

```tsx
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const NOW = new Date(2026, 9, 27, 9).getTime()
const TODAY = '2026-10-27'
const ROOT = '/home/g/.zenborg/'
const BAND = {
  plugin: 'zenborg',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const TOOLS = ['mcp__zenborg__set_active_moment', 'mcp__zenborg__add_moment']

const base = () => ({
  'phaseConfigs.json': { m: { phase: 'MORNING', label: 'Morning', startHour: 7, endHour: 13 } },
  'areas.json': { fun: { id: 'fun', name: 'Entertainment', emoji: '🍿' } },
  'habits.json': {},
  'moments.json': {},
  'activeMoment.json': {},
})

// Stands for the engine: the vault on disk, the clock, the zenborg MCP tools.
// A successful set_active_moment moves the pointer, as the app would.
const garden = (on: On, files: Record<string, unknown>, opts: { tools?: string[]; fail?: boolean } = {}) => {
  const calls: { tool: string; input: Record<string, unknown> }[] = []
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/g' : undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('fs.read', (_, e) => {
    const name = e.path.replace(ROOT, '')
    if (!(name in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: JSON.stringify(files[name]) }
  })
  on('tool.list', () => ({ value: (opts.tools ?? TOOLS).map(name => ({ name, description: '' })) }))
  on('tool.call', (_, e) => {
    const { tool, ...input } = e as { tool: string } & Record<string, unknown>
    calls.push({ tool, input })
    if (opts.fail) return { result: {}, text: 'Error: no', isError: true }
    if (tool.endsWith('__add_moment')) return { result: {}, text: JSON.stringify({ created: { id: 'new1' } }) }
    files['activeMoment.json'] = { momentId: input.momentIdOrName, at: new Date(NOW).toISOString() }
    files['moments.json'] = { ...(files['moments.json'] as object), new1: { id: 'new1', name: 'meditation', day: TODAY, phase: 'MORNING' } }
    return { result: {}, text: JSON.stringify({ set: {} }) }
  })
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { calls, statuses, toasts }
}

const staleWithThree = () => ({
  ...base(),
  'moments.json': {
    n: { id: 'n', name: 'Netflix', day: TODAY, phase: 'AFTERNOON', areaId: 'fun' },
    a: { id: 'a', name: 'meditation', day: TODAY, phase: 'MORNING', emoji: '🧘', order: 1 },
    b: { id: 'b', name: 'breakfast', day: TODAY, phase: 'MORNING', emoji: '🥐', order: 2 },
    c: { id: 'c', name: 'quality time', day: TODAY, phase: 'MORNING', emoji: '🟰', order: 3 },
  },
  'activeMoment.json': { momentId: 'n', at: new Date(NOW - 60_000).toISOString() },
})

test('a stale moment: status line, band with three taps; a tap tends it and the band leaves', async ($, on) => {
  const { calls, statuses } = garden(on, staleWithThree())
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(statuses.at(-1)).toBe('≋ 🍿 Netflix · from the afternoon')

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: '≋ Netflix is from the afternoon' })).toBeDefined()
  expect((await ui.find({ key: 'tap-1' }))?.props.label).toBe('🥐 breakfast')
  for (const key of ['tap-0', 'tap-1', 'tap-2', 'later']) {
    expect((await ui.find({ key }))?.props.autoFocus).toBeUndefined()
    expect((await ui.find({ key }))?.props.variant).toBeUndefined()
  }

  await ui.press({ key: 'tap-1' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__set_active_moment', input: { momentIdOrName: 'b' } }])
  expect(await ui.find({ key: 'tap-0' })).toBeUndefined()
  expect(statuses.at(-1)).toBe('≋ 🥐 breakfast')
  await ui.unmount()
})

test('nothing planted: a habit tap plants it today in this phase, then tends it', async ($, on) => {
  const { calls } = garden(on, {
    ...base(),
    'habits.json': { h1: { id: 'h1', name: 'meditation', phase: 'MORNING', emoji: '🧘' } },
  })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: '≋ Nothing planted this morning' })).toBeDefined()
  await ui.press({ key: 'tap-0' })
  expect(calls).toEqual([
    { tool: 'mcp__zenborg__add_moment', input: { habitId: 'h1', day: TODAY, phase: 'MORNING' } },
    { tool: 'mcp__zenborg__set_active_moment', input: { momentIdOrName: 'new1' } },
  ])
  await ui.unmount()
})

test('Later hides the band for this phase, across turns', async ($, on) => {
  garden(on, staleWithThree())
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'later' })
  expect(await ui.find({ key: 'tap-0' })).toBeUndefined()
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await ui.find({ key: 'tap-0' })).toBeUndefined()
  await ui.unmount()
})

test('a failing write toasts once and leaves the band as it was', async ($, on) => {
  const { toasts } = garden(on, staleWithThree(), { fail: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'tap-0' })
  expect(toasts).toEqual(['zenborg: not saved, try again'])
  expect((await ui.find({ key: 'tap-0' }))?.props.label).toBe('🧘 meditation')
  await ui.unmount()
})

test('no zenborg MCP server: status line only, the drawing goes to the engine', async ($, on) => {
  const { statuses } = garden(on, staleWithThree(), { tools: ['Read'] })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(statuses.at(-1)).toBe('≋ 🍿 Netflix · from the afternoon')
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('a fresh moment: no band', async ($, on) => {
  garden(on, {
    ...base(),
    'moments.json': { n: { id: 'n', name: 'Netflix', day: TODAY, phase: 'MORNING', areaId: 'fun' } },
    'activeMoment.json': { momentId: 'n', at: new Date(NOW - 60_000).toISOString() },
  })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
```

If a mock's result shape is refused by the harness, read that event's `EventResults` entry in the types file and match it; do not change what the tests assert.

- [ ] **Step 3: Run it to verify it fails**

Run: `claude plugin test plugin`
Expected: the six moment-band tests FAIL (module `./moment-band.tsx` missing or nothing drawn).

- [ ] **Step 4: Write the mod**

`plugin/hooks/moment-band.tsx`:

```tsx
// The moment band: when the active moment is stale or none is set, one line
// above the prompt offers this phase's moments to tend, or habits to plant.
// The status line carries the active moment. Writes go only through zenborg's
// MCP tools, so the vault keeps one writer.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Tap } from '../types'
import { reading, type Vault } from './garden.ts'

const band = atom({ plugin: 'zenborg', key: 'band' } as const, null)
// "<day> <phase>" the gardener set aside with Later.
const later = atom({ plugin: 'zenborg', key: 'later' } as const, null)

// Fail soft: a missing or malformed file reads as empty.
const readJson = async <T,>($: EngineInterface, path: string, empty: T): Promise<T> => {
  try {
    return (JSON.parse(await $.fs.read(path)) ?? empty) as T
  } catch {
    return empty
  }
}

const loadVault = async ($: EngineInterface): Promise<Vault> => {
  const root = (await $.env.get('ZENBORG_HOME')) ?? `${await $.env.get('HOME')}/.zenborg`
  const [active, moments, habits, areas, phases] = await Promise.all([
    readJson($, `${root}/activeMoment.json`, {}),
    readJson($, `${root}/moments.json`, {}),
    readJson($, `${root}/habits.json`, {}),
    readJson($, `${root}/areas.json`, {}),
    readJson($, `${root}/phaseConfigs.json`, {}),
  ])
  return { active, moments, habits, areas, phases }
}

// The zenborg MCP tool by suffix: the server may be registered under another name.
const toolNamed = async ($: EngineInterface, name: string) =>
  (await $.tool.list()).find(t => t.name.endsWith(`__${name}`))?.name

// The tool's text, or undefined on a deny, an error, or no such tool.
const call = async ($: EngineInterface, name: string, input: Record<string, unknown>) => {
  const tool = await toolNamed($, name)
  if (!tool) return undefined
  try {
    const r = await $.tool.call({ tool, ...input } as Parameters<EngineInterface['tool']['call']>[0])
    return r.deny !== undefined || r.isError ? undefined : (r.text ?? '')
  } catch {
    return undefined
  }
}

const createdId = (text: string | undefined) => {
  try {
    return text ? (JSON.parse(text).created?.id as string | undefined) : undefined
  } catch {
    return undefined
  }
}

const refresh = async ($: EngineInterface) => {
  const r = reading(await loadVault($), new Date(await $.clock.now()))
  $.ui.status(r?.status)
  const canWrite = (await toolNamed($, 'set_active_moment')) !== undefined
  await update($, band, () => (canWrite ? (r?.band ?? null) : null))
}

const tap = async ($: EngineInterface, t: Tap, b: Band) => {
  // Takes the band down first; a second press finds nothing to take.
  let taken = false
  await update($, band, cur => ((taken = cur !== null), null))
  if (!taken) return
  const momentId =
    t.kind === 'tend'
      ? t.momentId
      : createdId(await call($, 'add_moment', { habitId: t.habitId, day: b.day, phase: b.phase }))
  const set = momentId === undefined ? undefined : await call($, 'set_active_moment', { momentIdOrName: momentId })
  if (set === undefined) $.ui.toast('zenborg: not saved, try again')
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  // Main loop only. The turn starts first; the garden is read after.
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, band)
    if (b === null || e.props.hasSurvey || (await read($, later)) === `${b.day} ${b.phase}`) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // Board order, nothing primary, nothing focused: the gardener chooses.
    return (
      <Box flexDirection="column" width={e.props.bodyColumns} paddingX={2}>
        <Text dimColor>{b.line}</Text>
        <Box gap={2}>
          {b.taps.map((t, i) => (
            <Button key={`tap-${i}`} label={t.label} onPress={() => tap($, t, b)} />
          ))}
          <Button key="later" label="Later" onPress={() => update($, later, () => `${b.day} ${b.phase}`)} />
        </Box>
      </Box>
    )
  })
}
```

- [ ] **Step 5: Run the checks**

Run: `claude plugin test plugin` (all pass), `claude plugin validate plugin` (no refusals; it lists `fs.read`, `env.get` names `ZENBORG_HOME` and `HOME`, `tool.call`), `cd plugin && pnpm test` (all pass), root `pnpm test` (all pass). Once the engine has laid the mod's types under `plugin/.claude-plugin/types/`, `tsc -p plugin` too; fix type errors without changing behaviour.

- [ ] **Step 6: Name it in the README**

Append to `plugin/README.md`: `Moment band: when the active moment is stale or none is set, a line above the prompt offers this phase's moments to tend, or routines to plant. The status line carries the active moment. Needs a Claude Code build that loads mods.`

- [ ] **Step 7: Commit**

```bash
git add plugin/hooks/moment-band.tsx plugin/hooks/moment-band.test.tsx plugin/hooks/hooks.json plugin/.claude-plugin/plugin.json plugin/README.md tsconfig.json
git commit -m "feat(plugin): the moment band, stale or missing intention as taps above the prompt"
```

---

### Task 3: moment-awareness reports facts only

**Files:**
- Modify: `plugin/hooks/moment-awareness.mts`
- Test: `plugin/hooks/moment-awareness.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: SessionStart text with no `Propose` and no tool names for picking or planting.

- [ ] **Step 1: Write the failing tests**

Append to `plugin/hooks/moment-awareness.test.mjs`:

```js
test("a stale active moment is stated, never proposed", () => {
  const vault = garden(wakingDayKey());
  writeFileSync(
    join(vault, "moments.json"),
    JSON.stringify({ m1: { id: "m1", name: "write spec", day: wakingDayKey(), phase: "OTHER" } }),
  );
  const out = run(vault);
  assert.match(out, /stale active "write spec"/);
  assert.doesNotMatch(out, /Propose|set_active_moment/);
});

test("no active moment lists what is planted and proposes nothing", () => {
  const vault = garden(wakingDayKey());
  writeFileSync(join(vault, "activeMoment.json"), "{}");
  const out = run(vault);
  assert.match(out, /No active intention/);
  assert.match(out, /Planted this phase: "write spec"/);
  assert.doesNotMatch(out, /Propose|set_active_moment|spawn_spontaneous|add_moment/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd plugin && node --test hooks/moment-awareness.test.mjs`
Expected: the two new tests FAIL on `Propose`.

- [ ] **Step 3: Make the hook report facts**

In `plugin/hooks/moment-awareness.mts`:

1. Header comment: replace the second paragraph with `Fires on SessionStart. Reports the garden's intention as context for Claude: the active moment, or that none is set and what is planted this phase. It proposes nothing; the gardener picks in the moment band.` and drop the line about proposing a match and suggesting habits.
2. Delete the `Habit` interface, `matchArea`, the `habitsMap` read, and the `areas` / `cwd` / `matchedArea` / `todayMoments` locals.
3. Replace `const phaseMoments = …` with:

```ts
  const phaseMoments = Object.values(momentsMap).filter(
    (m) => m.day?.startsWith(today) && m.phase === phase!.phase,
  );
```

4. In the stale branch, replace the `process.stdout.write(…)` with:

```ts
        process.stdout.write(
          `<zenborg-intention: stale active "${active.name}"${areaLabel}: ${why}.>`,
        );
```

5. Replace everything from `// ── No active moment → propose one` to the end of `main()` with:

```ts
  // ── No active moment → the facts. The gardener picks in the moment band.
  const planted = phaseMoments
    .map((m) => {
      const area = m.areaId ? areasMap[m.areaId] : null;
      return `"${m.name}"${area ? ` (${area.name})` : ""}`;
    })
    .join(", ");
  process.stdout.write(
    `<zenborg-intention: ${released}No active intention. ` +
      `Phase: ${phase!.label} (${phase!.startHour}:00–${phase!.endHour}:00). ` +
      (planted ? `Planted this phase: ${planted}.` : "Nothing planted this phase.") +
      ">",
  );
  process.exit(0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugin && pnpm test`
Expected: all pass, including the two existing moment-awareness tests.

- [ ] **Step 5: Commit, push, PR**

```bash
git add plugin/hooks/moment-awareness.mts plugin/hooks/moment-awareness.test.mjs
git commit -m "feat(plugin): moment-awareness reports facts; the band does the picking"
git push -u origin feat/moment-band
gh pr create --base main --title "Moment band: the stale-moment prompt as taps above the prompt"
```

PR body: what the band does and why (one short section each), the commands run with their pass counts, the open checks from Task 4, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

### Task 4: Check it in a real session (the gardener, with the main session)

Not for the builder. After the PR is up:

- [ ] Run `claude --plugin-dir ~/Developer/equanimitech/zenborg/plugin` from the PR's worktree with a stale active moment: the band shows, the status line reads `≋ … · from the …`.
- [ ] Phase and day are right: the mod's `Date` is local time (if `getHours()` reads UTC in the mod's environment, the phase is wrong; the fix is to pass the offset from `$.clock` or `Intl`).
- [ ] The status line entry sits beside your own `statusLine`, not over it.
- [ ] A tap tends through the MCP tool, the app shows the new intention, and no permission prompt appears for `mcp__zenborg__*` under your auto mode.
- [ ] With oliba's wait band also due, only one band draws at a time: note which wins.
- [ ] An older Claude Code build still runs the shell hooks with `"modules"` present in `hooks.json`.
