// The phase pane: /phase opens the current phase's moments beside the chat,
// with the drawing board below. One focused row carries hotkeys that move it;
// a line at the bottom asks Haiku for changes, shown as a preview that writes
// nothing until Apply. Every write goes through zenborg's MCP tools.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BoardOp, BoardView } from '../types'
import { wakingDayKey } from '../domain/attention/ActiveMoment.ts'
import {
  SYSTEM,
  actionsFor,
  boardOf,
  dayLabel,
  describe,
  gardenPrompt,
  opCall,
  parseProposal,
  phaseLabel,
  stepView,
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

// Today, the clock's (day, phase), and the one the pane shows.
const shownView = async ($: EngineInterface, v: Vault) => {
  const t = new Date(await $.clock.now())
  const today = wakingDayKey(t)
  const current: BoardView = { day: today, phase: currentPhase(Object.values(v.phases), t)?.phase ?? 'MORNING' }
  return { today, current, shown: (await read($, view)) ?? current }
}

// Writes each op in order, then has the pane re-read the vault.
const run = async ($: EngineInterface, ops: BoardOp[]) => {
  const v = await loadVault($)
  const failed: string[] = []
  for (const op of ops) {
    const { name, input } = opCall(v, op)
    if ((await call($, name, input)) === undefined) failed.push(describe(v, op))
  }
  await update($, note, () => (failed.length ? `not saved: ${failed.join('; ')}` : ''))
  await update($, rev, n => n + 1)
}

const askHaiku = async ($: EngineInterface, instruction: string) => {
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
const apply = async ($: EngineInterface) => {
  let taken: BoardOp[] = []
  await update($, proposal, cur => ((taken = cur?.ops ?? []), null))
  if (taken.length) await run($, taken)
}

// index.ts calls these from the session's start and each main-loop turn.
export async function registerCommand($: EngineInterface) {
  await $.command.register({ name: 'phase', description: "Open this phase's moments in a pane" })
}
// Claude may have tended the garden this turn: the pane re-reads the vault.
export async function redraw($: EngineInterface) {
  await update($, rev, n => n + 1)
}

export const register: Register = on => {
  on('command.run', { command: 'phase' }, async $ => {
    await update($, view, () => null)
    await update($, cursor, () => null)
    await $.ui.open({ id: PANE, title: 'Phase', focus: true, closeOnEscape: true })
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
    const { rows, drawing } = boardOf(v, shown)
    const ids = [...rows, ...drawing].map(r => r.id)
    const cur = await read($, cursor)
    const sel = cur !== null && ids.includes(cur) ? cur : ids[0]
    const p = await read($, proposal)
    const q = await read($, ask)
    const n = await read($, note)
    const atNow = shown.day === current.day && shown.phase === current.phase

    const step = (delta: number) => update($, view, () => stepView(shown, delta))
    const walk = (delta: number) =>
      update($, cursor, c => {
        const i = ids.indexOf(c !== null && ids.includes(c) ? c : (sel ?? ''))
        return ids[Math.min(ids.length - 1, Math.max(0, i + delta))] ?? null
      })

    const row = (r: { id: string; label: string; area: string }) => {
      const m = v.moments[r.id]
      const focused = r.id === sel
      return (
        <Box key={`r-${r.id}`} flexDirection="column">
          <Box gap={1}>
            <Button key={`row-${r.id}`} plain label={`${focused ? '›' : ' '} ${r.label}`} onPress={() => update($, cursor, () => r.id)} />
            <Text dimColor>{r.area}</Text>
          </Box>
          {focused && m && (
            <Box gap={2} paddingLeft={4}>
              {actionsFor(v, m, shown, today).map(a => (
                <Button key={`act-${a.key}`} plain hotkey={a.hotkey} label={a.label} onPress={() => run($, [a.op])} />
              ))}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={e.props.bodyColumns} gap={1}>
        <Box flexDirection="column">
          <Text bold>
            {phaseLabel(v, shown.phase).toUpperCase()}
            {atNow ? ' · now' : ''}
          </Text>
          <Text dimColor>{dayLabel(shown.day)}</Text>
          <Box gap={2}>
            <Button key="view-prev" plain hotkey="h" label={`◂ ${phaseLabel(v, stepView(shown, -1).phase).toLowerCase()}`} onPress={() => step(-1)} />
            <Button key="view-next" plain hotkey="l" label={`${phaseLabel(v, stepView(shown, 1).phase).toLowerCase()} ▸`} onPress={() => step(1)} />
            <Button key="down" plain hotkey="j" label="↓" onPress={() => walk(1)} />
            <Button key="up" plain hotkey="k" label="↑" onPress={() => walk(-1)} />
            {!atNow && <Button key="view-now" plain hotkey="0" label="now" onPress={() => update($, view, () => null)} />}
          </Box>
        </Box>
        <Box flexDirection="column">
          {rows.length === 0 && <Text dimColor>nothing planted</Text>}
          {rows.map(row)}
        </Box>
        {drawing.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>drawing board</Text>
            {drawing.map(row)}
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
