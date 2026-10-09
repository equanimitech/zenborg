/**
 * Clock changes, pinned to Europe/Paris: 2026-03-29 (CET → CEST) and
 * 2026-10-25 (CEST → CET), both at 02:00–03:00 on Sunday. That is before the
 * 04:00 roll, so the short or long waking day is the Saturday. A week must end
 * at the next Monday's 04:00 on the wall clock, never 7 × 24 h after it began.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../attention/ActivityEvent";
import { wakingDayWindow } from "../../attention/GardenClock";
import { readbackSpan, weekOf, weekReadback } from "../WeekReadback";

const HOUR = 3_600_000;
const previousTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/Paris";
});
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const at = (y: number, mo: number, d: number, h: number, m = 0) =>
  new Date(y, mo - 1, d, h, m).getTime();

describe("weeks across a clock change (Europe/Paris)", () => {
  it("is really running in Paris time", () => {
    expect(new Date(at(2026, 1, 15, 12)).getTimezoneOffset()).toBe(-60);
    expect(new Date(at(2026, 7, 15, 12)).getTimezoneOffset()).toBe(-120);
  });

  it("gives the autumn Saturday 25 hours and its week 169", () => {
    const saturday = wakingDayWindow("2026-10-24");
    expect(saturday.to - saturday.from).toBe(25 * HOUR);
    const week = weekOf("2026-10-25");
    expect(week).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    const span = {
      from: wakingDayWindow(week.from).from,
      to: wakingDayWindow(week.to).to,
    };
    expect(span.to - span.from).toBe(169 * HOUR);
    expect(new Date(span.to).getHours()).toBe(4); // Monday 04:00 CET, not 03:00
    expect(readbackSpan(week.from, week.to).to).toBe(span.to);
  });

  it("gives the spring Saturday 23 hours and its week 167", () => {
    const saturday = wakingDayWindow("2026-03-28");
    expect(saturday.to - saturday.from).toBe(23 * HOUR);
    const week = weekOf("2026-03-29");
    const span = {
      from: wakingDayWindow(week.from).from,
      to: wakingDayWindow(week.to).to,
    };
    expect(span.to - span.from).toBe(167 * HOUR);
    expect(new Date(span.to).getHours()).toBe(4); // Monday 04:00 CEST, not 05:00
  });

  it("keeps Sunday night in its week and Monday 04:30 out of it", () => {
    const ev = (ts: number, app: string): ActivityEvent => ({
      id: `${ts}`,
      surface: "desktop",
      kind: "app_switched",
      ts,
      sessionId: "",
      payload: { app_name: app },
    });
    const events = [
      ev(at(2026, 10, 26, 3, 30), "Late"), // still Sunday's waking day, in the week
      ev(at(2026, 10, 26, 3, 50), "Boundary"),
      ev(at(2026, 10, 26, 4, 30), "Monday"),
      ev(at(2026, 10, 26, 4, 40), "Boundary"),
    ];
    const r = weekReadback(
      {
        events,
        moments: [],
        habits: [],
        areas: [],
        phaseConfigs: [],
        now: new Date(at(2026, 11, 1, 12)),
      },
      "2026-10-19",
      "2026-10-25",
    );
    const screen = r.footprints.find((f) => f.surface === "screen");
    if (screen?.status !== "drawn") throw new Error("screen not drawn");
    expect(screen.thisWeek.unmapped.map((u) => u.locator)).toEqual(["Late"]);
  });
});
