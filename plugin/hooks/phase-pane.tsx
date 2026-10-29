// The phase pane: /phase [day] [phase] opens a phase's moments beside the
// chat, grouped by area, with two rows of suggestions below: your rhythm and
// your season. One focused row carries hotkeys (p, n, t, d, a) that move, delete
// or activate it, or (i, z) plant or hide a suggestion; a line at the bottom
// asks Haiku for changes, shown as a preview that writes nothing until Apply.
// Every write goes through zenborg's MCP tools.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BoardOp, BoardView } from '../types'
import { wakingDayKey } from '../domain/attention/ActiveMoment.ts'
import {
  SYSTEM,
  actionsFor,
  boardOf,
  cursorAt,
  describe,
  gardenPrompt,
  leavesView,
  neighbor,
  opCall,
  parseProposal,
  parseWhen,
  phaseEmoji,
  phaseLabel,
  rowIds,
  stepView,
  viewTitle,
  walk,
  type Group,
} from './board.ts'
import { currentPhase, type Vault } from './garden.ts'
import { MATCH_SYSTEM, matchPrompt, parseMatches, quietIntentions, rhythmRow, runningCycle, type Suggestion } from './suggest.ts'
import { call, loadVault } from './vault-io.ts'

const PANE = 'zenborg-phase'
const HAIKU = 'claude-haiku-5-5'

const view = atom({ plugin: 'zenborg', key: 'view' } as const, null)
const cursor = atom({ plugin: 'zenborg', key: 'cursor' } as const, null)
const armed = atom({ plugin: 'zenborg', key: 'armed' } as const, null)
const ask = atom({ plugin: 'zenborg', key: 'ask' } as const, '')
const proposal = atom({ plugin: 'zenborg', key: 'proposal' } as const, null)
const note = atom({ plugin: 'zenborg', key: 'note' } as const, '')
const season = atom({ plugin: 'zenborg', key: 'season' } as const, {})
const hidden = atom({ plugin: 'zenborg', key: 'hidden' } as const, { day: '', ids: [] })
const rev = atom({ plugin: 'zenborg', key: 'rev' } as const, 0)

// Today and the clock's (day, phase).
async function clockView($: EngineInterface, v: Vault) {
  const t = new Date(await $.clock.now())
  const today = wakingDayKey(t)
  const current: BoardView = { day: today, phase: currentPhase(Object.values(v.phases), t)?.phase ?? 'MORNING' }
  return { today, current }
}

// Today, the clock's (day, phase), and the one the pane shows.
async function shownView($: EngineInterface, v: Vault) {
  const c = await clockView($, v)
  return { ...c, shown: (await read($, view)) ?? c.current }
}

// Opens (or retitles) the pane on `args`, read as /phase reads them.
async function openAt($: EngineInterface, args: string, focus: boolean) {
  const v = await loadVault($)
  const { today, current } = await clockView($, v)
  const when = parseWhen(args, today, current)
  const shown = when.view ?? current
  await update($, view, () => when.view)
  await update($, cursor, () => null)
  await update($, note, () => when.note)
  const title = `${phaseEmoji(v, shown.phase)} ${phaseLabel(v, shown.phase)}`.trim()
  const opened = await $.ui.open({ id: PANE, title, closeOnEscape: true, ...(focus ? { focus: true as const } : {}) })
  await mapSeason($, v, today)
  return { opened, title: viewTitle(v, shown) }
}

// Haiku reads the running cycle's intentions into habit ids, once per cycle per
// session: the cycle is marked first, so a failure or a second open never asks again.
async function mapSeason($: EngineInterface, v: Vault, today: string) {
  const cycle = runningCycle(v, today)
  const prompt = cycle && matchPrompt(v, cycle)
  if (!cycle || !prompt) return
  let first = false
  await update($, season, s => ((first = !(cycle.id in s)), first ? { ...s, [cycle.id]: {} } : s))
  if (!first) return
  const r = await $.model.complete({ model: HAIKU, system: MATCH_SYSTEM, prompt, effort: 'low', timeoutMs: 15_000 })
  const matches = r.isAnswered ? parseMatches(v, cycle, r.text) : null
  if (matches) await update($, season, s => ({ ...s, [cycle.id]: matches }))
  await update($, rev, n => n + 1)
}

