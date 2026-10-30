// The garden's I/O for the mod's modules: reads straight from the vault JSON,
// writes only through zenborg's MCP tools, so the vault keeps one writer.
// Function declarations: the validator follows `$` past an import only into those.
import type { EngineInterface } from 'claude-code'

import type { Vault } from './garden.ts'

// Fail soft: a missing or malformed file reads as empty.
async function readJson<T>($: EngineInterface, path: string, empty: T): Promise<T> {
  try {
    return (JSON.parse(await $.fs.read(path)) ?? empty) as T
  } catch {
    return empty
  }
}

export async function loadVault($: EngineInterface): Promise<Vault> {
  const root = (await $.env.get('ZENBORG_HOME')) ?? `${await $.env.get('HOME')}/.zenborg`
  const [active, moments, habits, areas, phases, cycles] = await Promise.all([
    readJson($, `${root}/activeMoment.json`, {}),
    readJson($, `${root}/moments.json`, {}),
    readJson($, `${root}/habits.json`, {}),
    readJson($, `${root}/areas.json`, {}),
    readJson($, `${root}/phaseConfigs.json`, {}),
    readJson($, `${root}/cycles.json`, {}),
  ])
  return { active, moments, habits, areas, phases, cycles }
}

// The zenborg MCP tool by suffix: the server may be registered under another name.
export async function toolNamed($: EngineInterface, name: string) {
  return (await $.tool.list()).find(t => t.name.endsWith(`__${name}`))?.name
}

// What a zenborg tool call came to: its text, or why it did not happen.
export type Called = { ok: true; text: string } | { ok: false; why: string }

// First line of a message, short enough for one line.
function brief(m: string) {
  const line = m.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

// The tool's text, or the reason for a missing tool, a permission deny, or an error.
export async function call($: EngineInterface, name: string, input: Record<string, unknown>): Promise<Called> {
  const tool = await toolNamed($, name)
  if (!tool) return { ok: false, why: 'zenborg MCP not connected' }
  try {
    const r = await $.tool.call({ tool, ...input } as Parameters<EngineInterface['tool']['call']>[0])
    if (r.deny !== undefined) {
      const msg = brief(String(r.deny))
      return { ok: false, why: `blocked by permissions: ${name}${msg && msg.length <= 40 ? ` (${msg})` : ''}` }
    }
    if (r.isError) return { ok: false, why: `${name} failed: ${brief(r.text ?? '') || 'error'}` }
    return { ok: true, text: r.text ?? '' }
  } catch (e) {
    return { ok: false, why: `${name} failed: ${brief(e instanceof Error ? e.message : String(e)) || 'error'}` }
  }
}
