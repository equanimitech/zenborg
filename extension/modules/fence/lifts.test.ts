import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLiftActive,
  nextLiftEdge,
  passesUsedThisMonth,
  readPassRequest,
  returnTarget,
  startOfLocalMonth,
  withLifts,
  type Lift,
} from "./lifts";
import { gatesFrom, parseFences, standingBlockHosts } from "./parse";

const H = 3_600_000;
// Local wall-clock instants, so every assertion holds in any time zone.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

/** The vault shape of a watering-hours block: 16h to 13h, standing, navigation reach. */
function timeBlock(host: string) {
  return {
    id: `watering:afternoon-only:browser:${host}`,
    name: `afternoon-only (${host})`,
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

const ladder = {
  id: "youtube-ladder",
  name: "YouTube ladder",
  scope: { surface: "browser", domain: "youtube.com" },
  primitives: [
    {
      kind: "gate",
      trigger: { type: "dwell", everyMinutes: 10 },
      frictionType: { type: "intention", prompt: "Still what you came for?" },
      proceedAffordance: { label: "Keep watching", action: { type: "continue" } },
    },
  ],
};

const standing = {
  id: "shield-porn",
  label: "Shield",
  domains: ["example-porn.com"],
  enforcement: { kind: "cooldown", enforcement: "browser", standing: true },
  proceed: { label: "Lift it", action: { type: "out_of_band", note: "edit the rule file" } },
};

function opening(from: number, until: number, hosts = ["youtube.com"]) {
  const iso = new Date(from).toISOString();
  return {
    id: `opening:${iso}:youtube-com`,
    kind: "opening",
    hosts,
    from: iso,
    until: new Date(until).toISOString(),
    reason: "friends over",
  };
}

describe("pass count by month", () => {
  const used = (ts: number) => ({ kind: "pass_used", ts });

  it("counts pass_used this local month only", () => {
    const now = at(2026, 10, 24, 17);
    const events = [used(at(2026, 10, 1, 0, 0)), used(at(2026, 10, 20, 21)), used(at(2026, 9, 30, 23, 59))];
    expect(passesUsedThisMonth(events, now)).toBe(2);
  });

  it("resets on the 1st at local midnight, not UTC", () => {
    const lateOct = used(at(2026, 10, 31, 23, 30));
    expect(passesUsedThisMonth([lateOct], at(2026, 10, 31, 23, 45))).toBe(1);
    expect(passesUsedThisMonth([lateOct], at(2026, 11, 1, 0, 5))).toBe(0);
    expect(startOfLocalMonth(at(2026, 11, 1, 0, 5))).toBe(at(2026, 11, 1));
  });

  it("ignores other kinds", () => {
    expect(passesUsedThisMonth([{ kind: "opening_active", ts: at(2026, 10, 2) }], at(2026, 10, 3))).toBe(0);
  });
});

describe("the lift window", () => {
  const lift: Lift = { hosts: ["youtube.com"], from: at(2026, 10, 24, 17), until: at(2026, 10, 24, 20) };

  it("opens at from and closes at until", () => {
    expect(isLiftActive(lift, lift.from - 1)).toBe(false);
    expect(isLiftActive(lift, lift.from)).toBe(true);
    expect(isLiftActive(lift, lift.until - 1)).toBe(true);
    expect(isLiftActive(lift, lift.until)).toBe(false);
  });

  it("the next edge is the start, then the end, then none", () => {
    expect(nextLiftEdge([lift], lift.from - H)).toBe(lift.from);
    expect(nextLiftEdge([lift], lift.from)).toBe(lift.until);
    expect(nextLiftEdge([lift], lift.until)).toBeNull();
  });

  afterEach(() => vi.useRealTimers());

  it("lifts scheduled blocks and gates on the host, and nothing else", () => {
    // `standingBlockHosts` reads the schedule against the clock: 18h is inside 16h to 13h.
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 10, 24, 18));
    const parsed = parseFences(
      {
        y: timeBlock("youtube.com"),
        m: timeBlock("m.youtube.com"),
        c: timeBlock("chess.com"),
        ladder,
        standing: { ...standing, domains: ["youtube.com"] },
      },
      lift.from
    );
    const now = at(2026, 10, 24, 18);
    const lifted = withLifts(parsed!.fences, [lift], now);
    // DNR during the pass: chess.com stays blocked, youtube.com and m.youtube.com come out.
    expect(standingBlockHosts(lifted, "navigation")).toEqual(["chess.com"]);
    // A standing block with no schedule keeps holding.
    expect(standingBlockHosts(lifted, "all")).toEqual(["youtube.com"]);
    // No YouTube gate fires.
    expect(gatesFrom(lifted)).toEqual([]);
    // At until, everything is back.
    const after = withLifts(parsed!.fences, [lift], lift.until);
    expect([...standingBlockHosts(after, "navigation")].sort()).toEqual(["chess.com", "m.youtube.com", "youtube.com"]);
    expect(gatesFrom(after)).toHaveLength(1);
  });
});

