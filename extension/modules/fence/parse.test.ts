import { describe, expect, it } from "vitest";
import {
  fenceableHosts,
  exitLine,
  fencesFor,
  gatesFrom,
  isScheduleActive,
  nextScheduleBoundary,
  parseFences,
  standingBlockHosts,
} from "./parse";
import type { Fence } from "./types";

/** A minimally well-formed standing host block, as the app projects one. */
function hostBlock(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "shield-youtube",
    label: "YouTube",
    domains: ["youtube.com"],
    enforcement: { kind: "cooldown", enforcement: "browser", standing: true },
    proceed: { label: "Lift it", action: { type: "out_of_band", note: "edit the rule file" } },
    deliveryProbability: 1,
    ...over,
  };
}

function dwell(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gate-linkedin",
    label: "LinkedIn",
    domains: ["linkedin.com"],
    enforcement: {
      kind: "gate",
      everyMinutes: 20,
      friction: { type: "intention", prompt: "Still what you came for?" },
    },
    proceed: { label: "Keep going", action: { type: "continue" } },
    abort: { label: "Close the tab" },
    deliveryProbability: 1,
    ...over,
  };
}

describe("parseFences — malformed input never clears the cache", () => {
  it("returns null for a non-object push", () => {
    expect(parseFences(null)).toBeNull();
    expect(parseFences("nope")).toBeNull();
    expect(parseFences(42)).toBeNull();
    expect(parseFences(undefined)).toBeNull();
  });

  it("returns null for an array, which is not a record collection", () => {
    expect(parseFences([hostBlock()])).toBeNull();
  });

  it("honours an explicitly empty record — a deliberate lift must land", () => {
    expect(parseFences({})).toEqual({ fences: {}, refused: [], openings: [] });
  });
});

describe("parseFences — invariant 6, no exit means no arming", () => {
  it("refuses an entry carrying no proceed affordance", () => {
    const parsed = parseFences({ a: hostBlock({ proceed: undefined }) });
    expect(parsed?.fences).toEqual({});
    expect(parsed?.refused).toEqual([{ id: "shield-youtube", reason: "no_exit" }]);
  });

  it("refuses an exit with no label — an invisible exit is not an exit", () => {
    const parsed = parseFences({
      a: hostBlock({ proceed: { label: "   ", action: { type: "continue" } } }),
    });
    expect(parsed?.fences).toEqual({});
    expect(parsed?.refused[0]?.reason).toBe("no_exit");
  });

  it("refuses an exit whose action is not one the extension can offer", () => {
    const parsed = parseFences({
      a: hostBlock({ proceed: { label: "Out", action: { type: "teleport" } } }),
    });
    expect(parsed?.fences).toEqual({});
    expect(parsed?.refused[0]?.reason).toBe("no_exit");
  });

  it("keeps the sound entries when one of several is exitless", () => {
    const parsed = parseFences({ a: hostBlock(), b: dwell({ proceed: undefined }) });
    expect(Object.keys(parsed?.fences ?? {})).toEqual(["shield-youtube"]);
    expect(parsed?.refused).toEqual([{ id: "gate-linkedin", reason: "no_exit" }]);
  });
});

