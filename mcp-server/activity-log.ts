/**
 * Read adapter for zenborg's activity log.
 *
 * One reader, shared by MCP tools and `scripts/shadow.mts`. Line parsing and
 * its normalisations live in the domain (`parseActivityLines`), so the app
 * and the MCP server read a line the same way.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ActivityEvent,
  type ActivitySurface,
  parseActivityLines,
} from "../src/domain/attention/ActivityEvent.ts";
import { localDate } from "../src/domain/attention/GardenClock.ts";

const DAY_MS = 24 * 60 * 60_000;

const SURFACES: readonly ActivitySurface[] = [
  "agent",
  "desktop",
  "browser",
  "garmin",
  "git",
];

/**
 * Read activity events for the given window and surfaces.
 *
 * `from` and `to` are epoch-ms, half-open `[from, to)`.
 * Files are bucketed by local calendar date, so the window always
 * touches `to / DAY_MS + 1` files to cover timezone roll.
 */
export function readActivityLog(
  logDir: string,
  from: number,
  to: number,
  surfaces: readonly ActivitySurface[] = SURFACES,
): readonly ActivityEvent[] {
  if (!existsSync(logDir)) return [];
  const events: ActivityEvent[] = [];

  for (let ts = from - DAY_MS; ts <= to + DAY_MS; ts += DAY_MS) {
    const dateStr = localDate(ts);
    for (const surface of surfaces) {
      const file = join(logDir, `${dateStr}.${surface}.jsonl`);
      if (!existsSync(file)) continue;
      // A loop, not push(...spread): a busy agent day runs to tens of thousands of lines.
      for (const e of parseActivityLines(readFileSync(file, "utf8"), surface))
        events.push(e);
    }
  }

  return events
    .filter((e) => e.ts >= from && e.ts < to)
    .sort((a, b) => a.ts - b.ts);
}

export function logDir(vaultRoot: string): string {
  return join(vaultRoot, "log");
}
