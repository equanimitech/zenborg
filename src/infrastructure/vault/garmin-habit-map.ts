/**
 * The Garmin habit map, as the app reads it: raw text through one Tauri
 * command, parsed by the domain's `parseHabitMap`, the same function the
 * MCP server's `readHabitMap` uses. Missing, malformed or unreadable is the
 * empty map, never an error.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  type GarminHabitMap,
  parseHabitMap,
} from "@/domain/garmin/GarminHabitMap";

export async function readGarminHabitMap(): Promise<GarminHabitMap> {
  try {
    const raw = await invoke<string | null>("garmin_habit_map_read");
    return parseHabitMap(raw === null ? null : JSON.parse(raw));
  } catch {
    return parseHabitMap(null);
  }
}
