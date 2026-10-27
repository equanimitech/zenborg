export type Tap =
  | { kind: 'tend'; momentId: string; label: string }
  | { kind: 'plant'; habitId: string; label: string }

/** The band's one line and its taps, for one (day, phase). */
export type Band = { day: string; phase: string; line: string; taps: Tap[] }

declare module 'claude-code' {
  interface PluginState {
    zenborg: { band: Band | null; later: string | null; query: string }
  }
}
