import { describe, expect, it } from "vitest";
import { gatesFrom, parseFences } from "./parse";

const gate = (every: number, friction: Record<string, unknown>, label: string) => ({
  kind: "gate",
  trigger: { type: "dwell", everyMinutes: every },
  frictionType: friction,
  proceedAffordance: { label, action: { type: "continue" } },
  abortAffordance: { label: "Close tab" },
});
const record = (primitives: unknown[]) => ({
  cinejoy: { id: "cinejoy", scope: { surface: "browser", domain: "cinejoy.com" }, primitives },
});

describe("gate ladders", () => {
  it("parses a three-rung record into rungs, rung 0 mirrored on the fence", () => {
    const parsed = parseFences(
      record([
        gate(40, { type: "breath", cycles: 5 }, "One more"),
        gate(60, { type: "breath", cycles: 8 }, "One more"),
        gate(30, { type: "intention", prompt: "Is one more what tonight is for?" }, "Yes"),
      ])
    );
    const f = parsed!.fences.cinejoy;
    expect(f.rungs?.map((r) => r.everyMinutes)).toEqual([40, 60, 30]);
    expect(f.rungs?.[2].friction).toEqual({ type: "intention", prompt: "Is one more what tonight is for?" });
    expect(f.enforcement).toMatchObject({ kind: "gate", everyMinutes: 40 });
    const g = gatesFrom(parsed!.fences)[0];
    expect(g.rungs).toHaveLength(3);
    expect(g.everyMinutes).toBe(40);
  });

  it("a single gate has no rungs", () => {
    const f = parseFences(record([gate(40, { type: "confirmation" }, "Go")]))!.fences.cinejoy;
    expect(f.rungs).toBeUndefined();
  });

  it("unwraps a schedule-wrapped rung", () => {
    const wrapped = {
      kind: "schedule",
      window: { fromHour: 18, toHour: 23 },
      outsideWindow: "inactive",
      wraps: gate(50, { type: "confirmation" }, "Go"),
    };
    const f = parseFences(record([gate(40, { type: "confirmation" }, "Go"), wrapped]))!.fences.cinejoy;
    expect(f.rungs?.map((r) => r.everyMinutes)).toEqual([40, 50]);
  });

  it("refuses a ladder with an exit-less rung", () => {
    const bad = { ...gate(60, { type: "confirmation" }, "x"), proceedAffordance: undefined };
    const parsed = parseFences(record([gate(40, { type: "confirmation" }, "Go"), bad]));
    expect(parsed!.refused).toEqual([{ id: "cinejoy", reason: "no_exit" }]);
  });
});
