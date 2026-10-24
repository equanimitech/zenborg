import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { conciseSiteMinutes, getSiteMinutes } from "./site-minutes.js";

const at = (day: number, h: number, m: number) =>
  new Date(2026, 9, day, h, m).getTime();

/** Write one day's browser log: `minutes` on `domain` from 10:00, then away. */
function writeDay(dir: string, day: number, visits: [string, number][]) {
  let ts = at(day, 10, 0);
  const lines: string[] = [];
  for (const [domain, minutes] of visits) {
    lines.push(
      JSON.stringify({
        id: `${day}-${ts}`,
        kind: "navigation_committed",
        payload: { domain },
        sessionId: "s",
        surface: "browser",
        ts,
      }),
    );
    // Written twice in places: the reader must dedup by id.
    lines.push(lines[lines.length - 1]);
    ts += minutes * 60_000;
  }
  lines.push(
    JSON.stringify({
      id: `${day}-end`,
      kind: "navigation_committed",
      payload: { domain: "example.com" },
      sessionId: "s",
      surface: "browser",
      ts,
    }),
  );
  const name = `2026-10-${String(day).padStart(2, "0")}.browser.jsonl`;
  fs.writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
}

describe("getSiteMinutes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-site-"));
  writeDay(dir, 1, [
    ["youtube.com", 20],
    ["chess.com", 10],
  ]);
  writeDay(dir, 2, [["m.youtube.com", 10]]);
  writeDay(dir, 3, [["youtube.com", 30]]);
  writeDay(dir, 5, [
    ["youtube.com", 2],
    ["www.chess.com", 25],
  ]);
  writeDay(dir, 7, [["chess.com", 5]]);

  const result = getSiteMinutes(dir, {
    hosts: ["youtube.com", "chess.com"],
    from: "2026-10-01",
    to: "2026-10-03",
    compare: { from: "2026-10-05", to: "2026-10-07" },
  });

  it("builds the before/after table per host", () => {
    expect(result.table).toEqual([
      {
        host: "youtube.com",
        period: { mean: 20, median: 20 },
        compare: { mean: 1, median: 1 },
      },
      {
        host: "chess.com",
        period: { mean: 3.3, median: 0 },
        compare: { mean: 15, median: 15 },
      },
    ]);
  });

  it("leaves untracked days out of the means and names them", () => {
    expect(result.period.trackedDays).toBe(3);
    expect(result.compare?.trackedDays).toBe(2);
    expect(result.compare?.missingDays).toEqual(["2026-10-06"]);
    expect(result.period.daily[1]).toEqual({
      day: "2026-10-02",
      "youtube.com": 10,
      "chess.com": 0,
    });
  });

  it("concise drops the daily rows, keeps the table", () => {
    const concise = conciseSiteMinutes(result) as typeof result;
    expect(concise.period).not.toHaveProperty("daily");
    expect(concise.table).toEqual(result.table);
  });

  it("names no person", () => {
    expect(JSON.stringify(result)).not.toMatch(
      /\b(you|your|user|gardener|person)\b/i,
    );
  });
});
