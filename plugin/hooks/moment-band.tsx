// The moment band: when the active moment is stale or none is set, one line
// above the prompt offers this phase's moments to tend, or habits to plant.
// The prompt hint's tail carries the active moment. Writes go only through zenborg's
// MCP tools, so the vault keeps one writer.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Tap } from '../types'
import { labelOf, matchHabits, reading } from './garden.ts'
import { call, loadVault, toolNamed } from './vault-io.ts'

const band = atom({ plugin: 'zenborg', key: 'band' } as const, null)
// "<day> <phase>" the gardener set aside with Later.
const later = atom({ plugin: 'zenborg', key: 'later' } as const, null)

// The reading's status text, drawn as the prompt hint's tail.
const status = atom({ plugin: 'zenborg', key: 'status' } as const, null)

// What the gardener has typed in the band's search field.
const query = atom({ plugin: 'zenborg', key: 'query' } as const, '')

export const createdId = (text: string | undefined) => {
  try {
    return text ? ((JSON.parse(text).id ?? JSON.parse(text).created?.id) as string | undefined) : undefined
  } catch {
    return undefined
  }
}

export async function refresh($: EngineInterface) {
  const r = reading(await loadVault($), new Date(await $.clock.now()), await $.session.cwd())
  await update($, status, () => r?.status ?? null)
  const canWrite = (await toolNamed($, 'set_active_moment')) !== undefined
  const next = canWrite ? (r?.band ?? null) : null
  // A new day or phase starts a fresh search.
  const cur = await read($, band)
  if (cur?.day !== next?.day || cur?.phase !== next?.phase) await update($, query, () => '')
  await update($, band, () => next)
}

const tap = async ($: EngineInterface, t: Tap, b: Band) => {
  // Takes the band down first; a second press finds nothing to take.
  let taken = false
  await update($, band, cur => ((taken = cur !== null), null))
  if (!taken) return
  await update($, query, () => '')
  const added = t.kind === 'tend' ? undefined : await call($, 'add_moment', { habitId: t.habitId, day: b.day, phase: b.phase })
  const momentId = t.kind === 'tend' ? t.momentId : added?.ok ? createdId(added.text) : undefined
  const set = momentId === undefined ? undefined : await call($, 'set_active_moment', { momentIdOrName: momentId })
  const why = added && !added.ok ? added.why : set && !set.ok ? set.why : set ? undefined : 'no moment id returned'
  if (why) $.ui.toast(`zenborg: not saved (${why})`)
  await refresh($)
}

// The session's start and each main-loop turn call `refresh` from index.ts,
// which owns those hooks: the engine takes one unmatched hook per event.
export const register: Register = on => {
  // `$.ui.status` is headed by the plugin name; the hint's tail is not.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const tail = await read($, status)
    return next(tail === null ? e : { ...e, props: { ...e.props, tail } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, band)
    if (b === null || e.props.hasSurvey || (await read($, later)) === `${b.day} ${b.phase}`) return next(e)
    // The band is raised on these two alone; the check types the table with an Input.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const q = await read($, query)
    // Search runs over every habit, planted by the same path as a default plant tap.
    const found: Tap[] = []
    if (q.trim() !== '') {
      const v = await loadVault($)
      const label = labelOf(v.areas)
      for (const h of matchHabits(v.habits, q)) found.push({ kind: 'plant', habitId: h.id, label: `+ ${label(h)}` })
    }
    const taps = q.trim() === '' ? b.taps : found
    // Board order, nothing primary, nothing focused: the gardener chooses.
    return (
      <Box flexDirection="column" width={e.props.bodyColumns} paddingX={2}>
        <Text dimColor>{b.line}</Text>
        <Input
          key="search"
          placeholder="search habits"
          value={q}
          onInput={(value: string) => update($, query, () => value)}
          onSubmit={() => (found[0] ? tap($, found[0], b) : undefined)}
          submitLabel="plant"
        />
        {q.trim() !== '' && found.length === 0 && <Text dimColor>no habit matches</Text>}
        <Box gap={2}>
          {taps.map((t, i) => (
            <Button key={`tap-${i}`} label={t.label} onPress={() => tap($, t, b)} />
          ))}
          <Button key="later" label="Later" onPress={() => update($, later, () => `${b.day} ${b.phase}`)} />
        </Box>
      </Box>
    )
  })
}
