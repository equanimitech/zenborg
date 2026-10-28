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
  'habits.json': { h1: { id: 'h1', name: 'tea', emoji: '🍵', areaId: 'body' } },
  'moments.json': {
    s: { id: 's', name: 'strategy', emoji: '♟️', day: TODAY, phase: 'MORNING', areaId: 'work', order: 0 },
    z: { id: 'z', name: 'loose', day: TODAY, phase: 'MORNING', order: 0 },
    b: { id: 'b', name: 'tea', habitId: 'h1', day: TODAY, phase: 'MORNING', areaId: 'body', order: 2 },
    a: { id: 'a', name: 'sit', emoji: '🧘', day: TODAY, phase: 'MORNING', areaId: 'body', order: 1 },
    c: { id: 'c', name: 'film', day: TODAY, phase: 'AFTERNOON', areaId: 'body' },
    d: { id: 'd', name: 'plan', emoji: '📐', day: null, phase: null, areaId: 'work' },
  },
  'activeMoment.json': { momentId: 'b', at: new Date(NOW).toISOString() },
})

// Stands for the engine: the vault on disk, the clock, the zenborg MCP tools
// (update_moment moves a moment, as the server would), Haiku, and the surface.
const garden = (on: On, opts: { reply?: string; placed?: boolean } = {}) => {
  const vault = files()
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

test('/phase opens on the current phase: moments under area headers, areas in order, no area last, then the board', async ($, on) => {
  const { opened } = garden(on)
  await $.command.run({ command: 'phase', args: '', ...RUN })
  expect(opened[0]).toMatchObject({ id: 'zenborg-phase', title: '🌄 Morning', focus: true, closeOnEscape: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '🌄 Morning · Tue 27 Oct · now' })).toBeDefined()
    const headers = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const at = (h: string) => headers.indexOf(h)
    expect(at('🏃 Body')).toBeGreaterThan(-1)
    expect(at('🏃 Body')).toBeLessThan(at('💼 Work'))
    expect(at('💼 Work')).toBeLessThan(at('no area'))
    expect(at('no area')).toBeLessThan(at('── board ──'))
    // Own emoji, else the habit's; the active moment is marked.
    expect(await label(ui, 'row-a')).toBe('› ├ 🧘 sit')
    expect(await label(ui, 'row-b')).toBe('  └ 🍵 tea ●')
    expect(await label(ui, 'row-s')).toBe('  └ ♟️ strategy')
    expect(await label(ui, 'row-z')).toBe('  └ loose')
    expect(await label(ui, 'row-d')).toBe('  └ 📐 plan')
    expect(await ui.find({ key: 'row-c' })).toBeUndefined()
    await ui.unmount()
  }
})

test('j walks the moment rows only, past the headers, held at the end', async ($, on) => {
  garden(on)
  const ui = await $.ui.mount(PANE)
  const focused = async () => (await ui.findAll({ type: 'Button' })).find(b => String(b.props.label).startsWith('›'))?.key
  expect(await focused()).toBe('row-a')
  for (const key of ['row-b', 'row-s', 'row-z', 'row-d', 'row-d']) {
    await ui.press({ key: 'down' })
    expect(await focused()).toBe(key)
  }
  await ui.press({ key: 'up' })
  expect(await focused()).toBe('row-z')
  await ui.unmount()
})

test('a hotkey moves the focused row through update_moment; the cursor takes the next row, then follows a moment to the board', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ key: 'act-next' }))?.props.hotkey).toBe('n')
  await ui.press({ key: 'act-next' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__update_moment', input: { id: 'a', day: TODAY, phase: 'AFTERNOON' } }])
  expect(await ui.find({ key: 'row-a' })).toBeUndefined()
  expect(await label(ui, 'row-b')).toBe('› └ 🍵 tea ●')

  // b sends tea to the board; it stays drawn there, and the cursor with it.
  await ui.press({ key: 'act-board' })
  expect(calls[1]).toEqual({ tool: 'mcp__zenborg__update_moment', input: { id: 'b', day: null } })
  expect(await label(ui, 'row-b')).toBe('› └ 🍵 tea ●')

  // l steps the view to the afternoon, where sit now is, and retitles.
  await ui.press({ key: 'view-next' })
  expect(await ui.find({ type: 'Text', text: '☀️ Afternoon · Tue 27 Oct' })).toBeDefined()
  expect(await ui.find({ key: 'row-a' })).toBeDefined()
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

type Call = Parameters<EngineInterface['tool']['call']>[0]

test('the open_phase_pane tool opens the pane at its day and phase, without taking the keyboard', async ($, on) => {
  const { opened, calls } = garden(on)
  const r = await $.tool.call({ tool: 'mcp__zenborg__open_phase_pane', day: 'tomorrow', phase: 'MORNING' } as Call)
  expect(r.text).toBe('Opened the phase pane at 🌄 Morning · Wed 28 Oct.')
  expect(opened[0]).toMatchObject({ id: 'zenborg-phase', title: '🌄 Morning', closeOnEscape: true })
  expect(opened[0]?.focus).toBeUndefined()
  expect(calls).toEqual([])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '🌄 Morning · Wed 28 Oct' })).toBeDefined()
  await ui.unmount()
})

test('the tool says when the pane waits undrawn, and how to show it', async ($, on) => {
  garden(on, { placed: false })
  const r = await $.tool.call({ tool: 'mcp__zenborg__open_phase_pane', day: 'tomorrow', phase: 'MORNING' } as Call)
  expect(r.text).toBe(
    'The pane is open but not drawn (unasked below 144 columns (now 100)). The gardener can type /phase tomorrow MORNING to show it.',
  )
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
