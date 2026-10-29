#!/usr/bin/env node
/**
 * spend-refresh: recompute the active cycle's spend (same code as the
 * get_cycle_spend MCP tool) and write `<vault>/cache/cycle-spend.json`.
 * Spawned detached by the SessionStart hook; also runnable by hand:
 *
 *   pnpm spend:refresh [--vault <dir>]
 *
 * One refresh at a time: `cache/cycle-spend.lock`, stolen once stale.
 * linear-join.json is only read (missing = attribution falls back).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { LOCK_STALE_MS } from "../plugin/hooks/spend-refresh.ts";
import { resolveVault } from "../mcp-server/vault.ts";
import { getCycleSpend, today, writeSpendCache } from "../mcp-server/spend.ts";

const vault = resolveVault().root;
const lock = path.join(vault, "cache", "cycle-spend.lock");
fs.mkdirSync(path.dirname(lock), { recursive: true });

try {
  fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
} catch {
  const age = Date.now() - fs.statSync(lock).mtimeMs;
  if (age < LOCK_STALE_MS) {
    console.log("another refresh is running; skipping");
    process.exit(0);
  }
  fs.writeFileSync(lock, String(process.pid)); // steal the stale lock
}

try {
  const cycles = JSON.parse(
    fs.readFileSync(path.join(vault, "cycles.json"), "utf8"),
  ) as Record<
    string,
    {
      id: string;
      startDate: string;
      endDate: string | null;
      allocations?: never[];
    }
  >;
  const t = today();
  const c = Object.values(cycles)
    .filter((c) => c.startDate <= t && (c.endDate === null || c.endDate >= t))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (!c) {
    console.log("no active cycle; nothing to refresh");
  } else {
    const result = getCycleSpend(vault, c.allocations ?? [], {
      from: c.startDate,
      to: t,
    });
    writeSpendCache(vault, c.id, result);
    console.log(
      `cycle-spend.json written: ${result.totalHours} h, ${result.allocations.length} allocations, join ${result.linearJoin}`,
    );
  }
} finally {
  fs.rmSync(lock, { force: true });
}
