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
    // tool_use_id is the engine's envelope, not the tool's input.
    const { tool, tool_use_id: _envelope, ...input } = e as { tool: string; tool_use_id: string } & Record<string, unknown>
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
