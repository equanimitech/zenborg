/**
 * The Garmin habit map, as the MCP server reads it. The app reads the same
 * file through the `garmin_habit_map_read` Tauri command; both hand the text
 * to the domain's `parseHabitMap`, so a mapping resolves the same on both.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type GarminHabitMap,
  parseHabitMap,
} from "../src/domain/garmin/GarminHabitMap.ts";

export const HABIT_MAP_PATH = [
  "integrations",
  "garmin",
  "habit-map.json",
] as const;

/** Missing or malformed reads as the empty map, never an error. */
export function readHabitMap(vaultRoot: string): GarminHabitMap {
  const mapPath = path.join(vaultRoot, ...HABIT_MAP_PATH);
  if (!fs.existsSync(mapPath)) return parseHabitMap(null);
  try {
    return parseHabitMap(JSON.parse(fs.readFileSync(mapPath, "utf8")));
  } catch {
    return parseHabitMap(null);
  }
}