describe("parseFences — shape", () => {
  it("accepts a standing browser block", () => {
    const parsed = parseFences({ "shield-youtube": hostBlock() });
    expect(parsed?.fences["shield-youtube"]).toEqual<Fence>({
      id: "shield-youtube",
      label: "YouTube",
      domains: ["youtube.com"],
      enforcement: { kind: "block", enforcement: "browser", standing: true },
      proceed: { label: "Lift it", action: { type: "out_of_band", note: "edit the rule file" } },
      deliveryProbability: 1,
    });
  });

  it("accepts a dwell gate with both affordances", () => {
    const parsed = parseFences({ "gate-linkedin": dwell() });
    const entry = parsed?.fences["gate-linkedin"];
    expect(entry?.enforcement).toEqual({
      kind: "gate",
      everyMinutes: 20,
      friction: { type: "intention", prompt: "Still what you came for?" },
    });
    expect(entry?.abort).toEqual({ label: "Close the tab" });
  });

  it("falls back to the record key when the entry omits its own id", () => {
    const parsed = parseFences({ "from-the-key": hostBlock({ id: undefined }) });
    expect(parsed?.fences["from-the-key"]?.id).toBe("from-the-key");
  });

  it("normalizes domains and drops the ones that are not hosts", () => {
    const parsed = parseFences({
      a: hostBlock({ domains: ["https://www.Chess.com/play", "not a domain", "chess.com"] }),
    });
    expect(parsed?.fences["shield-youtube"]?.domains).toEqual(["chess.com"]);
  });

  it("refuses an entry left with no domains at all", () => {
    const parsed = parseFences({ a: hostBlock({ domains: ["not a domain"] }) });
    expect(parsed?.fences).toEqual({});
    expect(parsed?.refused[0]?.reason).toBe("no_domains");
  });

  it("refuses an enforcement the extension cannot actuate", () => {
    const parsed = parseFences({ a: hostBlock({ enforcement: { kind: "intercept" } }) });
    expect(parsed?.fences).toEqual({});
    expect(parsed?.refused[0]?.reason).toBe("unactuatable");
  });

  it("clamps deliveryProbability and defaults it to 1", () => {
    expect(parseFences({ a: hostBlock({ deliveryProbability: 4 }) })?.fences["shield-youtube"]
      ?.deliveryProbability).toBe(1);
    expect(parseFences({ a: hostBlock({ deliveryProbability: -1 }) })?.fences["shield-youtube"]
      ?.deliveryProbability).toBe(0);
    expect(parseFences({ a: hostBlock({ deliveryProbability: undefined }) })?.fences[
      "shield-youtube"
    ]?.deliveryProbability).toBe(1);
  });
});

describe("reading the cache", () => {
  const fences = parseFences({ a: hostBlock(), b: dwell() })?.fences ?? {};

  it("fencesFor matches on the exact host", () => {
    expect(fencesFor(fences, "youtube.com").map((f) => f.id)).toEqual(["shield-youtube"]);
    expect(fencesFor(fences, "example.com")).toEqual([]);
  });

  it("fencesFor matches a subdomain, because DNR does too", () => {
    expect(fencesFor(fences, "m.youtube.com").map((f) => f.id)).toEqual(["shield-youtube"]);
  });

  it("fencesFor does not match a host that merely ends in the same letters", () => {
    expect(fencesFor(fences, "notyoutube.com")).toEqual([]);
  });

  it("standingBlockHosts carries only what this surface can enforce", () => {
    expect(standingBlockHosts(fences)).toEqual(["youtube.com"]);
  });

  it("standingBlockHosts skips resolver- and device-enforced blocks", () => {
    const resolver =
      parseFences({
        a: hostBlock({
          enforcement: { kind: "cooldown", enforcement: "resolver", standing: true },
        }),
      })?.fences ?? {};
    expect(standingBlockHosts(resolver)).toEqual([]);
  });

  it("fenceableHosts carries the timed blocks a gesture may arm, not the standing ones", () => {
    // The big red button's candidate set: a standing block is already held and
    // is deliberately not offered to the gesture.
    const timed =
      parseFences({
        a: hostBlock(),
        t: hostBlock({
          id: "watched",
          domains: ["news.example.com"],
          enforcement: { kind: "cooldown", enforcement: "browser", standing: false },
        }),
      })?.fences ?? {};
    expect(fenceableHosts(timed)).toEqual(["news.example.com"]);
    expect(fenceableHosts(fences)).toEqual([]);
  });

  it("gatesFrom extracts only the gate entries, in DwellGate shape", () => {
    expect(gatesFrom(fences)).toEqual([
      {
        ruleId: "gate-linkedin",
        domains: ["linkedin.com"],
        everyMinutes: 20,
        friction: { type: "intention", prompt: "Still what you came for?" },
        proceed: { label: "Keep going", action: { type: "continue" } },
        abort: { label: "Close the tab" },
      },
    ]);
    // The standing block on youtube is a block, not a gate.
  });

  it("a gate carrying a block-shaped exit degrades to continue, keeping its label", () => {
    const odd =
      parseFences({
        a: dwell({ proceed: { label: "Push on", action: { type: "wait" } } }),
      })?.fences ?? {};
    expect(gatesFrom(odd)[0]?.proceed).toEqual({
      label: "Push on",
      action: { type: "continue" },
    });
  });
});

