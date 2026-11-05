// The plugin's one hooks module (the engine takes one, and one unmatched hook
// per event): the moment band above the prompt, the phase pane beside the chat.
import type { Register } from 'claude-code'

import { register as band, refresh } from './moment-band.tsx'
import { register as now, registerNow } from './now.ts'
import { register as pane, redraw, registerOpeners } from './phase-pane.tsx'
import { pointerText } from './vault-io.ts'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await registerOpeners($)
    await registerNow($)
    const result = await next(e)
    await refresh($)
    // Idle sessions still age the moment; timers end on module reload.
    $.clock.every(60_000, () => refresh($))
    // No file watch or focus event in the mod API: another session's switch is
    // caught by polling the small pointer file alone, refreshing only on change.
    let seen = await pointerText($)
    $.clock.every(5_000, async () => {
      const text = await pointerText($)
      if (text !== seen) {
        seen = text
        await refresh($)
      }
    })
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
  now(on, options)
  pane(on, options)
}
