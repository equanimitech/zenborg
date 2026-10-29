import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const NOW = new Date(2026, 9, 27, 9).getTime() // Tue, morning
const TODAY = '2026-10-27'
const ROOT = '/home/g/.zenborg/'
const PANE = {
  plugin: 'zenborg',
  component: 'Pane',
  requestId: 'zenborg-phase',
  surface: 'terminal',
  props: { title: 'Phase', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const TOOLS = ['update_moment', 'unallocate_moment', 'add_moment', 'set_active_moment', 'delete_moment'].map(
  t => `mcp__zenborg__${t}`,
)
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const history = (rows: [string, string, string][]) =>
  Object.fromEntries(rows.map(([habitId, day, phase], i) => [`x${i}`, { id: `x${i}`, name: habitId, habitId, day, phase }]))

// Morning's config has its own emoji; the others fall back to the phase's.
const files = (): Record<string, unknown> => ({
  'phaseConfigs.json': {
    m: { phase: 'MORNING', label: 'Morning', emoji: '🌄', startHour: 7, endHour: 13 },
    a: { phase: 'AFTERNOON', label: 'Afternoon', startHour: 13, endHour: 19 },
    e: { phase: 'EVENING', label: 'Evening', startHour: 19, endHour: 23 },
    n: { phase: 'NIGHT', label: 'Night', startHour: 23, endHour: 7 },
  },
  'areas.json': {
    work: { id: 'work', name: 'Work', emoji: '💼', order: 2 },
    body: { id: 'body', name: 'Body', emoji: '🏃', order: 1 },
  },
  'habits.json': {
    h1: { id: 'h1', name: 'tea', emoji: '🍵', areaId: 'body' },
    hs: { id: 'hs', name: 'plan', emoji: '📐', areaId: 'work' },
    hr: { id: 'hr', name: 'run', emoji: '🏃', areaId: 'body' },
    hg: { id: 'hg', name: 'guitar', emoji: '🎸', areaId: 'body' },
    hp: { id: 'hp', name: 'wine', areaId: 'body', attitude: 'PRUNING' },
    ha: { id: 'ha', name: 'old', areaId: 'body', isArchived: true },
  },
  'cycles.json': { c1: { id: 'c1', startDate: '2026-10-24', endDate: '2026-11-10', areaIntentions: { body: 'play guitar' } } },
  'moments.json': {
    s: { id: 's', name: 'strategy', emoji: '♟️', day: TODAY, phase: 'MORNING', areaId: 'work', order: 0 },
    z: { id: 'z', name: 'loose', day: TODAY, phase: 'MORNING', order: 0 },
    b: { id: 'b', name: 'tea', habitId: 'h1', day: TODAY, phase: 'MORNING', areaId: 'body', order: 2 },
    a: { id: 'a', name: 'sit', emoji: '🧘', day: TODAY, phase: 'MORNING', areaId: 'body', order: 1 },
    w: { id: 'w', name: 'walk', day: TODAY, phase: 'MORNING', areaId: 'body', order: 3 },
    c: { id: 'c', name: 'film', day: TODAY, phase: 'AFTERNOON', areaId: 'body' },
    d: { id: 'd', name: 'plan', emoji: '📐', day: null, phase: null, areaId: 'work' },
    // History: plan on two mornings (one a Tuesday), run once, a pruned and an archived habit, guitar in the afternoons.
    ...history([
      ['hs', '2026-10-26', 'MORNING'], ['hs', '2026-10-20', 'MORNING'], ['hr', '2026-10-25', 'MORNING'],
      ['hp', '2026-10-26', 'MORNING'], ['hp', '2026-10-25', 'MORNING'], ['hp', '2026-10-24', 'MORNING'],
      ['ha', '2026-10-26', 'MORNING'],
      ['hg', '2026-10-10', 'AFTERNOON'], ['hg', '2026-10-03', 'AFTERNOON'], ['hg', '2026-09-26', 'AFTERNOON'],
    ]),
  },
  'activeMoment.json': { momentId: 'b', at: new Date(NOW).toISOString() },
})

// Stands for the engine: the vault on disk, the clock, the zenborg MCP tools
// (update_moment moves a moment, as the server would), Haiku, and the surface.
const garden = (on: On, opts: { reply?: string; placed?: boolean; extra?: Record<string, unknown> } = {}) => {
  const vault = files()
  Object.assign(vault['moments.json'] as object, opts.extra)
  const calls: { tool: string; input: Record<string, unknown> }[] = []
  const asks: { model: string }[] = []
  const opened: Record<string, unknown>[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/g' : undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('fs.read', (_, e) => {
    const name = e.path.replace(ROOT, '')
    if (!(name in vault)) throw new Error(`ENOENT ${e.path}`)
    return { value: JSON.stringify(vault[name]) }
  })
  on('tool.list', () => ({ value: TOOLS.map(name => ({ name, description: '', mcp: true })) }))
  on('tool.call', (_, e) => {
    const { tool, tool_use_id: _envelope, ...input } = e as { tool: string; tool_use_id: string } & Record<string, unknown>
    calls.push({ tool, input })
    const moments = vault['moments.json'] as Record<string, Record<string, unknown>>
    const m = moments[input.id as string]
    if (tool.endsWith('__update_moment') && m) moments[m.id as string] = { ...m, day: input.day, phase: input.phase ?? null }
    if (tool.endsWith('__delete_moment') && m) delete moments[m.id as string]
    if (tool.endsWith('__add_moment')) moments.added = { id: 'added', name: 'new', habitId: input.habitId, day: input.day, phase: input.phase }
    return { result: {}, text: '{}' }
  })
  on('model.complete', (_, e) => {
    asks.push(e)
    return {
      value:
        opts.reply === undefined
          ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
          : { isAnswered: true, text: opts.reply, usage: USAGE },
    }
  })
  on('command.register', () => ({ value: { command: 'phase' } }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: opts.placed === false ? { isPlaced: false, reason: 'unasked below 144 columns (now 100)' } : { isPlaced: true } }
  })
  return { calls, asks, opened }
}

