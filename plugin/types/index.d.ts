export type Tap =
  | { kind: 'tend'; momentId: string; label: string }
  | { kind: 'plant'; habitId: string; label: string }

/** The band's one line and its taps, for one (day, phase). */
export type Band = { day: string; phase: string; line: string; taps: Tap[] }

/** One change the phase pane can make; a hotkey and Haiku's proposal both end as these. */
export type BoardOp =
  | { op: 'move'; id: string; day: string; phase: string }
  | { op: 'unallocate'; id: string }
  | { op: 'add'; habitId?: string; name?: string; areaId?: string; day?: string; phase?: string }
  | { op: 'active'; id: string }
  | { op: 'delete'; id: string }

/** Haiku's ops after validation, each with its human line, waiting for Apply; `dropped` says what was refused. */
export type BoardProposal = { ops: BoardOp[]; lines: string[]; dropped: string[] }

/** The (day, phase) the pane shows. */
export type BoardView = { day: string; phase: string }

declare module 'claude-code' {
  interface PluginState {
    zenborg: {
      band: Band | null
      later: string | null
      query: string
      /** The pane's (day, phase); null follows the clock. */
      view: BoardView | null
      /** The focused row's moment id. */
      cursor: string | null
      /** The moment id whose delete awaits a second press; null when none. */
      armed: string | null
      /** The instruction typed for Haiku. */
      ask: string
      proposal: BoardProposal | null
      /** One short line under the proposal: asking, failed, applied. */
      note: string
      /** Haiku's reading of each cycle's intentions: cycle id, then area id to habit ids. {} until it answers or when it fails. */
      season: Record<string, Record<string, string[]>>
      /** Suggested habit ids hidden for the waking day `day`. */
      hidden: { day: string; ids: string[] }
      /** Bumped after every write, so the pane re-reads the vault. */
      rev: number
    }
  }
}
