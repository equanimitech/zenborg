import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());
const dwell = vi.hoisted(() => ({ ms: 0 }));
vi.mock("wxt/storage", () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (store.has(key) ? store.get(key) : opts.fallback),
      setValue: async (v: unknown) => void store.set(key, v),
    }),
  },
}));
vi.mock("@/modules/relay/client", () => ({ queryEvents: async () => [] }));
vi.mock("../../domain", async (orig) => ({
  ...(await orig<object>()),
  bouts: () => [{ byDomain: new Map([["example.com", dwell.ms]]) }],
}));

import { gatesFrom, parseFences } from "../../fence/parse";
import { decisionPointEvent } from "../../fence/events";
import { videoStartGateQuery } from "../../sensors/events";
import { evaluateGate, evaluateVideoStartGate, type DwellGate } from "./decide";
import { gateAtRung } from "./ladder";
import { videoStartGatesOf } from "./click";

const MIN = 60_000;
const gate = (over: Partial<DwellGate> = {}): DwellGate => ({
  ruleId: "yt",
  domains: ["example.com"],
  everyMinutes: 20,
  friction: { type: "confirmation" },
  proceed: { label: "Go on", action: { type: "continue" } },
  abort: { label: "Leave" },
  videoStart: 20,
  ...over,
});

const prim = (trigger: Record<string, unknown>, friction: Record<string, unknown>) => ({
  kind: "gate",
  trigger,
  frictionType: friction,
  proceedAffordance: { label: "Keep watching", action: { type: "continue" } },
});
const record = (primitives: unknown[]) => ({
  yt: { id: "yt", scope: { surface: "browser", domain: "youtube.com" }, primitives },
});
const videoStart = { type: "video_start", afterMinutes: 20 };

beforeEach(() => {
  store.clear();
  dwell.ms = 0;
});

describe("video_start parse", () => {
  it("is a video-start gate, not a one-minute dwell gate", () => {
    const [g] = gatesFrom(parseFences(record([prim(videoStart, { type: "confirmation" })]))!.fences);
    expect(g.videoStart).toBe(20);
    expect(g.click).toBeUndefined();
    expect(g.entry).toBeUndefined();
  });

  it("is carried per rung, and a dwell rung laid over it clears the trigger", () => {
    const [g] = gatesFrom(
      parseFences(
        record([
          prim(videoStart, { type: "intention", prompt: "Still here?" }),
          prim({ type: "video_start", afterMinutes: 40 }, { type: "delay", seconds: 15 }),
          prim({ type: "dwell", everyMinutes: 10 }, { type: "confirmation" }),
        ])
      )!.fences
    );
    expect(g.rungs?.map((r) => r.videoStart)).toEqual([20, 40, undefined]);
    expect(gateAtRung(g, 1).gate.videoStart).toBe(40);
    expect(gateAtRung(g, 2).gate.videoStart).toBeUndefined();
    expect(videoStartGatesOf([g])).toEqual(["yt"]);
  });

  it("refuses a threshold that is not positive", () => {
    const parsed = parseFences(record([prim({ type: "video_start", afterMinutes: 0 }, { type: "confirmation" })]));
    expect(parsed?.refused).toEqual([{ id: "yt", reason: "unactuatable" }]);
  });
});

describe("video_start verdict", () => {
  it("evaluateGate never fires a video-start rung on dwell", async () => {
    dwell.ms = 90 * MIN;
    expect(await evaluateGate(gate(), 1, 0)).toEqual({ fire: false, dwellMs: 0 });
  });

  it("below the threshold: no fire, no decision point", async () => {
    dwell.ms = 19 * MIN;
    const v = await evaluateVideoStartGate(gate(), 1, 0);
    expect(v.fire).toBe(false);
    expect(v.points ?? []).toHaveLength(0);
  });

  it("at or above the threshold: fires with a video_start point", async () => {
    dwell.ms = 20 * MIN;
    const v = await evaluateVideoStartGate(gate({ deliveryProbability: 0.7 }), 1, 0.1);
    expect(v).toMatchObject({ fire: true, ruleId: "yt", rung: 0 });
    expect(v.points?.[0]).toMatchObject({ trigger: "video_start", delivered: true, p: 0.7 });
  });

  it("withheld when draw >= p, but recorded", async () => {
    dwell.ms = 30 * MIN;
    const v = await evaluateVideoStartGate(gate({ deliveryProbability: 0.7 }), 1, 0.7);
    expect(v.fire).toBe(false);
    expect(v.points?.[0]).toMatchObject({ trigger: "video_start", delivered: false, reason: "draw" });
  });

  it("a rule with no video-start trigger answers no", async () => {
    dwell.ms = 30 * MIN;
    expect((await evaluateVideoStartGate(gate({ videoStart: undefined }), 1, 0)).fire).toBe(false);
  });

  it("the point round-trips into a decision_point event", async () => {
    dwell.ms = 30 * MIN;
    const v = await evaluateVideoStartGate(gate(), 1, 0);
    const e = decisionPointEvent({ point: v.points![0], domain: "example.com", id: "i", ts: 1, sessionId: "s" });
    expect(e.payload).toMatchObject({ trigger: "video_start" });
  });
});

describe("videoStartGateQuery", () => {
  it("returns the rule id the page names, else null", () => {
    expect(videoStartGateQuery({ type: "kairos-gate-video-start", ruleId: "yt" })).toBe("yt");
    expect(videoStartGateQuery({ type: "kairos-gate-click", ruleId: "yt" })).toBeNull();
    expect(videoStartGateQuery({ type: "kairos-gate-video-start", ruleId: "" })).toBeNull();
  });
});
