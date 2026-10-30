import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const NOW = new Date(2026, 9, 27, 9).getTime()
const TODAY = '2026-10-27'
const ROOT = '/home/g/.zenborg/'
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const TOOLS = ['mcp__zenborg__set_active_moment', 'mcp__zenborg__add_moment', 'mcp__zenborg__update_moment']

const files = (): Record<string, unknown> => ({
  'phaseConfigs.json': { m: { phase: 'MORNING', label: 'Morning', startHour: 7, endHour: 13 } },
  'areas.json': { th: { id: 'th', name: 'Themia', surfaces: { paths: ['/home/g/work'] } } },
  'habits.json': { h: { id: 'h', name: 'singing', emoji: '🎸' } },
  'moments.json': {
    s: { id: 's', name: 'strategy', emoji: '♟️', day: TODAY, phase: 'MORNING', order: 2 },
    k: { id: 'k', name: 'sit', day: TODAY, phase: 'MORNING', order: 1 },
    l: { id: 'l', name: 'lunch', day: TODAY, phase: 'AFTERNOON' },
    c: { id: 'c', name: 'call', emoji: '📞' },
  },
  'activeMoment.json': {},
})

const garden = (on: On, opts: { fail?: boolean } = {}) => {
  const f = files()
  const calls: { tool: string; input: Record<string, unknown> }[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/g' : undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('session.cwd', () => ({ value: '/home/g/work' }))
  on('fs.read', (_, e) => ({ value: JSON.stringify(f[e.path.replace(ROOT, '')]) }))
  on('tool.list', () => ({ value: TOOLS.map(name => ({ name, description: '', mcp: true })) }))
  on('tool.call', (_, e) => {
    const { tool, tool_use_id: _e, ...input } = e as { tool: string; tool_use_id: string } & Record<string, unknown>
    calls.push({ tool: tool.replace('mcp__zenborg__', ''), input })
    if (opts.fail) return { result: {}, text: 'Error: no', isError: true }
    return { result: {}, text: JSON.stringify({ id: 'new1', name: 'build' }) }
  })
  on('ui.status', () => ({ value: undefined }))
  return calls
}

const run = ($: Parameters<TestBody>[0], args: string) => $.command.run({ command: 'now', args, ...RUN })
const reply = async ($: Parameters<TestBody>[0], args: string) => ((await run($, args)) as { text?: string }).text
const set = (id: string) => ({ tool: 'set_active_moment', input: { momentIdOrName: id } })

test('1 and 2: a planted moment, this phase first, else another phase; no move', async ($, on) => {
  const calls = garden(on)
  expect(await reply($, 'strat')).toBe('≋ ♟️ strategy, now')
  expect(await reply($, 'lunch')).toBe('≋ lunch, now')
  expect(calls).toEqual([set('s'), set('l')])
})

test('3: a board moment moves to today then is set', async ($, on) => {
  const calls = garden(on)
  expect(await reply($, 'call')).toBe('≋ 📞 call, from the board')
  expect(calls).toEqual([{ tool: 'update_moment', input: { id: 'c', day: TODAY, phase: 'MORNING' } }, set('c')])
})

test('4: a habit is planted then set', async ($, on) => {
  const calls = garden(on)
  expect(await reply($, 'sing')).toBe('≋ 🎸 singing, planted')
  expect(calls).toEqual([{ tool: 'add_moment', input: { habitId: 'h', day: TODAY, phase: 'MORNING' } }, set('new1')])
})

test('5: nothing matches, a new moment in the cwd area; 4+ words change nothing', async ($, on) => {
  const calls = garden(on)
  expect(await reply($, 'deep work')).toBe('≋ new moment "deep work" planted in Themia')
  expect(calls).toEqual([
    { tool: 'add_moment', input: { name: 'deep work', day: TODAY, phase: 'MORNING', areaId: 'th' } },
    set('new1'),
  ])
  calls.length = 0
  expect(await reply($, 'one two three four')).toBe('now: 3 words or fewer, nothing changed')
  expect(calls).toEqual([])
})

test('a failed write says so', async ($, on) => {
  garden(on, { fail: true })
  expect(await reply($, 'strat')).toBe('zenborg: not saved (set_active_moment failed: Error: no)')
  expect(await reply($, 'call')).toBe('zenborg: not saved (update_moment failed: Error: no)')
})

test('no words: this phase hint, no writes', async ($, on) => {
  const calls = garden(on)
  expect(await reply($, '')).toBe('now: sit · strategy')
  expect(calls).toEqual([])
})
