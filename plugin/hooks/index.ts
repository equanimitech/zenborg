// The plugin's one hooks module (the engine takes one, and one unmatched hook
// per event): the moment band above the prompt, the phase pane beside the chat.
import type { Register } from 'claude-code'

import { register as band, refresh } from './moment-band.tsx'
import { register as pane, redraw, registerOpeners } from './phase-pane.tsx'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await registerOpeners($)
    const result = await next(e)
    await refresh($)
    // Idle sessions still age the moment; timers end on module reload.
    $.clock.every(60_000, () => refresh($))
    return result
  })

  // Main loop only. The turn starts first; the garden is read after.
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await refresh($)
      await redraw($)
    }
    return result
  })

  band(on, options)
  pane(on, options)
}
