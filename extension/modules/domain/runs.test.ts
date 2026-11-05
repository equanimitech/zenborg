import { describe, expect, it } from "vitest";
import { MIN_RUN_MS, RUN_GAP_MS, runs } from "./bouts.js";
import { createActivityEvent, type ActivityEvent } from "./activity.js";
import { createDomain, toMinutes } from "./value-objects.js";

const MIN = 60_000;
let seq = 0;

function ev(ts: number, kind: string, domain?: string): ActivityEvent {
  seq += 1;
  return createActivityEvent({
    id: `r${seq}`,
    surface: "browser",
    kind,
    ts,
    payload: domain === undefined ? {} : { domain },
  });
}

describe("runs — browser history, properly grouped", () => {
  it("collapses many events on one domain into a single entry", () => {
    // Fifty page loads on YouTube is one thing you did, not fifty.
    const events = [ev(0, "navigation_committed", "youtube.com")];
    for (let i = 1; i <= 20; i++) {
      events.push(ev(i * MIN, "navigation_committed", "youtube.com"));
    }
    const result = runs(events);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe(createDomain("youtube.com"));
    expect(toMinutes(result[0].dwellMs)).toBe(20);
  });

  it("splits when the domain changes", () => {
    const result = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(10 * MIN, "tab_activated", "chess.com"),
      ev(20 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(result.map((r) => r.domain)).toEqual([
      createDomain("youtube.com"),
      createDomain("chess.com"),
    ]);
  });

  it("splits the same domain across a long gap — two sittings, not one", () => {
    const result = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(2 * MIN, "tab_activated", "youtube.com"),
      // Away for longer than the run gap, then back.
      ev(2 * MIN + RUN_GAP_MS + MIN, "tab_activated", "youtube.com"),
      ev(2 * MIN + RUN_GAP_MS + 6 * MIN, "tab_closed", "youtube.com"),
    ]);
    expect(result).toHaveLength(2);
  });

  it("returns runs in chronological order, ready to render as history", () => {
    const result = runs([
      ev(0, "navigation_committed", "a.com"),
      ev(6 * MIN, "tab_activated", "b.com"),
      ev(12 * MIN, "tab_activated", "c.com"),
      ev(18 * MIN, "tab_closed", "c.com"),
    ]);
    const starts = result.map((r) => r.startTs);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
  });
});

