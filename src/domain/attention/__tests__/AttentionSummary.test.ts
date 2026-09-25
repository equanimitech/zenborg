import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../ActivityEvent";
import {
  agentSessions,
  byArea,
  coverage,
  dwellRows,
} from "../AttentionSummary";

function ev(
  overrides: Partial<ActivityEvent> & { ts: number },
): ActivityEvent {
  return {
    id: `e-${overrides.ts}`,
    surface: "desktop",
    kind: "app_switched",
    sessionId: "",
    payload: {},
    ...overrides,
  };
}

const MINUTE = 60_000;
const resolve = (e: ActivityEvent) => {
  const app = e.payload.app_name;
  if (app === "Slack") return "area-work";
  if (app === "Firefox") return "area-browse";
  return undefined;
};

describe("dwellRows", () => {
  it("computes dwell from consecutive timestamps", () => {
    const events = [
      ev({ ts: 0, payload: { app_name: "Slack" } }),
      ev({ ts: 5 * MINUTE, payload: { app_name: "Firefox" } }),
      ev({ ts: 8 * MINUTE, payload: { app_name: "Slack" } }),
    ];
    const rows = dwellRows(events, "desktop", resolve, {
      capMs: 30 * MINUTE,
    });
    const slack = rows.find((r) => r.locator === "Slack")!;
    expect(slack.ms).toBe(5 * MINUTE);
    expect(slack.visits).toBe(2);
    expect(slack.areaId).toBe("area-work");

    const ff = rows.find((r) => r.locator === "Firefox")!;
    expect(ff.ms).toBe(3 * MINUTE);
    expect(ff.visits).toBe(1);
  });

  it("caps dwell at capMs", () => {
    const events = [
      ev({ ts: 0, payload: { app_name: "Slack" } }),
      ev({ ts: 60 * MINUTE, payload: { app_name: "Firefox" } }),
    ];
    const rows = dwellRows(events, "desktop", resolve, {
      capMs: 30 * MINUTE,
    });
    expect(rows[0].ms).toBe(30 * MINUTE);
  });

  it("last event gets zero dwell", () => {
    const events = [ev({ ts: 0, payload: { app_name: "Slack" } })];
    const rows = dwellRows(events, "desktop", resolve, {
      capMs: 30 * MINUTE,
    });
    expect(rows[0].ms).toBe(0);
    expect(rows[0].visits).toBe(1);
  });

  it("skips events from other surfaces", () => {
    const events = [
      ev({ ts: 0, surface: "agent", kind: "prompt", payload: { cwd: "/x" } }),
    ];
    const rows = dwellRows(events, "desktop", resolve, {
      capMs: 30 * MINUTE,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("dwellRows — browser", () => {
  const browserResolve = (e: ActivityEvent) => {
    const domain = e.payload.domain;
    if (domain === "zoom.us") return "area-meetings";
    if (domain === "github.com") return "area-code";
    return undefined;
  };

  it("skips non-boundary events between tab_activated pairs", () => {
    const events = [
      ev({ ts: 0, surface: "browser", kind: "tab_activated", payload: { domain: "zoom.us" } }),
      ev({ ts: 1, surface: "browser", kind: "focus_start", payload: {} }),
      ev({ ts: 60 * MINUTE, surface: "browser", kind: "tab_activated", payload: { domain: "github.com" } }),
    ];
    const rows = dwellRows(events, "browser", browserResolve, { capMs: 120 * MINUTE });
    const zoom = rows.find((r) => r.locator === "zoom.us")!;
    expect(zoom.ms).toBe(60 * MINUTE);
  });

  it("uses focus_end as a boundary for long single-tab sessions", () => {
    const events = [
      ev({ ts: 0, surface: "browser", kind: "tab_activated", payload: { domain: "zoom.us" } }),
      ev({ ts: 0, surface: "browser", kind: "focus_start", payload: {} }),
      ev({ ts: 60 * MINUTE, surface: "browser", kind: "focus_end", payload: {} }),
    ];
    const rows = dwellRows(events, "browser", browserResolve, { capMs: 120 * MINUTE });
    const zoom = rows.find((r) => r.locator === "zoom.us")!;
    expect(zoom.ms).toBe(60 * MINUTE);
    expect(zoom.visits).toBe(1);
  });

  it("uses idle_start as a boundary", () => {
    const events = [
      ev({ ts: 0, surface: "browser", kind: "tab_activated", payload: { domain: "zoom.us" } }),
      ev({ ts: 30 * MINUTE, surface: "browser", kind: "idle_start", payload: {} }),
    ];
    const rows = dwellRows(events, "browser", browserResolve, { capMs: 120 * MINUTE });
    expect(rows[0].ms).toBe(30 * MINUTE);
  });

  it("gives zero dwell when no boundary follows", () => {
    const events = [
      ev({ ts: 0, surface: "browser", kind: "tab_activated", payload: { domain: "zoom.us" } }),
      ev({ ts: 1, surface: "browser", kind: "focus_start", payload: {} }),
    ];
    const rows = dwellRows(events, "browser", browserResolve, { capMs: 120 * MINUTE });
    expect(rows[0].ms).toBe(0);
    expect(rows[0].visits).toBe(1);
  });
});

describe("dwellRows — browser video playback", () => {
  const SEC = 1000;
  const T0 = 1_790_181_564_000; // 2026-09-23 18:39:24, trimmed from the real log
  const TAB = "414246c0";
  let n = 0;
  const b = (
    s: number,
    kind: string,
    payload: Record<string, unknown> = {},
    id = `b-${n++}`,
  ) => ev({ id, ts: T0 + s * SEC, surface: "browser", kind, payload });
  const yt = (seconds: number) => ({ domain: "youtube.com", seconds });
  const resolveYt = (e: ActivityEvent) =>
    e.payload.domain === "youtube.com" ? "area-entertainment" : undefined;
  const cfg = { capMs: 120 * MINUTE };
  const ytRow = (events: ActivityEvent[]) =>
    dwellRows(events, "browser", resolveYt, cfg).find((r) => r.locator === "youtube.com");

  it("counts playback while the browser window has lost focus (real 18:39–18:49 shape)", () => {
    // One video watched on one tab while focus flicks to the terminal. Focus
    // spans alone give 11s + 114s; the video was playing for ~7 minutes.
    const events = [
      b(-9, "video_started", yt(0)),
      b(0, "tab_activated", { domain: "youtube.com", tab: TAB }),
      b(11, "focus_end"),
      b(26, "focus_start"),
      b(138, "focus_end"),
      b(141, "video_paused", yt(153)),
      b(150, "video_resumed", yt(154)),
      b(249, "video_paused", yt(250)),
      b(250, "focus_end"),
      b(316, "tab_activated", { domain: "web.whatsapp.com", tab: "7654df" }),
      b(317, "tab_activated", { domain: "youtube.com", tab: TAB }),
      b(318, "video_resumed", yt(250)),
      b(431, "focus_end"),
      b(432, "video_paused", yt(365)),
      b(512, "video_resumed", yt(365)),
      b(515, "focus_end"),
      b(587, "video_ended", yt(432)),
    ];
    // Playing: [-9,141] 150s · [150,246] 96s (position-capped) ·
    // [318,432] ∪ focus [317,431] = 115s · [512,579] 67s (position-capped).
    const row = ytRow(events)!;
    expect(row.ms).toBe(428 * SEC);
    expect(row.areaId).toBe("area-entertainment");
    expect(row.visits).toBe(2);
  });

  it("does not double count a focused tab that is also playing", () => {
    const events = [
      b(0, "tab_activated", { domain: "youtube.com", tab: TAB }),
      b(0, "video_started", yt(0)),
      b(600, "video_paused", yt(600)),
      b(600, "tab_activated", { domain: "github.com", tab: "gh" }),
    ];
    expect(ytRow(events)?.ms).toBe(600 * SEC);
  });

  it("ignores relay-duplicated events (same id)", () => {
    const events = [
      b(0, "video_started", yt(0), "v1"),
      b(0, "video_started", yt(0), "v1"),
      b(60, "video_paused", yt(60), "v2"),
      b(60, "video_paused", yt(60), "v2"),
      b(0, "tab_activated", { domain: "youtube.com", tab: TAB }, "t1"),
      b(0, "tab_activated", { domain: "youtube.com", tab: TAB }, "t1"),
      b(10, "focus_end", {}, "f1"),
    ];
    const row = ytRow(events)!;
    expect(row.ms).toBe(60 * SEC);
    expect(row.visits).toBe(1);
  });

  it("bounds a never-closed playing span at the next idle_start", () => {
    const events = [
      b(0, "video_started", yt(0)),
      b(10, "tab_activated", { domain: "github.com", tab: "gh" }),
      b(1200, "idle_start", { state: "idle" }),
      b(3000, "focus_start"),
    ];
    expect(ytRow(events)?.ms).toBe(1200 * SEC);
  });

  it("credits an orphan pause's position when two untagged tabs conflate (real 18:39 shape)", () => {
    // Tab B's ended closes tab A's span (same domain key); A's later pause at
    // 153s is orphaned but proves play since the previous close. An orphan
    // ended (detach, long after) proves nothing.
    const events = [
      b(0, "video_started", yt(0)), // tab A
      b(2, "video_started", yt(0)), // tab B, ignored: key already open
      b(9, "video_ended", yt(8)), // tab B finishes; closes the key at 9s
      b(150, "video_paused", yt(153)), // tab A: orphan, credits [9,150]
      b(900, "video_ended", yt(153)), // detach sweep: orphan, credits nothing
    ];
    expect(ytRow(events)?.ms).toBe((8 + 141) * SEC); // [0,8] position-capped + [9,150]
  });

  it("ends a tab-tagged playing span when its tab closes, and on screen lock", () => {
    const events = [
      b(0, "video_started", { ...yt(0), tab: "a" }),
      b(0, "video_started", { ...yt(0), tab: "b" }),
      b(30, "tab_closed", { domain: "youtube.com", tab: "a" }),
      b(90, "idle_start", { state: "locked" }),
      b(4000, "focus_start"),
    ];
    expect(ytRow(events)?.ms).toBe(90 * SEC);
  });
});

describe("byArea", () => {
  it("aggregates rows by area, excluding unmapped", () => {
    const rows = [
      { surface: "desktop" as const, locator: "Slack", areaId: "a", ms: 100, visits: 2 },
      { surface: "desktop" as const, locator: "Firefox", areaId: "a", ms: 50, visits: 1 },
      { surface: "desktop" as const, locator: "Calculator", ms: 30, visits: 1 },
    ];
    const areas = byArea(rows);
    expect(areas).toHaveLength(1);
    expect(areas[0].areaId).toBe("a");
    expect(areas[0].ms).toBe(150);
    expect(areas[0].visits).toBe(3);
  });
});

describe("agentSessions", () => {
  it("groups agent events by sessionId", () => {
    const events = [
      ev({
        ts: 100,
        surface: "agent",
        kind: "session_start",
        sessionId: "s1",
        payload: { cwd: "/repo" },
      }),
      ev({
        ts: 200,
        surface: "agent",
        kind: "prompt",
        sessionId: "s1",
        payload: { cwd: "/repo" },
      }),
      ev({
        ts: 500,
        surface: "agent",
        kind: "prompt",
        sessionId: "s1",
        payload: {},
      }),
      ev({
        ts: 300,
        surface: "agent",
        kind: "prompt",
        sessionId: "s2",
        payload: { cwd: "/other" },
      }),
    ];
    const sessions = agentSessions(events);
    expect(sessions).toHaveLength(2);

    const s1 = sessions.find((s) => s.sessionId === "s1")!;
    expect(s1.start).toBe(100);
    expect(s1.end).toBe(500);
    expect(s1.prompts).toBe(2);
    expect(s1.cwd).toBe("/repo");

    const s2 = sessions.find((s) => s.sessionId === "s2")!;
    expect(s2.prompts).toBe(1);
  });
});

describe("coverage", () => {
  it("reports first/last/count per surface", () => {
    const events = [
      ev({ ts: 100, surface: "desktop" }),
      ev({ ts: 200, surface: "desktop" }),
      ev({ ts: 150, surface: "agent", kind: "prompt", sessionId: "s1" }),
    ];
    const cov = coverage(events);
    const desktop = cov.find((c) => c.surface === "desktop")!;
    expect(desktop.first).toBe(100);
    expect(desktop.last).toBe(200);
    expect(desktop.events).toBe(2);

    const browser = cov.find((c) => c.surface === "browser")!;
    expect(browser.events).toBe(0);
    expect(browser.first).toBeUndefined();
  });
});
