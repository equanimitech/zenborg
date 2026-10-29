#!/usr/bin/env node
/**
 * spend-refresh: recompute the active cycle's spend and write
 * `<vault>/cache/cycle-spend.json`. Same code as `zenborg-mcp refresh-spend`
 * (what the SessionStart hook spawns); this is the from-the-repo path:
 *
 *   pnpm spend:refresh [--vault <dir>]
 */
import { refreshSpend } from "../mcp-server/spend.ts";
import { resolveVault } from "../mcp-server/vault.ts";

console.log(refreshSpend(resolveVault().root));