// Writes each op in order, then has the pane re-read the vault.
async function run($: EngineInterface, ops: BoardOp[]) {
  const v = await loadVault($)
  const failed: string[] = []
  for (const op of ops) {
    const { name, input } = opCall(v, op)
    if ((await call($, name, input)) === undefined) failed.push(describe(v, op))
  }
  await update($, note, () => (failed.length ? `not saved: ${failed.join('; ')}` : ''))
  await update($, rev, n => n + 1)
}

async function askHaiku($: EngineInterface, instruction: string) {
  await update($, proposal, () => null)
  await update($, note, () => 'asking haiku…')
  const v = await loadVault($)
  const { today, shown } = await shownView($, v)
  const r = await $.model.complete({
    model: HAIKU,
    system: SYSTEM,
    prompt: gardenPrompt(v, shown, today, instruction),
    effort: 'low',
    timeoutMs: 30_000,
  })
  if (!r.isAnswered) {
    await update($, note, () => `haiku did not answer (${r.reason}); nothing changed`)
    return
  }
  const p = parseProposal(v, r.text, instruction)
  await update($, ask, () => '')
  await update($, proposal, () => p)
  await update($, note, () => (p.ops.length ? '' : 'nothing to apply'))
}

// Takes the proposal first; a second Apply finds nothing to write.
async function apply($: EngineInterface) {
  let taken: BoardOp[] = []
  await update($, proposal, cur => ((taken = cur?.ops ?? []), null))
  if (taken.length) await run($, taken)
}

// index.ts calls these from the session's start and each main-loop turn.
export async function registerOpeners($: EngineInterface) {
  await $.command.register({ name: 'phase', description: "Open a phase's moments in a pane", argumentHint: '[day] [phase]' })
}
// Claude may have tended the garden this turn: the pane re-reads the vault.
export async function redraw($: EngineInterface) {
  await update($, rev, n => n + 1)
}

