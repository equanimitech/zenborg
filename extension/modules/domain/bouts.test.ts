import { describe, expect, it } from "vitest";
import { BOUT_GAP_MS, SEGMENT_CAP_MS, SWITCH_FLOOR_MS, bouts } from "./bouts.js";
import { createActivityEvent, type ActivityEvent } from "./activity.js";
import { createDomain, toMinutes } from "./value-objects.js";

const MIN = 60_000;
let seq = 0;

/** Terse event builder — ids are unique unless one is supplied (dedup tests). */
function ev(ts: number, kind: string, domain?: string, id?: string): ActivityEvent {
  seq += 1;
  return createActivityEvent({
    id: id ?? `e${seq}`,
    surface: "browser",
    kind,
    ts,
    payload: domain === undefined ? {} : { domain },
  });
}

describe("bouts — dwell attribution", () => {
  it("credits a gap backwards, to the domain in flight", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "youtube.com"),
      ev(10 * MIN, "tab_closed", "youtube.com"),
    ]);
    expect(toMinutes(bout.dwellMs)).toBe(10);
    expect(toMinutes(bout.byDomain.get(createDomain("youtube.com"))!)).toBe(10);
  });

  it("caps a single gap so an abandoned tab cannot invent a night of dwell", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "youtube.com"),
      // Inside the bout timeout, but far longer than the segment cap.
      ev(SEGMENT_CAP_MS, "tab_activated", "youtube.com"),
    ]);
    expect(bout.dwellMs).toBe(SEGMENT_CAP_MS);
  });

  it("does not accumulate while attention is off", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "youtube.com"),
      ev(1 * MIN, "idle_start"),
      ev(20 * MIN, "idle_end"),
      ev(21 * MIN, "tab_closed", "youtube.com"),
    ]);
    // 1 min before idling, 1 min after returning. The 19 idle minutes are void.
    expect(toMinutes(bout.dwellMs)).toBe(2);
  });

  it("treats losing OS focus the same as going idle", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "chess.com"),
      ev(2 * MIN, "focus_end"),
      ev(15 * MIN, "focus_start"),
      ev(16 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(toMinutes(bout.dwellMs)).toBe(3);
  });

  it("dedups repeated event ids — the relay can deliver a batch twice", () => {
    const duped = ev(0, "navigation_committed", "youtube.com", "same");
    const [bout] = bouts([
      duped,
      duped,
      ev(5 * MIN, "tab_closed", "youtube.com"),
    ]);
    expect(toMinutes(bout.dwellMs)).toBe(5);
  });

  it("sorts an out-of-order stream before deriving", () => {
    const [bout] = bouts([
      ev(5 * MIN, "tab_closed", "youtube.com"),
      ev(0, "navigation_committed", "youtube.com"),
    ]);
    expect(toMinutes(bout.dwellMs)).toBe(5);
  });
});

describe("bouts — segmentation", () => {
  it("splits when the stream goes quiet past the visit timeout", () => {
    const result = bouts([
      ev(0, "navigation_committed", "youtube.com"),
      ev(1 * MIN, "tab_closed", "youtube.com"),
      ev(1 * MIN + BOUT_GAP_MS + 1, "navigation_committed", "chess.com"),
      ev(2 * MIN + BOUT_GAP_MS + 1, "tab_closed", "chess.com"),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].dominant).toBe(createDomain("youtube.com"));
    expect(result[1].dominant).toBe(createDomain("chess.com"));
  });

  it("keeps one bout across domain changes, counting them as switches", () => {
    const result = bouts([
      ev(0, "navigation_committed", "youtube.com"),
      ev(1 * MIN, "tab_activated", "chess.com"),
      ev(2 * MIN, "tab_activated", "youtube.com"),
      ev(3 * MIN, "tab_closed", "youtube.com"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].switches).toBe(2);
  });

  it("does not count staying on one domain as a switch", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "youtube.com"),
      ev(1 * MIN, "tab_activated", "youtube.com"),
      ev(2 * MIN, "video_started", "youtube.com"),
    ]);
    expect(bout.switches).toBe(0);
  });

  // 67% of real domain dwells are under the floor. Counting them made
  // fragmentation two-thirds noise — this is the regression that guards it.
  it("does not count a glance below the floor as a switch", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "github.com"),
      ev(5 * MIN, "tab_activated", "youtube.com"),
      // Five seconds on youtube, then straight back — a peek, not a switch.
      ev(5 * MIN + 5_000, "tab_activated", "github.com"),
      ev(10 * MIN, "tab_closed", "github.com"),
    ]);
    expect(bout.switches).toBe(0);
  });

  it("counts a move between two domains that each hold past the floor", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "github.com"),
      ev(5 * MIN, "tab_activated", "youtube.com"),
      ev(10 * MIN, "tab_closed", "youtube.com"),
    ]);
    expect(bout.switches).toBe(1);
  });

  it("counts a dwell of exactly the floor", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "github.com"),
      ev(SWITCH_FLOOR_MS, "tab_activated", "youtube.com"),
      ev(SWITCH_FLOOR_MS * 2, "tab_closed", "youtube.com"),
    ]);
    expect(bout.switches).toBe(1);
  });

  it("does not credit the first substantial domain as a switch", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "github.com"),
      ev(5 * MIN, "tab_closed", "github.com"),
    ]);
    expect(bout.switches).toBe(0);
  });

  it("ignores time on a domain while attention is off, so it never turns substantial", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "github.com"),
      ev(5 * MIN, "tab_activated", "youtube.com"),
      ev(5 * MIN, "focus_end"),
      // Ten unattended minutes on youtube must not make it substantial.
      ev(15 * MIN, "focus_start"),
      ev(15 * MIN, "tab_activated", "github.com"),
      ev(20 * MIN, "tab_closed", "github.com"),
    ]);
    expect(bout.switches).toBe(0);
  });
});