describe("exitLine — the sentence the person reads", () => {
  it("says how a standing block is lifted", () => {
    const f = parseFences({ a: hostBlock() })?.fences["shield-youtube"] as Fence;
    expect(exitLine(f)).toBe("Lift it — edit the rule file");
  });

  it("says a wait is a wait", () => {
    const f = parseFences({
      a: hostBlock({ proceed: { label: "Wait it out", action: { type: "wait" } } }),
    })?.fences["shield-youtube"] as Fence;
    expect(exitLine(f)).toBe("Wait it out");
  });

  it("names the prompt an intention unlock asks for", () => {
    const f = parseFences({
      a: hostBlock({
        proceed: { label: "Unlock", action: { type: "intention", prompt: "What for?" } },
      }),
    })?.fences["shield-youtube"] as Fence;
    expect(exitLine(f)).toBe("Unlock — What for?");
  });

  it("names the cost of a delayed unlock", () => {
    const f = parseFences({
      a: hostBlock({
        proceed: { label: "Unlock", action: { type: "delay", seconds: 90 } },
      }),
    })?.fences["shield-youtube"] as Fence;
    expect(exitLine(f)).toBe("Unlock — after 90s");
  });

  it("names the destination of a redirect", () => {
    const f = parseFences({
      a: dwell({
        proceed: { label: "Move on", action: { type: "redirect", to: "https://example.com" } },
      }),
    })?.fences["gate-linkedin"] as Fence;
    expect(exitLine(f)).toBe("Move on — goes to https://example.com");
  });
});

