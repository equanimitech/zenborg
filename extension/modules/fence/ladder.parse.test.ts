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

  it("parses a click-trigger ladder: selectors per rung, carried to the gate", () => {
    const click = (friction: Record<string, unknown>) => ({
      ...gate(0, friction, "One more"),
      trigger: {
        type: "click",
        selectors: { primary: "button.play", fallbacks: [".row button", "", "button.play"] },
      },
    });
    const parsed = parseFences({
      chess: {
        id: "chess",
        scope: { surface: "browser", domain: "chess.com" },
        deliveryProbability: 0.7,
        primitives: [click({ type: "intention", prompt: "Another?" }), click({ type: "delay", seconds: 15 })],
      },
    })!;
    const f = parsed.fences.chess;
    expect(f.enforcement).toMatchObject({ kind: "gate", click: ["button.play", ".row button"] });
    expect(f.rungs?.map((r) => r.click)).toEqual([
      ["button.play", ".row button"],
      ["button.play", ".row button"],
    ]);
    const g = gatesFrom(parsed.fences)[0];
    expect(g.click).toEqual(["button.play", ".row button"]);
    expect(g.deliveryProbability).toBe(0.7);
    expect(g.rungs?.[1].friction).toEqual({ type: "delay", seconds: 15 });
  });

  it("a dwell gate carries no click and no draw at probability 1", () => {
    const g = gatesFrom(parseFences(record([gate(40, { type: "confirmation" }, "Go")]))!.fences)[0];
    expect(g.click).toBeUndefined();
    expect(g.deliveryProbability).toBeUndefined();
  });

  it("refuses a click trigger with no primary selector rather than reading it as dwell", () => {
    const noSel = {
      ...gate(0, { type: "confirmation" }, "Go"),
      trigger: { type: "click", selectors: { primary: " ", fallbacks: [".x"] } },
    };
    expect(parseFences(record([noSel]))!.refused).toEqual([{ id: "cinejoy", reason: "unactuatable" }]);
  });

  it("refuses a ladder with an exit-less rung", () => {
    const bad = { ...gate(60, { type: "confirmation" }, "x"), proceedAffordance: undefined };
    const parsed = parseFences(record([gate(40, { type: "confirmation" }, "Go"), bad]));
    expect(parsed!.refused).toEqual([{ id: "cinejoy", reason: "no_exit" }]);
  });
});