const label = async (ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, key: string) =>
  (await ui.find({ key }))?.props.label

test('/phase opens on the current phase: a flat list of moments (areas in order, no area last, no headers or branches), then the suggestions', async ($, on) => {
  const { opened } = garden(on)
  await $.command.run({ command: 'phase', args: '', ...RUN })
  expect(opened[0]).toMatchObject({ id: 'zenborg-phase', title: '🌄 Morning', focus: true, closeOnEscape: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '🌄 Morning · Tue 27 Oct · now' })).toBeDefined()
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    // The current phase is flat: no area headers; the board keeps its tree.
    expect(texts).not.toContain('🏃 Body')
    expect(texts).not.toContain('no area')
    expect(texts.indexOf('── board ──')).toBeGreaterThan(-1)
    // The drawing board no longer renders; the two suggestion rows follow the divider.
    expect(texts.indexOf('your rhythm')).toBe(texts.indexOf('── board ──') + 1)
    expect(texts.indexOf('your season')).toBeGreaterThan(texts.indexOf('your rhythm'))
    const labels = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))
    expect(labels.some(l => l.includes('├') || l.includes('└'))).toBe(false)
    // Own emoji, else the habit's, else the area's; the active moment is marked.
    expect(await label(ui, 'row-a')).toBe('› 🧘 sit')
    expect(await label(ui, 'row-b')).toBe('  🍵 tea ●')
    expect(await label(ui, 'row-w')).toBe('  🏃 walk')
    expect(await label(ui, 'row-s')).toBe('  ♟️ strategy')
    expect(await label(ui, 'row-z')).toBe('  loose')
    expect(await ui.find({ key: 'row-d' })).toBeUndefined()
    expect(await ui.find({ key: 'row-c' })).toBeUndefined()
    // Never the pruned or archived habit; the planted tea is not offered again. Haiku is down: guitar is the area's most planted.
    expect(await label(ui, 'row-sug:rhythm:hs')).toBe('  📐 plan')
    expect(await label(ui, 'row-sug:rhythm:hr')).toBe('  🏃 run')
    expect(await label(ui, 'row-sug:season:hg')).toBe('  🎸 guitar · last planted 17 days ago')
    expect((await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('row-sug')).length).toBe(3)
    await ui.unmount()
  }
})

