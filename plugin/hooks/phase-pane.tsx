// The phase pane: /phase [day] [phase] opens a phase's moments beside the
// chat, grouped by area, with the drawing board below. One focused row carries
// hotkeys that move it; a line at the bottom asks Haiku for changes, shown as
// a preview that writes nothing until Apply.
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
import { call, loadVault } from './vault-io.ts'

const PANE = 'zenborg-phase'
const HAIKU = 'claude-haiku-5-5'

const view = atom({ plugin: 'zenborg', key: 'view' } as const, null)
const cursor = atom({ plugin: 'zenborg', key: 'cursor' } as const, null)
const ask = atom({ plugin: 'zenborg', key: 'ask' } as const, '')
const proposal = atom({ plugin: 'zenborg', key: 'proposal' } as const, null)
const note = atom({ plugin: 'zenborg', key: 'note' } as const, '')
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
  return { opened, title: viewTitle(v, shown) }
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
    const { here, board } = boardOf(v, shown)
    const ids = [...rowIds(here), ...rowIds(board)]
    const sel = cursorAt(ids, await read($, cursor))
    const p = await read($, proposal)
    const q = await read($, ask)
    const n = await read($, note)
    const atNow = shown.day === current.day && shown.phase === current.phase

    // Shows `next` (null: now) and retitles the pane's tab to its phase.
    const goTo = async (next: BoardView | null) => {
      const phase = (next ?? current).phase
      await update($, view, () => next)
      await $.ui.open({ id: PANE, title: `${phaseEmoji(v, phase)} ${phaseLabel(v, phase)}`.trim(), closeOnEscape: true })
    }
    const step = (delta: number) => goTo(stepView(shown, delta))
    // A move off this view hands the cursor to the next row first.
    const act = async (id: string, op: BoardOp) => {
      if (leavesView(op, shown)) await update($, cursor, () => neighbor(ids, id))
      await run($, [op])
    }

    const tree = (groups: Group[]) =>
      groups.map(g => (
        <Box key={`g-${g.key}`} flexDirection="column">
          <Text bold>{g.header}</Text>
          {g.rows.map((r, i) => {
            const m = v.moments[r.id]
            const focused = r.id === sel
            const branch = i === g.rows.length - 1 ? '└' : '├'
            return (
              <Box key={`r-${r.id}`} flexDirection="column">
                <Button
                  key={`row-${r.id}`}
                  plain
                  label={`${focused ? '›' : ' '} ${branch} ${r.label}${r.isActive ? ' ●' : ''}`}
                  onPress={() => update($, cursor, () => r.id)}
                />
                {focused && m && (
                  <Box gap={2} paddingLeft={6}>
                    {actionsFor(v, m, shown, today).map(a => (
                      <Button key={`act-${a.key}`} plain hotkey={a.hotkey} label={a.label} onPress={() => act(r.id, a.op)} />
                    ))}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      ))

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
            <Button key="down" plain hotkey="j" label="↓" onPress={() => update($, cursor, c => walk(ids, cursorAt(ids, c), 1))} />
            <Button key="up" plain hotkey="k" label="↑" onPress={() => update($, cursor, c => walk(ids, cursorAt(ids, c), -1))} />
            {!atNow && <Button key="view-now" plain hotkey="0" label="now" onPress={() => goTo(null)} />}
          </Box>
        </Box>
        <Box flexDirection="column">
          {here.length === 0 && <Text dimColor>nothing planted</Text>}
          {tree(here)}
        </Box>
        {board.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>── board ──</Text>
            {tree(board)}
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
