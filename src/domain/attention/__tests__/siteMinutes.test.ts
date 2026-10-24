import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../browser/activity";
import { siteMinutes, siteSummary } from "../siteMinutes";

const at = (day: number, h: number, m: number) =>
  new Date(2026, 9, day, h, m).getTime();
let seq = 0;
const ev = (
  ts: number,
  kind: string,
  domain?: string,
  id = `e${seq++}`,
): ActivityEvent => ({
  id,
  surface: "browser",
  kind,
  ts,
  sessionId: "s",
  payload: domain ? { domain } : {},
});

describe("siteMinutes", () => {
  // Hand-computed. Each gap is credited to the domain in flight at its start,
  // only while focused and not idle, and a gap over 30 min ends the bout.
  const events = [
    ev(at(1, 10, 0), "navigation_committed", "youtube.com"),
    ev(at(1, 10, 10), "navigation_committed", "m.youtube.com"), // +10 yt
    ev(at(1, 10, 20), "focus_end"), // +10 yt (subdomain)
    ev(at(1, 10, 40), "focus_start"), // unfocused: +0
    ev(at(1, 10, 45), "tab_activated", "www.chess.com"), // +5 yt
    ev(at(1, 10, 57), "navigation_committed", "lichess.org"), // +12 chess
    ev(at(1, 11, 0), "idle_start"), // +3 lichess, not asked for
    ev(at(1, 12, 0), "idle_end"), // 60 min gap ends the bout
    ev(at(1, 12, 1), "navigation_committed", "youtube.com"),
    ev(at(1, 12, 5), "navigation_committed", "chess.com", "dup"), // +4 yt
    ev(at(1, 12, 5), "navigation_committed", "chess.com", "dup"), // relay double-write
    ev(at(1, 23, 50), "navigation_committed", "youtube.com"),
    ev(at(2, 0, 10), "navigation_committed", "example.com"), // +20 yt, on day 1 (bout start)
    ev(at(2, 9, 0), "writer_started"),
    ev(at(3, 9, 0), "navigation_committed", "youtube.com"), // outside range
    ev(at(3, 9, 10), "navigation_committed", "example.com"),
  ];

  const days = siteMinutes(events, {
    hosts: ["youtube.com", "www.chess.com"],
    from: at(1, 0, 0),
    to: at(3, 0, 0),
  });

  it("matches the hand-computed minutes, by bout start day", () => {
    expect(days).toEqual([
      { day: "2026-10-01", minutes: { "youtube.com": 49, "chess.com": 12 } },
      { day: "2026-10-02", minutes: { "youtube.com": 0, "chess.com": 0 } },
    ]);
  });

  it("summarises mean and median over tracked days", () => {
    expect(siteSummary(days, ["youtube.com", "chess.com"])).toEqual({
      "youtube.com": { mean: 24.5, median: 24.5 },
      "chess.com": { mean: 6, median: 6 },
    });
  });
});
