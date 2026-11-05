import { describe, expect, it } from "vitest";
import type { DwellGate, DwellRung } from "./decide";
import { crossingsOf, gateAtRung, NO_CROSSINGS, recordCrossing, rungIndex } from "./ladder";

const rung = (everyMinutes: number, cycles: number): DwellRung => ({
  everyMinutes,
  friction: { type: "breath", cycles },
  proceed: { label: "Keep going", action: { type: "continue" } },
  abort: { label: "Close the tab" },
});
const rungs = [rung(40, 5), rung(60, 8), rung(30, 0)];
const ladder: DwellGate = { ...rungs[0], ruleId: "cinejoy", domains: ["cinejoy.com"], rungs };

describe("gateAtRung", () => {
  it("rung 0 with no crossings", () => {
    const r = gateAtRung(ladder, 0);
    expect(r.rung).toBe(0);
    expect(r.gate.everyMinutes).toBe(40);
  });
  it("rung 1 after one crossing, with its own interval and friction", () => {
    const r = gateAtRung(ladder, 1);
    expect(r.rung).toBe(1);
    expect(r.gate.everyMinutes).toBe(60);
    expect(r.gate.friction).toEqual({ type: "breath", cycles: 8 });
  });
  it("clamps past the end (interval may shorten)", () => {
    const r = gateAtRung(ladder, 9);
    expect(r.rung).toBe(2);
    expect(r.gate.everyMinutes).toBe(30);
  });
  it("a single-gate rule is untouched", () => {
    const single: DwellGate = { ...ladder, rungs: undefined };
    expect(gateAtRung(single, 5)).toEqual({ gate: single, rung: 0 });
  });
  it("rungIndex tolerates junk", () => {
    expect(rungIndex(3, -2)).toBe(0);
    expect(rungIndex(3, NaN)).toBe(0);
  });
});

describe("crossings", () => {
  it("increments per rule and reads back", () => {
    let s = recordCrossing(NO_CROSSINGS, "d1", "a");
    s = recordCrossing(s, "d1", "a");
    s = recordCrossing(s, "d1", "b");
    expect(crossingsOf(s, "d1", "a")).toBe(2);
    expect(crossingsOf(s, "d1", "b")).toBe(1);
  });
  it("resets at the day boundary", () => {
    const s = recordCrossing(NO_CROSSINGS, "d1", "a");
    expect(crossingsOf(s, "d2", "a")).toBe(0);
    expect(crossingsOf(recordCrossing(s, "d2", "a"), "d2", "a")).toBe(1);
  });
});