test('j walks the moment rows only, past the headers, held at the end', async ($, on) => {
  garden(on)
  const ui = await $.ui.mount(PANE)
  const focused = async () => (await ui.findAll({ type: 'Button' })).find(b => String(b.props.label).startsWith('›'))?.key
  expect(await focused()).toBe('row-a')
  for (const key of ['row-b', 'row-w', 'row-s', 'row-z', 'row-sug:rhythm:hs', 'row-sug:rhythm:hr', 'row-sug:season:hg', 'row-sug:season:hg']) {
    await ui.press({ key: 'down' })
    expect(await focused()).toBe(key)
  }
  await ui.press({ key: 'up' })
  expect(await focused()).toBe('row-sug:rhythm:hr')
  await ui.unmount()
})

test('i plants the focused suggestion into the shown phase through add_moment; nothing plants before the keypress', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  for (let i = 0; i < 5; i++) await ui.press({ key: 'down' })
  expect(calls).toEqual([])
  expect((await ui.find({ key: 'sug-plant' }))?.props.hotkey).toBe('i')
  await ui.press({ key: 'sug-plant' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__add_moment', input: { habitId: 'hs', day: TODAY, phase: 'MORNING' } }])
  // The row leaves the suggestions and the moment joins the phase.
  expect(await ui.find({ key: 'row-sug:rhythm:hs' })).toBeUndefined()
  expect(await ui.find({ key: 'row-added' })).toBeDefined()
  expect(await label(ui, 'row-sug:rhythm:hr')).toBe('› 🏃 run')
  await ui.unmount()
})

test('z hides a suggestion for the waking day, plants nothing, and the next candidate takes its place', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  for (let i = 0; i < 5; i++) await ui.press({ key: 'down' })
  expect((await ui.find({ key: 'sug-hide' }))?.props.hotkey).toBe('z')
  await ui.press({ key: 'sug-hide' })
  expect(calls).toEqual([])
  expect(await ui.find({ key: 'row-sug:rhythm:hs' })).toBeUndefined()
  expect(await ui.find({ key: 'row-sug:rhythm:hr' })).toBeDefined()
  await ui.unmount()
})

test('opening asks Haiku once per cycle: it fills the season row, and reopening or redrawing never asks again', async ($, on) => {
  const { asks, calls } = garden(on, { reply: '{"body":["hg","hp","nope"]}' })
  await $.command.run({ command: 'phase', args: '', ...RUN })
  expect(asks.length).toBe(1)
  expect(asks[0]?.model).toBe('claude-haiku-5-5')
  let ui = await $.ui.mount(PANE)
  expect(await label(ui, 'row-sug:season:hg')).toBe('  🎸 guitar · last planted 17 days ago')
  // A write redraws the pane; a second /phase reopens it.
  for (let i = 0; i < 5; i++) await ui.press({ key: 'down' })
  await ui.press({ key: 'sug-plant' })
  expect(calls.length).toBe(1)
  await ui.unmount()
  await $.command.run({ command: 'phase', args: 'evening', ...RUN })
  expect(asks.length).toBe(1)
})

test('an intention Haiku maps to no habit gets no season row', async ($, on) => {
  garden(on, { reply: '{"body":[]}' })
  await $.command.run({ command: 'phase', args: '', ...RUN })
  const ui = await $.ui.mount(PANE)
  // The mapping lands after /phase returns, with the fallback row showing meanwhile.
  for (let i = 0; i < 50 && (await ui.find({ type: 'Text', text: 'your season' })); i++) await new Promise(r => setTimeout(r, 10))
  expect(await ui.find({ type: 'Text', text: 'your season' })).toBeUndefined()
  await ui.unmount()
})

test('a hotkey moves the focused row through update_moment; the cursor takes the next row', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ key: 'act-next' }))?.props.hotkey).toBe('n')
  await ui.press({ key: 'act-next' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__update_moment', input: { id: 'a', day: TODAY, phase: 'AFTERNOON' } }])
  expect(await ui.find({ key: 'row-a' })).toBeUndefined()
  expect(await label(ui, 'row-b')).toBe('› 🍵 tea ●')


  // l steps the view to the afternoon, where sit now is, and retitles.
  await ui.press({ key: 'view-next' })
  expect(await ui.find({ type: 'Text', text: '☀️ Afternoon · Tue 27 Oct' })).toBeDefined()
  expect(await ui.find({ key: 'row-a' })).toBeDefined()
  await ui.unmount()
})

