import { expect, test } from 'claude-code/testing'
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
  props: { title: 'Phase', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const TOOLS = ['update_moment', 'unallocate_moment', 'add_moment', 'set_active_moment', 'delete_moment'].map(
  t => `mcp__zenborg__${t}`,
)
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const files = (): Record<string, unknown> => ({
  'phaseConfigs.json': {
    m: { phase: 'MORNING', label: 'Morning', startHour: 7, endHour: 13 },
    a: { phase: 'AFTERNOON', label: 'Afternoon', startHour: 13, endHour: 19 },
    e: { phase: 'EVENING', label: 'Evening', startHour: 19, endHour: 23 },
    n: { phase: 'NIGHT', label: 'Night', startHour: 23, endHour: 7 },
  },
  'areas.json': { body: { id: 'body', name: 'Body' }, work: { id: 'work', name: 'Work' } },
  'habits.json': {},
  'moments.json': {
    a: { id: 'a', name: 'sit', emoji: '🧘', day: TODAY, phase: 'MORNING', areaId: 'body', order: 1 },
    b: { id: 'b', name: 'tea', day: TODAY, phase: 'MORNING', areaId: 'body', order: 2 },
    c: { id: 'c', name: 'film', day: TODAY, phase: 'AFTERNOON', areaId: 'body' },
    d: { id: 'd', name: 'strategy', emoji: '♟️', day: null, phase: null, areaId: 'work' },
  },
  'activeMoment.json': {},
})

// Stands for the engine: the vault on disk, the clock, the zenborg MCP tools
// (update_moment moves a moment, as the server would), and Haiku.
const garden = (on: On, reply?: string) => {
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
        reply === undefined
          ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
          : { isAnswered: true, text: reply, usage: USAGE },
    }
  })
  on('command.register', () => ({ value: { command: 'phase' } }))
  on('ui.open', (_, e) => (opened.push(e), { value: { isPlaced: true } }))
  return { calls, asks, opened }
}

test('/phase opens the pane on the current phase: its moments, then the drawing board', async ($, on) => {
  const { opened } = garden(on)
  await $.command.run({
    command: 'phase',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(opened[0]).toMatchObject({ id: 'zenborg-phase', focus: true, closeOnEscape: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'MORNING · now' })).toBeDefined()
    expect((await ui.find({ key: 'row-a' }))?.props.label).toBe('› 🧘 sit')
    expect((await ui.find({ key: 'row-b' }))?.props.label).toBe('  tea')
    expect(await ui.find({ key: 'row-c' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'drawing board' })).toBeDefined()
    expect((await ui.find({ key: 'row-d' }))?.props.label).toBe('  ♟️ strategy')
    await ui.unmount()
  }
})

test('a hotkey on the focused row moves it through update_moment, and the pane re-reads', async ($, on) => {
  const { calls } = garden(on)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ key: 'act-next' }))?.props.hotkey).toBe('n')
  await ui.press({ key: 'act-next' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__update_moment', input: { id: 'a', day: TODAY, phase: 'AFTERNOON' } }])
  expect(await ui.find({ key: 'row-a' })).toBeUndefined()

  // The focus falls to tea; b sends it back to the drawing board.
  expect((await ui.find({ key: 'act-board' }))?.props.hotkey).toBe('b')
  await ui.press({ key: 'act-board' })
  expect(calls[1]).toEqual({ tool: 'mcp__zenborg__update_moment', input: { id: 'b', day: null } })

  // l steps the view to the afternoon, where sit now is.
  await ui.press({ key: 'view-next' })
  expect(await ui.find({ type: 'Text', text: 'AFTERNOON' })).toBeDefined()
  expect(await ui.find({ key: 'row-a' })).toBeDefined()
  await ui.unmount()
})

test("Haiku's reply is previewed strictly: unknown ids and ops dropped, nothing written before Apply", async ($, on) => {
  const reply = `\`\`\`json
[{"op":"move","id":"d","day":"2026-10-29","phase":"MORNING"},
 {"op":"move","id":"zzz","day":"2026-10-29","phase":"MORNING"},
 {"op":"rename","id":"a","name":"x"},
 {"op":"delete","id":"b"}]
\`\`\``
  const { calls, asks } = garden(on, reply)
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'ask', text: 'move strategy to thursday morning' })
  expect(asks[0]?.model).toBe('claude-haiku-5-5')
  expect(await ui.find({ type: 'Text', text: /♟️ strategy → Thu morning/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dropped: unknown moment "zzz"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dropped: unknown op "rename"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dropped: delete of "tea" not asked for/ })).toBeDefined()
  expect(calls).toEqual([])

  // Enter on the emptied line applies.
  await ui.input({ key: 'ask', text: '' })
  expect(calls).toEqual([{ tool: 'mcp__zenborg__update_moment', input: { id: 'd', day: '2026-10-29', phase: 'MORNING' } }])
  expect(await ui.find({ key: 'apply' })).toBeUndefined()
  await ui.unmount()
})

test('Discard drops the proposal and writes nothing', async ($, on) => {
  const { calls } = garden(on, '[{"op":"active","id":"a"}]')
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
