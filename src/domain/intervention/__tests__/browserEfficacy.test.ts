import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../attention/browser/activity";
import {
  type DecisionPoint,
  decisionPointsOf,
  ruleEfficacy,
  settleBrowserPoint,
} from "../browserEfficacy";

const MIN = 60_000;
const at = (day: number, h: number, m = 0) =>
  new Date(2026, 9, day, h, m).getTime();
let seq = 0;
const nav = (ts: number, domain: string): ActivityEvent => ({
  id: `n${seq++}`,
  surface: "browser",
  kind: "navigation_committed",
  ts,
  sessionId: "s",
  payload: { domain },
});
const dp = (
  ts: number,
  payload: Partial<DecisionPoint> & { delivered: boolean },
): ActivityEvent => ({
  id: `p${seq++}`,
  surface: "browser",
  kind: "decision_point",
  ts,
  sessionId: "s",
  payload: {
    ruleId: "chess-ladder",
    domain: "chess.com",
    trigger: "dwell",
    p: 0.7,
    draw: 0.5,
    rung: 1,
    windowMs: 10 * MIN,
    ...payload,
  },
});

/** On chess.com from 5 min before the point, off to github `stay` min after it. */
function visit(ts: number, stay: number): ActivityEvent[] {
  return [
    nav(ts - 5 * MIN, "www.chess.com"),
    nav(ts + stay * MIN, "github.com"),
    nav(ts + 30 * MIN, "example.com"),
  ];
}

describe("ruleEfficacy", () => {
  const events: ActivityEvent[] = [];
  // 10 delivered over 5 days, leaving after 1–3 min: mean 2.0.
  const delivered = [1, 2, 3, 1, 2, 3, 1, 2, 3, 2];
  delivered.forEach((stay, i) => {
    const ts = at(1 + Math.floor(i / 2), i % 2 ? 15 : 10);
    events.push(
      ...visit(ts, stay),
      dp(ts, { delivered: true, rung: i < 6 ? 1 : 2 }),
    );
  });
  // 4 withheld, leaving after 6, 8, 12 (past the window, so 10) and 4: mean 7.0.
  const withheld = [6, 8, 12, 4];
  withheld.forEach((stay, i) => {
    const ts = at(1 + i, 20);
    events.push(
      ...visit(ts, stay),
      dp(ts, {
        delivered: false,
        reason: i % 2 ? "draw" : undefined,
        trigger: "entry",
      }),
    );
  });
  // Superseded: stayed the whole window. Excluded from both arms.
  events.push(
    ...visit(at(6, 10), 30),
    dp(at(6, 10), { delivered: false, reason: "superseded" }),
  );
  // Window still open at `to`: unsettled, excluded.
  events.push(
    ...visit(at(6, 23, 55), 1),
    dp(at(6, 23, 55), { delivered: true }),
  );

  const [rule] = ruleEfficacy(decisionPointsOf(events), events, {
    from: at(1, 0),
    to: at(7, 0),
  });

  it("reports n and mean minutes on host per arm, and the difference", () => {
    expect(rule.delivered).toEqual({
      n: 10,
      meanMin: 2,
      nextSpanElsewhere: 10,
    });
    expect(rule.withheld).toEqual({ n: 4, meanMin: 7, nextSpanElsewhere: 3 });
    expect(rule.diffMin).toBe(-5);
    expect(rule.days).toBe(5);
  });

  it("keeps superseded and unsettled points out of the comparison", () => {
    expect(rule.superseded).toBe(1);
    expect(rule.unsettled).toBe(1);
  });

  it("splits by rung and trigger", () => {
    expect(rule.byRung["1"].delivered.n).toBe(6);
    expect(rule.byRung["2"].delivered.n).toBe(4);
    expect(rule.byRung["1"].withheld.n).toBe(4);
    expect(rule.byTrigger.dwell.delivered.n).toBe(10);
    expect(rule.byTrigger.entry.withheld.meanMin).toBe(7);
  });

  it("words the rule, never the person", () => {
    expect(rule.line).toBe(
      "chess-ladder: −5 min on chess.com in 10 min after a cue, n = 10 / 4 over 5 days.",
    );
    expect(JSON.stringify(rule)).not.toMatch(
      /\b(you|your|user|gardener|person)\b/i,
    );
  });

  it("notes windows that overlap", () => {
    expect(rule.overlapping).toBe(0);
    const close = [
      ...visit(at(9, 10), 2),
      dp(at(9, 10), { delivered: true }),
      dp(at(9, 10, 5), { delivered: false }),
    ];
    const [r] = ruleEfficacy(decisionPointsOf(close), close, {
      from: at(9, 0),
      to: at(10, 0),
    });
    expect(r.overlapping).toBe(2);
    expect(r.line).toMatch(/; 2 windows overlap\.$/);
  });

  it("says plainly when nothing was withheld", () => {
    const onlyDelivered = decisionPointsOf(events).filter((p) => p.delivered);
    const [r] = ruleEfficacy(onlyDelivered, events, {
      from: at(1, 0),
      to: at(7, 0),
    });
    expect(r.diffMin).toBeNull();
    expect(r.line).toBe(
      "chess-ladder: 2 min on chess.com in 10 min after a cue, n = 10 over 5 days; nothing withheld yet, so no comparison.",
    );
  });
});

describe("settleBrowserPoint", () => {
  const point = (ts: number): DecisionPoint => ({
    id: "x",
    ts,
    ruleId: "r",
    domain: "youtube.com",
    trigger: "dwell",
    delivered: true,
    p: 0.7,
    draw: 0.1,
    windowMs: 10 * MIN,
  });
  const events = [
    nav(at(1, 10, 0), "youtube.com"),
    nav(at(1, 10, 20), "example.com"),
    nav(at(1, 10, 25), "youtube.com"),
    // A 65-minute silence ends the bout, so bouts() credits none of it.
    nav(at(1, 11, 30), "example.com"),
  ];

  it("counts the minutes bouts() counts inside the window", () => {
    expect(
      settleBrowserPoint(point(at(1, 10, 10)), events, at(2, 0))?.minutesOnHost,
    ).toBe(10);
  });

  it("credits nothing from a gap that ends the bout", () => {
    expect(
      settleBrowserPoint(point(at(1, 10, 30)), events, at(2, 0))?.minutesOnHost,
    ).toBe(0);
  });

  it("waits for the window to close", () => {
    expect(
      settleBrowserPoint(point(at(1, 10, 30)), events, at(1, 10, 35)),
    ).toBeNull();
  });
});
