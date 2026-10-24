import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { conciseRuleEfficacy, getRuleEfficacy } from "./rule-efficacy.js";

const MIN = 60_000;
const ts = (h: number, m = 0) => new Date(2026, 9, 1, h, m).getTime();
const line = (id: string, t: number, kind: string, payload: object) =>
  JSON.stringify({
    id,
    kind,
    payload,
    sessionId: "s",
    surface: "browser",
    ts: t,
  });

describe("getRuleEfficacy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-efficacy-"));
  const point = (id: string, t: number, ruleId: string, delivered: boolean) =>
    line(id, t, "decision_point", {
      ruleId,
      domain: "youtube.com",
      trigger: "dwell",
      delivered,
      p: 0.7,
      draw: 0.5,
      rung: 1,
      windowMs: 10 * MIN,
    });
  const lines = [
    line("a", ts(10), "navigation_committed", { domain: "youtube.com" }),
    point("p1", ts(10, 5), "youtube-dwell-gate", true),
    point("p1", ts(10, 5), "youtube-dwell-gate", true), // written twice
    line("b", ts(10, 8), "navigation_committed", { domain: "github.com" }),
    point("p2", ts(10, 30), "other-rule", false),
    line("c", ts(10, 40), "navigation_committed", { domain: "example.com" }),
  ];
  fs.writeFileSync(
    path.join(dir, "2026-10-01.browser.jsonl"),
    `${lines.join("\n")}\n`,
  );

  it("filters to one rule and dedups points", () => {
    const r = getRuleEfficacy(
      dir,
      { ruleId: "youtube-dwell-gate", from: "2026-10-01", to: "2026-10-01" },
      ts(23),
    );
    expect(r.rules.map((x) => x.ruleId)).toEqual(["youtube-dwell-gate"]);
    expect(r.rules[0].delivered).toEqual({
      n: 1,
      meanMin: 3,
      nextSpanElsewhere: 1,
    });
    expect(r.rules[0].line).toMatch(/nothing withheld yet, so no comparison/);
  });

  it("leaves a point unsettled while its window is open", () => {
    const r = getRuleEfficacy(
      dir,
      { from: "2026-10-01", to: "2026-10-01" },
      ts(10, 10),
    );
    expect(r.rules[0].unsettled).toBe(1);
    expect(r.rules[0].delivered.n).toBe(0);
  });

  it("says so when the range holds no decision points", () => {
    const r = getRuleEfficacy(dir, { from: "2026-09-01", to: "2026-09-02" });
    expect(r.rules).toEqual([]);
    expect(r.note).toBe("No decision_point events in this range.");
  });

  it("concise drops the splits", () => {
    const r = getRuleEfficacy(
      dir,
      { from: "2026-10-01", to: "2026-10-01" },
      ts(23),
    );
    const c = conciseRuleEfficacy(r) as typeof r;
    expect(c.rules[0]).not.toHaveProperty("byRung");
    expect(c.rules[0].line).toBe(r.rules[0].line);
  });
});
