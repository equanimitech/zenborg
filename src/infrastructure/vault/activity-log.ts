/**
 * ActivityLogPort for the app: reads the vault's `log/` through one Tauri
 * command and parses lines with the same domain function the MCP server uses.
 *
 * The web build has no vault and no log, so it reads nothing. The page says so
 * rather than showing an unseen week as an empty one.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ActivityLogPort } from "@/application/ports";
import {
  type ActivityEvent,
  type ActivitySurface,
  parseActivityLines,
} from "@/domain/attention/ActivityEvent";
import { localDate } from "@/domain/attention/GardenClock";
import { isTauri } from "./is-tauri";

const DAY_MS = 24 * 60 * 60_000;

interface ActivityFile {
  readonly day: string;
  readonly surface: string;
  readonly text: string;
}

export const tauriActivityLog: ActivityLogPort = {
  async read(from, to) {
    // Files bucket by local calendar day; a day either side covers the 04:00 roll.
    const files = await invoke<ActivityFile[]>("activity_read", {
      from: localDate(from - DAY_MS),
      to: localDate(to + DAY_MS),
    });
    const events: ActivityEvent[] = [];
    for (const file of files) {
      for (const e of parseActivityLines(
        file.text,
        file.surface as ActivitySurface,
      )) {
        if (e.ts >= from && e.ts < to) events.push(e);
      }
    }
    return events.sort((a, b) => a.ts - b.ts);
  },
};

/** True when this runtime can read the activity log at all. */
export const canReadActivity = isTauri;