export const register: Register = on => {
  on('command.run', { command: 'phase' }, async ($, e) => {
    await openAt($, e.args, true)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Button, Text } = t
    // The mobile app draws no field yet: no ask line there.
    const Input = 'Input' in t ? t.Input : undefined
    await read($, rev)
    const v = await loadVault($)
    const { today, shown, current } = await shownView($, v)
    const { here } = boardOf(v, shown)
    const hid = new Set((await read($, hidden)).day === today ? (await read($, hidden)).ids : [])
    const cycle = runningCycle(v, today)
    const matches = (cycle && (await read($, season))[cycle.id]) || {}
    const opts = { skip: hid, view: shown }
    const rhythm = rhythmRow(v, shown, today, opts)
    const quiet = quietIntentions(v, today, matches, opts)
    const sugId = (kind: string, s: Suggestion) => `sug:${kind}:${s.habitId}`
    const sugs = new Map([...rhythm.map(s => [sugId('rhythm', s), s] as const), ...quiet.map(s => [sugId('season', s), s] as const)])
    const ids = [...rowIds(here), ...sugs.keys()]
    const sel = cursorAt(ids, await read($, cursor))
    const p = await read($, proposal)
    const q = await read($, ask)
    const n = await read($, note)
    const armedId = await read($, armed)
    const atNow = shown.day === current.day && shown.phase === current.phase

    // Shows `next` (null: now) and retitles the pane's tab to its phase.
    const goTo = async (next: BoardView | null) => {
      await update($, armed, () => null)
      const phase = (next ?? current).phase
      await update($, view, () => next)
      await $.ui.open({ id: PANE, title: `${phaseEmoji(v, phase)} ${phaseLabel(v, phase)}`.trim(), closeOnEscape: true })
    }
    const step = (delta: number) => goTo(stepView(shown, delta))
    const disarm = () => update($, armed, () => null)
    const focus = async (f: (c: string | null) => string | null) => {
      await disarm()
      await update($, cursor, f)
    }
    // A move off this view hands the cursor to the next row first. The first delete press only arms.
    const act = async (id: string, op: BoardOp) => {
      if (op.op === 'delete' && (await read($, armed)) !== id) return update($, armed, () => id)
      await disarm()
      if (leavesView(op, shown)) await update($, cursor, () => neighbor(ids, id))
      await run($, [op])
    }

    // One moment row with its hotkeys when focused; `branch` is the tree's, empty for the flat list.
    const row = (r: Group['rows'][number], branch: string) => {
      const m = v.moments[r.id]
      const focused = r.id === sel
      return (
        <Box key={`r-${r.id}`} flexDirection="column">
          <Button
            key={`row-${r.id}`}
            plain
            label={`${focused ? '›' : ' '} ${branch}${r.label}${r.isActive ? ' ●' : ''}`}
            onPress={() => focus(() => r.id)}
          />
          {focused && m && (
            <Box gap={2} paddingLeft={branch ? 6 : 4}>
              {actionsFor(v, m, shown, today).map(a => (
                <Button key={`act-${a.key}`} plain hotkey={a.hotkey} label={a.key === 'delete' && armedId === r.id ? 'd again to delete' : a.label} onPress={() => act(r.id, a.op)} />
              ))}
            </Box>
          )}
        </Box>
      )
    }
    // i plants the suggestion into the shown phase; z hides it for the waking day. Either hands the cursor on.
    const plant = async (id: string, s: Suggestion) => {
      await disarm()
      await update($, cursor, () => neighbor(ids, id))
      await run($, [{ op: 'add', habitId: s.habitId, day: shown.day, phase: shown.phase }])
    }
    const hide = async (id: string, s: Suggestion) => {
      await disarm()
      await update($, cursor, () => neighbor(ids, id))
      await update($, hidden, h => ({ day: today, ids: [...(h.day === today ? h.ids : []), s.habitId] }))
    }
    const sugRow = (id: string, s: Suggestion) => {
      const focused = id === sel
      return (
        <Box key={`s-${id}`} flexDirection="column">
          <Button key={`row-${id}`} plain label={`${focused ? '›' : ' '} ${s.label}${s.note ? ` · ${s.note}` : ''}`} onPress={() => focus(() => id)} />
          {focused && (
            <Box gap={2} paddingLeft={4}>
              <Button key="sug-plant" plain hotkey="i" label={`into ${phaseLabel(v, shown.phase).toLowerCase()}`} onPress={() => plant(id, s)} />
              <Button key="sug-hide" plain hotkey="z" label="not now" onPress={() => hide(id, s)} />
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={e.props.bodyColumns} gap={1}>
        <Box flexDirection="column">
          <Text bold>
            {viewTitle(v, shown)}
            {atNow ? ' · now' : ''}
          </Text>
          <Box gap={2}>
            <Button key="view-prev" plain hotkey="h" label={`◂ ${phaseLabel(v, stepView(shown, -1).phase).toLowerCase()}`} onPress={() => step(-1)} />
            <Button key="view-next" plain hotkey="l" label={`${phaseLabel(v, stepView(shown, 1).phase).toLowerCase()} ▸`} onPress={() => step(1)} />
            <Button key="down" plain hotkey="j" label="↓" onPress={() => focus(c => walk(ids, cursorAt(ids, c), 1))} />
            <Button key="up" plain hotkey="k" label="↑" onPress={() => focus(c => walk(ids, cursorAt(ids, c), -1))} />
            {!atNow && <Button key="view-now" plain hotkey="0" label="now" onPress={() => goTo(null)} />}
          </Box>
        </Box>
        <Box flexDirection="column">
          {here.length === 0 && <Text dimColor>nothing planted</Text>}
          {here.flatMap(g => g.rows).map(r => row(r, ''))}
        </Box>
        {sugs.size > 0 && (
          <Box flexDirection="column">
            <Text dimColor>── board ──</Text>
            {rhythm.length > 0 && <Text bold>your rhythm</Text>}
            {rhythm.map(s => sugRow(sugId('rhythm', s), s))}
            {quiet.length > 0 && <Text bold>your season</Text>}
            {quiet.map(s => sugRow(sugId('season', s), s))}
          </Box>
        )}
        {p && (
          <Box flexDirection="column">
            <Text bold>proposed</Text>
            {p.lines.map(l => (
              <Text>  {l}</Text>
            ))}
            {p.dropped.map(d => (
              <Text dimColor>  dropped: {d}</Text>
            ))}
            <Box gap={2}>
              {p.ops.length > 0 && <Button key="apply" plain hotkey="y" label="apply" onPress={() => apply($)} />}
              <Button key="discard" plain hotkey="x" label="discard" onPress={() => update($, proposal, () => null)} />
            </Box>
          </Box>
        )}
        {n !== '' && <Text dimColor>{n}</Text>}
        {Input && (
          <Input
            key="ask"
            placeholder="ask haiku: move strategy to thursday morning"
            value={q}
            onInput={(value: string) => update($, ask, () => value)}
            // Enter on an empty line applies the proposal shown; with text, it asks.
            onSubmit={(value: string) => (value.trim() === '' ? apply($) : askHaiku($, value.trim()))}
            submitLabel={p?.ops.length && q.trim() === '' ? 'apply' : 'ask'}
          />
        )}
      </Box>
    )
  })
}