test('d needs two presses to delete; the cursor takes the next row; b is gone', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'act-board' })).toBeUndefined()
  expect((await ui.find({ key: 'act-delete' }))?.props.hotkey).toBe('d')
  await ui.press({ key: 'act-delete' })
  expect(calls).toEqual([])
  expect(await label(ui, 'act-delete')).toBe('d again to delete')
  await ui.press({ key: 'act-delete' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__delete_moment', input: { id: 'a' } }])
  expect(await ui.find({ key: 'row-a' })).toBeUndefined()
  expect(await label(ui, 'row-b')).toBe('› 🍵 tea ●')
  expect(await label(ui, 'act-delete')).toBe('delete')
  await ui.unmount()
})

test('d, then j, then d does not delete', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'act-delete' })
  await ui.press({ key: 'down' })
  expect(await label(ui, 'act-delete')).toBe('delete')
  await ui.press({ key: 'act-delete' })
  expect(calls).toEqual([])
  expect(await label(ui, 'act-delete')).toBe('d again to delete')
  await ui.unmount()
})

test('/phase reads a day and a phase; anything else falls back to now with a note', async ($, on) => {
  const { opened } = garden(on)
  const cases: [string, string][] = [
    ['tomorrow evening', '🌙 Evening · Wed 28 Oct'],
    ['thu', '🌄 Morning · Thu 29 Oct'],
    ['evening', '🌙 Evening · Tue 27 Oct'],
    ['2026-11-02 night', '🌌 Night · Mon 2 Nov'],
    ['TODAY', '🌄 Morning · Tue 27 Oct · now'],
  ]
  for (const [args, title] of cases) {
    await $.command.run({ command: 'phase', args, ...RUN })
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    await ui.unmount()
  }
  expect(opened[0]?.title).toBe('🌙 Evening')

  await $.command.run({ command: 'phase', args: 'someday soon', ...RUN })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '🌄 Morning · Tue 27 Oct · now' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'could not read "someday soon"; showing now' })).toBeDefined()
  await ui.unmount()
})

test("Haiku's reply is previewed strictly with the rows' emojis: unknown ids and ops dropped, nothing written before Apply", async ($, on) => {
  const reply = `\`\`\`json
[{"op":"move","id":"b","day":"2026-10-29","phase":"MORNING"},
 {"op":"move","id":"zzz","day":"2026-10-29","phase":"MORNING"},
 {"op":"rename","id":"a","name":"x"},
 {"op":"delete","id":"s"}]
\`\`\``
  const { calls, asks } = garden(on, { reply })
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'ask', text: 'move tea to thursday morning' })
  expect(asks[0]?.model).toBe('claude-haiku-5-5')
  expect(await ui.find({ type: 'Text', text: /🍵 tea → Thu morning/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dropped: unknown moment "zzz"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dropped: unknown op "rename"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dropped: delete of "strategy" not asked for/ })).toBeDefined()
  expect(calls).toEqual([])

  // Enter on the emptied line applies.
  await ui.input({ key: 'ask', text: '' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__update_moment', input: { id: 'b', day: '2026-10-29', phase: 'MORNING' } }])
  expect(await ui.find({ key: 'apply' })).toBeUndefined()
  await ui.unmount()
})

test('Discard drops the proposal and writes nothing', async ($, on) => {
  const { calls } = garden(on, { reply: '[{"op":"active","id":"a"}]' })
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'ask', text: 'sit now' })
  expect(await ui.find({ type: 'Text', text: /≋ 🧘 sit as active/ })).toBeDefined()
  await ui.press({ key: 'discard' })
  expect(await ui.find({ key: 'apply' })).toBeUndefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('Haiku not answering shows a short line and changes nothing', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'ask', text: 'move everything' })
  expect(await ui.find({ type: 'Text', text: 'haiku did not answer (api-error); nothing changed' })).toBeDefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('a habit shown under your rhythm is not offered again under your season', async ($, on) => {
  // Guitar is planted on three mornings, so it leads the rhythm row.
  garden(on, { extra: history([['hg', '2026-10-26', 'MORNING'], ['hg', '2026-10-25', 'MORNING'], ['hg', '2026-10-24', 'MORNING']]) })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'row-sug:rhythm:hg' })).toBeDefined()
  expect(await ui.find({ key: 'row-sug:season:hg' })).toBeUndefined()
  await ui.unmount()
})
