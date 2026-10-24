import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type HourWindow, isInScheduleWindow } from "../scheduleWindow";

// 2026-01-05 is a Monday. Local time, as the window is read.
const mon = (h: number) => new Date(2026, 0, 5, h, 0);
const tue = (h: number) => new Date(2026, 0, 6, h, 0);

describe("isInScheduleWindow", () => {
  const cases: [string, HourWindow, Date, boolean][] = [
    [
      "0→0 MON, Mon 00h",
      { fromHour: 0, toHour: 0, weekdays: ["MON"] },
      mon(0),
      true,
    ],
    [
      "0→0 MON, Mon 15h",
      { fromHour: 0, toHour: 0, weekdays: ["MON"] },
      mon(15),
      true,
    ],
    [
      "0→0 MON, Mon 23h",
      { fromHour: 0, toHour: 0, weekdays: ["MON"] },
      mon(23),
      true,
    ],
    [
      "0→0 MON, Tue 15h",
      { fromHour: 0, toHour: 0, weekdays: ["MON"] },
      tue(15),
      false,
    ],
    ["2→7 at 03h", { fromHour: 2, toHour: 7 }, mon(3), true],
    ["2→7 at 15h", { fromHour: 2, toHour: 7 }, mon(15), false],
    [
      "2→7 at 07h (end is exclusive)",
      { fromHour: 2, toHour: 7 },
      mon(7),
      false,
    ],
    ["22→2 at 23h", { fromHour: 22, toHour: 2 }, mon(23), true],
    ["22→2 at 01h", { fromHour: 22, toHour: 2 }, mon(1), true],
    ["22→2 at 12h", { fromHour: 22, toHour: 2 }, mon(12), false],
    ["0→24 at 00h", { fromHour: 0, toHour: 24 }, mon(0), true],
    ["0→24 at 12h", { fromHour: 0, toHour: 24 }, mon(12), true],
    ["0→24 at 23h", { fromHour: 0, toHour: 24 }, mon(23), true],
  ];

  for (const [name, window, now, expected] of cases) {
    it(name, () => {
      expect(isInScheduleWindow(window, now)).toBe(expected);
    });
  }
});

// The plugin and the extension cannot import across package boundaries (the
// marketplace clones `plugin/` alone; the extension's dev server serves only
// its own root), so they vendor this file. Pin the copies here, where the
// pre-commit hook runs.
describe("vendored copies", () => {
  const root = join(__dirname, "../../../..");
  const original = readFileSync(
    join(root, "src/domain/intervention/scheduleWindow.ts"),
    "utf8",
  );
  for (const copy of [
    "plugin/domain/intervention/scheduleWindow.ts",
    "extension/modules/fence/scheduleWindow.ts",
  ]) {
    it(`${copy} is byte-identical to src/domain`, () => {
      expect(readFileSync(join(root, copy), "utf8")).toBe(original);
    });
  }
});