describe("opening records", () => {
  const now = at(2026, 10, 24, 19);

  it("reads an active or upcoming opening as a lift, never as a refused fence", () => {
    const active = opening(at(2026, 10, 24, 18), at(2026, 10, 25, 1));
    const upcoming = opening(at(2026, 10, 25, 20), at(2026, 10, 26, 1));
    const parsed = parseFences({ [active.id]: active, [upcoming.id]: upcoming }, now)!;
    expect(parsed.refused).toEqual([]);
    expect(parsed.fences).toEqual({});
    expect(parsed.openings.map((o) => o.id)).toEqual([active.id, upcoming.id]);
    expect(parsed.openings[0]).toMatchObject({
      hosts: ["youtube.com"],
      from: at(2026, 10, 24, 18),
      until: at(2026, 10, 25, 1),
      reason: "friends over",
    });
  });

  it("ignores an expired or malformed opening", () => {
    const expired = opening(at(2026, 10, 23, 20), at(2026, 10, 24, 1));
    const backwards = opening(at(2026, 10, 25, 1), at(2026, 10, 24, 20));
    const noHosts = { ...opening(at(2026, 10, 24, 18), at(2026, 10, 25, 1)), hosts: [] };
    const parsed = parseFences({ a: expired, b: backwards, c: noHosts }, now)!;
    expect(parsed.openings).toEqual([]);
    expect(parsed.refused).toEqual([]);
  });

  it("reads the allowance record, and leaves it absent when there is none", () => {
    const withRecord = parseFences({ "pass-allowance": { id: "pass-allowance", kind: "pass-allowance", perMonth: 2, hours: 1.5 } }, now)!;
    expect(withRecord.allowance).toEqual({ perMonth: 2, hours: 1.5 });
    expect(parseFences({}, now)!.allowance).toBeUndefined();
  });
});

describe("the block page boundary", () => {
  it("a pass request needs a host and a line of why", () => {
    expect(readPassRequest({ type: "zenborg-use-pass", host: "www.YouTube.com", reason: " friends\nover " })).toEqual({
      host: "youtube.com",
      reason: "friends over",
    });
    expect(readPassRequest({ type: "zenborg-use-pass", host: "youtube.com", reason: "   " })).toBeNull();
    expect(readPassRequest({ type: "zenborg-use-pass", host: "javascript:alert(1)", reason: "x" })).toBeNull();
  });

  it("returns to the blocked URL on that host, else the front page", () => {
    expect(returnTarget("https://www.youtube.com/watch?v=abc", "youtube.com")).toBe("https://www.youtube.com/watch?v=abc");
    expect(returnTarget("https://evil.example/", "youtube.com")).toBe("https://youtube.com/");
    expect(returnTarget("javascript:alert(1)", "youtube.com")).toBe("https://youtube.com/");
    expect(returnTarget(null, "youtube.com")).toBe("https://youtube.com/");
  });
});
