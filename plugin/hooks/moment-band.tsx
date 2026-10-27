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
