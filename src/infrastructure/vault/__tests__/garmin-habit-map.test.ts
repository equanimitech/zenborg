import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HABIT_MAP_PATH,
  readHabitMap,
} from "../../../../mcp-server/garmin-map";

// The app's read path, with the Tauri command answered from a real file the
// way `read_garmin_habit_map` in src-tauri/src/vault/activity.rs does.
let vault = "";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd !== "garmin_habit_map_read") throw new Error(`unexpected ${cmd}`);
    const file = path.join(vault, ...HABIT_MAP_PATH);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  },
}));

const { readGarminHabitMap } = await import("../garmin-habit-map");

const writeMap = (text: string) => {
  const file = path.join(vault, ...HABIT_MAP_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-garmin-map-"));
});

describe("Garmin habit map — app and MCP read the same mapping", () => {
  it("resolves a fixture map identically", async () => {
    writeMap(
      JSON.stringify({
        version: 1,
        mappings: {
          running: { habitId: "h-run", habitName: "Run" },
          soccer: {
            habitId: "h-football",
            habitName: "Football",
            note: "Sunday league",
          },
          cycling: { habitName: "no id, dropped" },
        },
        pending: {},
      }),
    );
    const app = await readGarminHabitMap();
    const mcp = readHabitMap(vault);
    expect(app).toEqual(mcp);
    expect(app.mappings.running.habitId).toBe("h-run");
    expect(app.mappings.soccer.habitId).toBe("h-football");
    expect(app.mappings.cycling).toBeUndefined();
  });

  it("reads a missing or malformed file as the same empty map", async () => {
    expect(await readGarminHabitMap()).toEqual(readHabitMap(vault));
    writeMap("{not json");
    const app = await readGarminHabitMap();
    expect(app).toEqual(readHabitMap(vault));
    expect(app.mappings).toEqual({});
  });
});