describe("bouts — the binge signal", () => {
  it("reports the longest unbroken single-domain stretch", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "chess.com"),
      ev(3 * MIN, "tab_activated", "youtube.com"),
      // 25 unbroken minutes on one domain, then away.
      ev(28 * MIN, "tab_activated", "chess.com"),
      ev(29 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(toMinutes(bout.longestRunMs)).toBe(25);
  });

  it("picks the dominant domain by attended time, not by visit count", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "chess.com"),
      ev(1 * MIN, "tab_activated", "youtube.com"),
      ev(21 * MIN, "tab_activated", "chess.com"),
      ev(22 * MIN, "tab_activated", "youtube.com"),
      ev(23 * MIN, "tab_closed", "youtube.com"),
    ]);
    // chess visited twice, youtube holds 21 of 23 minutes.
    expect(bout.dominant).toBe(createDomain("youtube.com"));
  });
});

describe("bouts — audible dwell", () => {
  it("credits background-audible time separately from foreground dwell", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "zoom.us"),
      ev(1 * MIN, "audible_start", "zoom.us"),
      ev(2 * MIN, "focus_end"),
      ev(20 * MIN, "focus_start"),
      ev(21 * MIN, "audible_end", "zoom.us"),
      ev(22 * MIN, "tab_closed", "zoom.us"),
    ]);
    // 2 min foreground before focus_end, 2 min after focus_start
    expect(toMinutes(bout.dwellMs)).toBe(4);
    // 18 min background while audible (focus_end at 2 → focus_start at 20)
    expect(toMinutes(bout.audibleDwellMs)).toBe(18);
  });

  it("does not double-count foreground+audible time", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "zoom.us"),
      ev(0, "audible_start", "zoom.us"),
      ev(10 * MIN, "audible_end", "zoom.us"),
      ev(10 * MIN, "tab_closed", "zoom.us"),
    ]);
    // All foreground — audible but attending, so it goes to dwellMs
    expect(toMinutes(bout.dwellMs)).toBe(10);
    expect(toMinutes(bout.audibleDwellMs)).toBe(0);
  });

  it("does not credit audible time for a non-audible domain", () => {
    const [bout] = bouts([
      ev(0, "navigation_committed", "chess.com"),
      ev(0, "audible_start", "zoom.us"),
      ev(1 * MIN, "focus_end"),
      ev(20 * MIN, "focus_start"),
      ev(21 * MIN, "tab_closed", "chess.com"),
    ]);
    // chess.com is in flight but not audible — background time is void
    expect(toMinutes(bout.dwellMs)).toBe(2);
    expect(toMinutes(bout.audibleDwellMs)).toBe(0);
  });
});

describe("bouts — edges", () => {
  it("returns nothing for an empty stream", () => {
    expect(bouts([])).toEqual([]);
  });

  it("ignores events with no domain when none is yet in flight", () => {
    expect(bouts([ev(0, "writer_started"), ev(1 * MIN, "focus_start")])).toEqual([]);
  });
});
