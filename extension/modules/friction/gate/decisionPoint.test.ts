import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("wxt/storage", () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (store.has(key) ? store.get(key) : opts.fallback),
      setValue: async (v: unknown) => void store.set(key, v),
    }),
  },
}));
// 10 attended minutes today on example.com, one bout.
vi.mock("@/modules/relay/client", () => ({ queryEvents: async () => [] }));
vi.mock("../../domain", async (orig) => ({
  ...(await orig<object>()),
  bouts: () => [{ byDomain: new Map([["example.com", 3_600_000]]) }],
}));

import { decisionPointEvent } from "../../fence/events";
import { decisionPoint, evaluateClickGate, evaluateGate, evaluateGates, type DwellGate } from "./decide";

const gate = (over: Partial<DwellGate> = {}): DwellGate => ({
  ruleId: "r1",
  domains: ["example.com"],
  everyMinutes: 20,
  friction: { type: "confirmation" },
  proceed: { label: "Go on", action: { type: "continue" } },
  abort: { label: "Leave" },
  ...over,
});

beforeEach(() => store.clear());

describe("decisionPoint — delivered iff draw < p", () => {
  it("absent p means 1: any draw in [0,1) delivers", () => {
    const pt = decisionPoint(gate(), "dwell", 0, 0.999);
    expect(pt).toMatchObject({ delivered: true, p: 1, windowMs: 600_000 });
    expect(pt.reason).toBeUndefined();
  });
  it("withheld when draw >= p, with reason draw", () => {
    expect(decisionPoint(gate({ deliveryProbability: 0.3 }), "click", 2, 0.3)).toMatchObject({
      delivered: false,
      reason: "draw",
      rung: 2,
    });
    expect(decisionPoint(gate({ deliveryProbability: 0.3 }), "click", 0, 0.29).delivered).toBe(true);
  });
  it("carries windowMs and servesAreaId from the rule", () => {
    expect(decisionPoint(gate({ windowMs: 5, servesAreaId: "a" }), "entry", 0, 0)).toMatchObject({
      windowMs: 5,
      servesAreaId: "a",
    });
  });
});

describe("decisionPointEvent — payload is allowlisted fields only", () => {
  it("has no url or title", () => {
    const e = decisionPointEvent({
      point: decisionPoint(gate({ deliveryProbability: 0.5, servesAreaId: "a" }), "dwell", 0, 0.9),
      domain: "example.com",
      id: "i",
      ts: 1,
      sessionId: "s",
    });
    expect(e.kind).toBe("decision_point");
    expect(Object.keys(e.payload ?? {}).sort()).toEqual(
      ["delivered", "domain", "draw", "p", "reason", "ruleId", "rung", "servesAreaId", "trigger", "windowMs"].sort()
    );
  });
});

describe("gate paths", () => {
  it("a withheld dwell point still advances lastFiredAt", async () => {
    const g = gate({ deliveryProbability: 0.1 });
    const first = await evaluateGate(g, 1_000, 0.9);
    expect(first.fire).toBe(false);
    expect(first.points).toHaveLength(1);
    expect(first.points?.[0]).toMatchObject({ trigger: "dwell", delivered: false, reason: "draw" });
    const second = await evaluateGate(g, 2_000, 0.0);
    expect(second.points ?? []).toHaveLength(0); // not due again
  });

  it("a withheld click lets the click through but is recorded", async () => {
    const v = await evaluateClickGate(gate({ click: ["button"], deliveryProbability: 0.5 }), 1, 0.7);
    expect(v.fire).toBe(false);
    expect(v.points?.[0]).toMatchObject({ trigger: "click", delivered: false });
  });

  it("entry on arrival draws once", async () => {
    const v = await evaluateGate(gate({ entry: true, deliveryProbability: 0.5 }), 1, 0.7);
    expect(v.points?.[0]).toMatchObject({ trigger: "entry", delivered: false });
  });

  it("a due gate beaten by a rarer one is superseded, not delivered", async () => {
    const v = await evaluateGates([gate({ ruleId: "cheap", everyMinutes: 20 }), gate({ ruleId: "rare", everyMinutes: 60 })], 1, () => 0);
    expect(v.ruleId).toBe("rare");
    const by = Object.fromEntries((v.points ?? []).map((p) => [p.ruleId, p]));
    expect(by.rare.delivered).toBe(true);
    expect(by.cheap).toMatchObject({ delivered: false, reason: "superseded" });
  });
});
