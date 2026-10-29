/**
 * When SessionStart should refresh `<vault>/cache/cycle-spend.json`, and how it
 * kicks the refresh off: detached, never awaited. `zenborg-mcp refresh-spend`
 * recomputes and takes the lock; this only decides and spawns.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where the app installs the MCP binary; Claude Code's MCP config points here too. */
export const ZENBORG_MCP_BIN =
  "/Applications/zenborg.app/Contents/MacOS/zenborg-mcp";

export const CACHE_MAX_AGE_MS = 30 * 60_000;
/** A lock older than this is a crashed refresh (a run takes ~5 s). */
export const LOCK_STALE_MS = 5 * 60_000;

/** Ages in ms, null when the file is absent. Refresh unless a live lock holds it. */
export function shouldRefresh(
  cacheAgeMs: number | null,
  lockAgeMs: number | null,
): boolean {
  if (lockAgeMs !== null && lockAgeMs < LOCK_STALE_MS) return false;
  return cacheAgeMs === null || cacheAgeMs > CACHE_MAX_AGE_MS;
}

const ageOf = (file: string): number | null => {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/** Fire and forget; silent on any failure. */
export function refreshSpendInBackground(vault: string): void {
  try {
    const cache = join(vault, "cache");
    if (
      !shouldRefresh(
        ageOf(join(cache, "cycle-spend.json")),
        ageOf(join(cache, "cycle-spend.lock")),
      )
    )
      return;
    if (!existsSync(ZENBORG_MCP_BIN)) return; // app not installed
    spawn(ZENBORG_MCP_BIN, ["refresh-spend", "--vault", vault], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {}
}
