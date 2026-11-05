// `/now <words>`: one line to switch the active moment. The resolution is pure
// (garden.ts `resolveNow`); writes go through zenborg's MCP tools, as the band's do.
import type { EngineInterface, Register } from 'claude-code'

import { resolveNow } from './garden.ts'
import { createdId, refresh } from './moment-band.tsx'
import { call, loadVault } from './vault-io.ts'

const failed = (why: string) => `zenborg: not saved (${why})`

export async function registerNow($: EngineInterface) {
  await $.command.register({ name: 'now', description: 'Switch the active moment', argumentHint: '<moment or habit>' })
}

export const register: Register = on => {
  on('command.run', { command: 'now' }, async ($, e) => {
    const plan = resolveNow(await loadVault($), e.args ?? '', new Date(await $.clock.now()), await $.session.cwd())
    if (plan.kind === 'reply') return { text: plan.text }
    let id: string | undefined = 'momentId' in plan ? plan.momentId : undefined
    if (plan.kind === 'move') {
      const moved = await call($, 'update_moment', { id, day: plan.day, phase: plan.phase })
      if (!moved.ok) return { text: failed(moved.why) }
    } else if (plan.kind === 'plant') {
      const added = await call($, 'add_moment', { habitId: plan.habitId, day: plan.day, phase: plan.phase })
      if (!added.ok) return { text: failed(added.why) }
      id = createdId(added.text)
    } else if (plan.kind === 'create') {
      const input = { name: plan.name, day: plan.day, phase: plan.phase, ...(plan.areaId ? { areaId: plan.areaId } : {}) }
      const added = await call($, 'add_moment', input)
      if (!added.ok) return { text: failed(added.why) }
      id = createdId(added.text)
    }
    const set = id === undefined ? undefined : await call($, 'set_active_moment', { momentIdOrName: id })
    await refresh($)
    if (set && !set.ok) return { text: failed(set.why) }
    return { text: set ? plan.text : failed('no moment id returned') }
  })
}
