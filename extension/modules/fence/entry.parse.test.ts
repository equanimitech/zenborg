import { describe, expect, it } from "vitest";
import { gatesFrom, parseFences } from "./parse";
import { gateAtRung } from "../friction/gate/ladder";
import { isArrival } from "../friction/gate/arrival";

const MIN = 60_000;
const gate = (trigger: Record<string, unknown>, friction: Record<string, unknown>) => ({
  kind: "gate",
  trigger,
  frictionType: friction,
  proceedAffordance: { label: "Water it anyway", action: { type: "continue" } },
  abortAffordance: { label: "Back" },
});
const wrap = (g: unknown) => ({
  kind: "schedule",
  window: { fromHour: 6, toHour: 12 },
  outsideWindow: "inactive",
  wraps: g,
});
const record = (primitives: unknown[]) => ({
  chess: { id: "chess", scope: { surface: "browser", domain: "chess.com" }, primitives },
});
const entry = { type: "entry" };

describe("entry gates", () => {
  it("an entry trigger is an entry gate, not a one-minute dwell gate", () => {
    const parsed = parseFences(record([gate(entry, { type: "confirmation" })]))!;
    const [g] = gatesFrom(parsed.fences);
    expect(g.entry).toBe(true);
    expect(g.click).toBeUndefined();
  });

  it("watering regular: two schedule-wrapped entry gates are a crossing ladder, entry on every rung", () => {
    const parsed = parseFences(
      record([
        wrap(gate(entry, { type: "intention", prompt: "Continue?" })),
        wrap(gate(entry, { type: "delay", seconds: 10 })),
      ])
    )!;
    const [g] = gatesFrom(parsed.fences);
    expect(g.rungs?.map((r) => r.entry)).toEqual([true, true]);
    expect(parsed.fences.chess.schedule).toBeDefined();
    expect(gateAtRung(g, 0).gate.friction.type).toBe("intention");
    expect(gateAtRung(g, 1).gate.friction.type).toBe("delay");
    expect(gateAtRung(g, 1).gate.entry).toBe(true);
  });

  it("a dwell gate stays a dwell gate", () => {
    const parsed = parseFences(record([gate({ type: "dwell", everyMinutes: 20 }, { type: "confirmation" })]))!;
    const [g] = gatesFrom(parsed.fences);
    expect(g.entry).toBeUndefined();
    expect(g.everyMinutes).toBe(20);
  });

  it("a dwell rung laid over an entry rung 0 clears the trigger", () => {
    const parsed = parseFences(
      record([
        gate(entry, { type: "confirmation" }),
        gate({ type: "dwell", everyMinutes: 15 }, { type: "confirmation" }),
      ])
    )!;
    const [g] = gatesFrom(parsed.fences);
    expect(gateAtRung(g, 1).gate.entry).toBeUndefined();
  });
});

describe("an entry gate across a long stay", () => {
  it("asks once, on arrival, however often the stay is polled", () => {
    let last: number | null = null;
    let asked = 0;
    const t0 = new Date(2026, 9, 24, 13, 0).getTime();
    for (let t = t0; t <= t0 + 90 * MIN; t += 30_000) {
      if (isArrival(last, t)) asked += 1;
      last = t; // each attended poll refreshes the stay
    }
    expect(asked).toBe(1);
  });

  it("asks again after leaving for 45 minutes", () => {
    const t0 = new Date(2026, 9, 24, 13, 0).getTime();
    expect(isArrival(t0 + 20 * MIN, t0 + 65 * MIN)).toBe(true);
  });
});
