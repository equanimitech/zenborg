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
export async function toolNamed($: EngineInterface, name: string) {
  return (await $.tool.list()).find(t => t.name.endsWith(`__${name}`))?.name
}

// The tool's text, or undefined on a deny, an error, or no such tool.
export async function call($: EngineInterface, name: string, input: Record<string, unknown>) {
  const tool = await toolNamed($, name)
  if (!tool) return undefined
  try {
    const r = await $.tool.call({ tool, ...input } as Parameters<EngineInterface['tool']['call']>[0])
    return r.deny !== undefined || r.isError ? undefined : (r.text ?? '')
  } catch {
    return undefined
  }
}
