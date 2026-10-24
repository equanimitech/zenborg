import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withLifts, type Lift, type Opening } from "./lifts";
import { parseFences } from "./parse";
import type { Fences } from "./types";

// The storage items and the relay, in memory. `pass.ts` is the effectful half;
// this pins the checks it makes before anything is written.
const state = {
  fences: {} as Fences,
  openings: [] as Opening[],
  passes: [] as Lift[],
  hostEvents: [] as { id: string; kind: string; ts: number }[],
  synced: 0,
};
const item = <K extends "openings" | "passes">(k: K) => ({
  getValue: async () => state[k],
  setValue: async (v: (typeof state)[K]) => {
    state[k] = v;
  },
});

vi.mock("./store", () => ({
  liveFences: async () => withLifts(state.fences, [...state.openings, ...state.passes], Date.now()),
  passAllowance: { getValue: async () => null },
  passLifts: item("passes"),
  openingsCache: item("openings"),
  openingsAnnounced: { getValue: async () => [], setValue: async () => {} },
}));
vi.mock("../relay/client", () => ({ queryEvents: async () => state.hostEvents }));
vi.mock("../activity/log", () => ({ readEventsSince: async () => [] }));
vi.mock("./project", () => ({
  syncFenceRules: async () => {
    state.synced += 1;
  },
}));

const { usePass, blockInfo } = await import("./pass");

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 24, 17);

function timeBlock(host: string) {
  return {
    id: `watering:afternoon-only:browser:${host}`,
    scope: { surface: "browser", domain: host },
    primitives: [
      {
        kind: "schedule",
        window: { fromHour: 16, toHour: 13 },
        outsideWindow: "inactive",
        wraps: {
          kind: "cooldown",
          duration: { type: "standing" },
          unlockPath: { type: "out_of_band", note: "Open 13h to 16h." },
          enforcement: { at: "browser", reach: "navigation" },
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.fences = parseFences({ y: timeBlock("youtube.com"), c: timeBlock("chess.com") }, NOW)!.fences;
  state.openings = [];
  state.passes = [];
  state.hostEvents = [];
  state.synced = 0;
});
afterEach(() => vi.useRealTimers());

describe("usePass", () => {
  it("opens this host for 3 hours and writes pass_used with domain and reason only", async () => {
    const write = vi.fn();
    expect(await blockInfo("youtube.com")).toMatchObject({
      open: false,
      notes: ["Open 13h to 16h."],
      pass: { left: 4, perMonth: 4, hours: 3, month: "October" },
    });
    const result = await usePass("youtube.com", "film with friends", write);
    expect(result).toEqual({ ok: true, until: NOW + 3 * 3_600_000 });
    expect(write).toHaveBeenCalledWith("pass_used", {
      domain: "youtube.com",
      reason: "film with friends",
      until: NOW + 3 * 3_600_000,
    });
    expect(state.synced).toBe(1);
    expect((await blockInfo("youtube.com")).open).toBe(true);
    expect((await blockInfo("chess.com")).open).toBe(false);
  });

  it("does not burn a pass while an opening already holds the host open", async () => {
    state.openings = [
      { id: "opening:x:youtube-com", hosts: ["youtube.com"], from: NOW - 3_600_000, until: NOW + 3_600_000, reason: "film" },
    ];
    const write = vi.fn();
    expect(await usePass("youtube.com", "again", write)).toEqual({ ok: true, alreadyOpen: true });
    expect(write).not.toHaveBeenCalled();
    expect(state.passes).toEqual([]);
  });

  it("refuses the 5th pass in a month, and the 1st of the next month has 4 again", async () => {
    state.hostEvents = [1, 2, 3, 4].map((d) => ({ id: `p${d}`, kind: "pass_used", ts: at(2026, 10, d, 20) }));
    const write = vi.fn();
    expect((await blockInfo("youtube.com")).pass?.left).toBe(0);
    expect(await usePass("youtube.com", "one more", write)).toEqual({ ok: false, error: "none_left" });
    expect(write).not.toHaveBeenCalled();

    vi.setSystemTime(at(2026, 11, 1, 17));
    expect((await blockInfo("youtube.com")).pass).toMatchObject({ left: 4, month: "November" });
  });

  it("offers no pass when nothing time-blocks the host", async () => {
    expect(await usePass("example.com", "why", vi.fn())).toEqual({ ok: true, alreadyOpen: true });
  });
});