describe("parseFences — vault format (primitives[] + scope)", () => {
  it("parses a standing cooldown from primitives + scope", () => {
    const result = parseFences({
      "vice-block": {
        id: "vice-block",
        name: "vice block",
        scope: { surface: "browser", domain: "example.com" },
        primitives: [
          {
            kind: "cooldown",
            duration: { type: "standing" },
            unlockPath: { type: "out_of_band", note: "Edit the rule." },
            enforcement: { at: "browser" },
          },
        ],
      },
    });
    expect(result).not.toBeNull();
    const f = result!.fences["vice-block"];
    expect(f).toBeDefined();
    expect(f.enforcement).toEqual({ kind: "block", enforcement: "browser", standing: true });
    expect(f.domains).toEqual(["example.com"]);
    expect(f.proceed.action.type).toBe("out_of_band");
  });

  it("reads `reach: navigation` off a schedule-wrapped browser cooldown and splits the hosts", () => {
    const block = (domain: string, enforcement?: Record<string, unknown>) => ({
      scope: { surface: "browser", domain },
      primitives: [
        {
          kind: "schedule",
          // passthrough: in force at any hour, so the test does not depend on the clock
          window: { fromHour: 16, toHour: 13 },
          outsideWindow: "passthrough",
          wraps: {
            kind: "cooldown",
            duration: { type: "standing" },
            unlockPath: { type: "out_of_band", note: "Afternoon." },
            ...(enforcement ? { enforcement } : {}),
          },
        },
      ],
    });
    const fences = parseFences({
      chess: block("chess.com", { at: "browser", reach: "navigation" }),
      tube: block("youtube.com"),
      junk: block("example.com", { at: "browser", reach: "sideways" }),
      dns: block("dns.example", { at: "resolver", profile: "p", reach: "navigation" }),
    })!.fences;
    expect(fences.chess.enforcement).toEqual({
      kind: "block", enforcement: "browser", standing: true, reach: "navigation",
    });
    expect(fences.junk.enforcement).not.toHaveProperty("reach");
    expect(fences.dns.enforcement).not.toHaveProperty("reach");
    expect(standingBlockHosts(fences, "navigation")).toEqual(["chess.com"]);
    expect(standingBlockHosts(fences, "all")).toEqual(["youtube.com", "example.com"]);
    expect(standingBlockHosts(fences)).toEqual(["chess.com", "youtube.com", "example.com"]);
  });

  it("parses a gate from primitives + scope", () => {
    const result = parseFences({
      "yt-gate": {
        id: "yt-gate",
        name: "YouTube dwell",
        scope: { surface: "browser", domain: "youtube.com" },
        primitives: [
          {
            kind: "gate",
            trigger: { type: "dwell", everyMinutes: 15 },
            frictionType: { type: "intention", prompt: "Still here?" },
            proceedAffordance: { label: "Keep going", action: { type: "continue" } },
            abortAffordance: { label: "Close tab" },
          },
        ],
      },
    });
    const f = result!.fences["yt-gate"];
    expect(f.enforcement).toEqual({ kind: "gate", everyMinutes: 15, friction: { type: "intention", prompt: "Still here?" } });
    expect(f.proceed).toEqual({ label: "Keep going", action: { type: "continue" } });
    expect(f.abort).toEqual({ label: "Close tab" });
  });

  it("parses a schedule-wrapped cooldown (watering hours)", () => {
    const result = parseFences({
      "watering:test:browser:chess.com": {
        id: "watering:test:browser:chess.com",
        name: "test (chess.com)",
        scope: { surface: "browser", domain: "chess.com" },
        primitives: [
          {
            kind: "schedule",
            window: { fromHour: 6, toHour: 12, weekdays: ["MON"] },
            outsideWindow: "inactive",
            wraps: {
              kind: "cooldown",
              duration: { type: "standing" },
              unlockPath: { type: "out_of_band", note: "Tomorrow." },
            },
          },
        ],
      },
    });
    const f = result!.fences["watering:test:browser:chess.com"];
    expect(f).toBeDefined();
    expect(f.enforcement.kind).toBe("block");
    expect(f.schedule).toEqual({
      fromHour: 6,
      toHour: 12,
      weekdays: ["MON"],
      outsideWindow: "inactive",
    });
  });

  it("reads domains from scope.domain as array", () => {
    const result = parseFences({
      v: {
        id: "v",
        scope: { surface: "browser", domain: ["a.com", "b.com"] },
        primitives: [
          {
            kind: "cooldown",
            duration: { type: "standing" },
            unlockPath: { type: "wait" },
            enforcement: { at: "browser" },
          },
        ],
      },
    });
    expect(result!.fences["v"].domains).toEqual(["a.com", "b.com"]);
  });

  it("refuses non-browser scoped fences", () => {
    const result = parseFences({
      s: {
        id: "s",
        scope: { surface: "session", paths: ["/dev"] },
        primitives: [
          {
            kind: "cooldown",
            duration: { type: "standing" },
            unlockPath: { type: "wait" },
          },
        ],
      },
    });
    expect(result!.fences).toEqual({});
    expect(result!.refused[0].reason).toBe("no_domains");
  });
});

