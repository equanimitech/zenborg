// `/now <words>`: one line to switch the active moment. The resolution is pure
// (garden.ts `resolveNow`); writes go through zenborg's MCP tools, as the band's do.
import type { EngineInterface, Register } from 'claude-code'

import { resolveNow } from './garden.ts'
import { createdId, refresh } from './moment-band.tsx'
import { call, loadVault } from './vault-io.ts'

const FAILED = 'zenborg: not saved, try again'

export async function registerNow($: EngineInterface) {
  await $.command.register({ name: 'now', description: 'Switch the active moment', argumentHint: '<moment or habit>' })
}

export const register: Register = on => {
  on('command.run', { command: 'now' }, async ($, e) => {
    const plan = resolveNow(await loadVault($), e.args ?? '', new Date(await $.clock.now()), await $.session.cwd())
    if (plan.kind === 'reply') return { text: plan.text }
    let id: string | undefined = 'momentId' in plan ? plan.momentId : undefined
    if (plan.kind === 'move') {
      if ((await call($, 'update_moment', { id, day: plan.day, phase: plan.phase })) === undefined) return { text: FAILED }
    } else if (plan.kind === 'plant') {
      id = createdId(await call($, 'add_moment', { habitId: plan.habitId, day: plan.day, phase: plan.phase }))
    } else if (plan.kind === 'create') {
      const input = { name: plan.name, day: plan.day, phase: plan.phase, ...(plan.areaId ? { areaId: plan.areaId } : {}) }
      id = createdId(await call($, 'add_moment', input))
    }
    const set = id === undefined ? undefined : await call($, 'set_active_moment', { momentIdOrName: id })
    await refresh($)
    return { text: set === undefined ? FAILED : plan.text }
  })
}