describe("runs — gating matches bouts", () => {
  it("does not accumulate while attention is off", () => {
    const result = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(1 * MIN, "idle_start"),
      ev(3 * MIN, "idle_end"),
      ev(4 * MIN, "tab_closed", "youtube.com"),
    ]);
    // 1 min before idling, 1 min after returning. The idle span is void.
    expect(toMinutes(result[0].dwellMs)).toBe(2);
  });

  it("treats losing OS focus the same as going idle", () => {
    const result = runs([
      ev(0, "navigation_committed", "chess.com"),
      ev(2 * MIN, "focus_end"),
      ev(4 * MIN, "focus_start"),
      ev(5 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(toMinutes(result[0].dwellMs)).toBe(3);
  });
});

describe("runs — one sitting with detours, not ten entries", () => {
  it("merges a domain you left briefly and came back to", () => {
    // The chess.com case: ten fragments across 13:29–14:11 because he glanced
    // at other tabs. That is one session, not ten.
    const result = runs([
      ev(0, "navigation_committed", "chess.com"),
      ev(10 * MIN, "tab_activated", "google.com"),
      ev(11 * MIN, "tab_activated", "chess.com"),
      ev(20 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(result.filter((r) => r.domain === createDomain("chess.com"))).toHaveLength(1);
    expect(result[0].startTs).toBe(0);
    expect((result[0].endTs - result[0].startTs) / MIN).toBe(20);
  });

  it("counts only the domain's own time, not the detour", () => {
    // Span covers the excursion; dwell does not. Both facts stay available.
    const result = runs([
      ev(0, "navigation_committed", "chess.com"),
      ev(10 * MIN, "tab_activated", "google.com"),
      ev(11 * MIN, "tab_activated", "chess.com"),
      ev(20 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(result).toHaveLength(1);
    expect(toMinutes(result[0].dwellMs)).toBe(19);
    expect((result[0].endTs - result[0].startTs) / MIN).toBe(20);
  });

  it("lets a substantial excursion break the sitting", () => {
    // Above the threshold it is its own entry, so it is also a real interruption.
    const result = runs([
      ev(0, "navigation_committed", "chess.com"),
      ev(10 * MIN, "tab_activated", "google.com"),
      ev(15 * MIN, "tab_activated", "chess.com"),
      ev(25 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(result.map((r) => r.domain)).toEqual([
      createDomain("chess.com"),
      createDomain("google.com"),
      createDomain("chess.com"),
    ]);
  });

  it("does NOT merge across a long absence — that is two sittings", () => {
    const result = runs([
      ev(0, "navigation_committed", "chess.com"),
      ev(5 * MIN, "tab_activated", "google.com"),
      // Away well past the detour threshold before returning.
      ev(5 * MIN + 20 * MIN, "tab_activated", "chess.com"),
      ev(5 * MIN + 30 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(result.filter((r) => r.domain === createDomain("chess.com"))).toHaveLength(2);
  });

  it("keeps a genuinely different domain separate", () => {
    const result = runs([
      ev(0, "navigation_committed", "chess.com"),
      ev(10 * MIN, "tab_activated", "youtube.com"),
      ev(20 * MIN, "tab_closed", "youtube.com"),
    ]);
    expect(result.map((r) => r.domain)).toEqual([
      createDomain("chess.com"),
      createDomain("youtube.com"),
    ]);
  });
});

describe("runs — noise floor", () => {
  it("drops a tab touched in passing", () => {
    // Below MIN_RUN_MS: on the way somewhere else, not a thing you did.
    const result = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(5_000, "tab_activated", "chess.com"),
      ev(10 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(result.map((r) => r.domain)).toEqual([createDomain("chess.com")]);
    expect(toMinutes(result[0].dwellMs)).toBeCloseTo(10, 0);
  });

  it("keeps a run exactly at the floor", () => {
    const result = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(MIN_RUN_MS, "tab_closed", "youtube.com"),
    ]);
    expect(result).toHaveLength(1);
  });

  it("drops the detour itself while still merging around it", () => {
    const result = runs([
      ev(0, "navigation_committed", "chess.com"),
      ev(10 * MIN, "tab_activated", "google.com"),
      ev(10 * MIN + 20_000, "tab_activated", "chess.com"),
      ev(20 * MIN, "tab_closed", "chess.com"),
    ]);
    expect(result.map((r) => r.domain)).toEqual([createDomain("chess.com")]);
  });

  it("returns nothing for an empty stream", () => {
    expect(runs([])).toEqual([]);
  });
});

describe("runs — idle while playing", () => {
  it("counts an idle span when focused and the domain is audible", () => {
    const [r] = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(0, "audible_start", "youtube.com"),
      ev(0, "idle_start"),
      ev(10 * MIN, "idle_end"),
    ]);
    expect(toMinutes(r.dwellMs)).toBe(10);
  });

  it("does not count an idle span when the domain is silent", () => {
    expect(
      runs([
        ev(0, "navigation_committed", "youtube.com"),
        ev(0, "idle_start"),
        ev(10 * MIN, "idle_end"),
      ])
    ).toEqual([]);
  });

  it("sends audible time to audibleDwellMs when focus is lost", () => {
    const [r] = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(0, "audible_start", "youtube.com"),
      ev(0, "idle_start"),
      ev(0, "focus_end"),
      ev(10 * MIN, "focus_start"),
    ]);
    expect(toMinutes(r.dwellMs)).toBe(0);
    expect(toMinutes(r.audibleDwellMs)).toBe(10);
  });

  it("counts an idle span while a muted video plays", () => {
    const [r] = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(0, "video_started", "youtube.com"),
      ev(0, "idle_start"),
      ev(10 * MIN, "idle_end"),
    ]);
    expect(toMinutes(r.dwellMs)).toBe(10);
  });

  it("does not let a video event for another domain move current", () => {
    const [r] = runs([
      ev(0, "navigation_committed", "youtube.com"),
      ev(0, "video_started", "vimeo.com"),
      ev(10 * MIN, "tab_closed", "youtube.com"),
    ]);
    expect(r.domain).toBe(createDomain("youtube.com"));
    expect(toMinutes(r.dwellMs)).toBe(10);
  });
});