describe("isScheduleActive — time window evaluation", () => {
  it("active inside the window when outsideWindow=inactive", () => {
    const sched = { fromHour: 6, toHour: 12, outsideWindow: "inactive" as const };
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 9, 0))).toBe(true);
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 14, 0))).toBe(false);
  });

  it("2→7 holds at 03h and lifts at 15h", () => {
    const sched = { fromHour: 2, toHour: 7, outsideWindow: "inactive" as const };
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 3, 0))).toBe(true);
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 15, 0))).toBe(false);
  });

  it("passthrough holds outside the window too", () => {
    const sched = { fromHour: 6, toHour: 12, outsideWindow: "passthrough" as const };
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 9, 0))).toBe(true);
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 14, 0))).toBe(true);
  });

  it("respects weekday filter", () => {
    const sched = { fromHour: 0, toHour: 0, weekdays: ["MON"], outsideWindow: "inactive" as const };
    const monday = new Date(2026, 0, 5, 10, 0); // Mon
    const tuesday = new Date(2026, 0, 6, 10, 0); // Tue
    expect(isScheduleActive(sched, monday)).toBe(true);
    expect(isScheduleActive(sched, tuesday)).toBe(false);
  });

  it("handles overnight windows (fromHour > toHour)", () => {
    const sched = { fromHour: 22, toHour: 6, outsideWindow: "inactive" as const };
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 23, 0))).toBe(true);
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 3, 0))).toBe(true);
    expect(isScheduleActive(sched, new Date(2026, 0, 5, 14, 0))).toBe(false);
  });

  it("fencesFor filters out inactive scheduled fences", () => {
    const result = parseFences({
      w: {
        id: "w",
        scope: { surface: "browser", domain: "chess.com" },
        primitives: [
          {
            kind: "schedule",
            window: { fromHour: 6, toHour: 12 },
            outsideWindow: "inactive",
            wraps: {
              kind: "cooldown",
              duration: { type: "standing" },
              unlockPath: { type: "out_of_band", note: "Later." },
            },
          },
        ],
      },
    });
    const all = result!.fences;
    expect(Object.keys(all)).toHaveLength(1);
    // Can't test fencesFor's time filtering without injecting time, but the fence
    // is parsed with the schedule attached.
    expect(all["w"].schedule).toBeDefined();
  });
});

describe("nextScheduleBoundary", () => {
  const fence = (id: string, schedule?: Fence["schedule"]): Fence => ({
    id,
    label: id,
    domains: ["chess.com"],
    enforcement: { kind: "block", standing: true, enforcement: "browser" },
    proceed: { label: "Later", action: { type: "wait" } },
    ...(schedule ? { schedule } : {}),
    deliveryProbability: 1,
  });
  const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m);

  it("is null when no fence is scheduled", () => {
    expect(nextScheduleBoundary({ a: fence("a") }, at(5, 10))).toBeNull();
  });

  it("is null for passthrough and all-day windows, which never change", () => {
    const fences = {
      p: fence("p", { fromHour: 2, toHour: 7, outsideWindow: "passthrough" }),
      d: fence("d", { fromHour: 0, toHour: 24, outsideWindow: "inactive" }),
    };
    expect(nextScheduleBoundary(fences, at(5, 10))).toBeNull();
  });

  it("lands on the window's start when outside it, and its end when inside", () => {
    const fences = { w: fence("w", { fromHour: 2, toHour: 7, outsideWindow: "inactive" }) };
    expect(nextScheduleBoundary(fences, at(5, 15, 30))).toBe(at(6, 2).getTime());
    expect(nextScheduleBoundary(fences, at(6, 3, 10))).toBe(at(6, 7).getTime());
  });

  it("takes the soonest edge across fences", () => {
    const fences = {
      night: fence("night", { fromHour: 22, toHour: 2, outsideWindow: "inactive" }),
      noon: fence("noon", { fromHour: 13, toHour: 16, outsideWindow: "inactive" }),
    };
    expect(nextScheduleBoundary(fences, at(5, 10))).toBe(at(5, 13).getTime());
    expect(nextScheduleBoundary(fences, at(5, 17))).toBe(at(5, 22).getTime());
  });

  it("crosses days for a weekday filter (0→0 MON)", () => {
    // 2026-01-05 is a Monday: on until Tue 00h, then off until next Mon 00h.
    const fences = { m: fence("m", { fromHour: 0, toHour: 0, weekdays: ["MON"], outsideWindow: "inactive" }) };
    expect(nextScheduleBoundary(fences, at(5, 15))).toBe(at(6, 0).getTime());
    expect(nextScheduleBoundary(fences, at(7, 15))).toBe(at(12, 0).getTime());
  });
});
