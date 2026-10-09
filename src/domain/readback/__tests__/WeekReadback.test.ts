import { describe, expect, it } from "vitest";
import type {
  ActivityEvent,
  ActivitySurface,
} from "../../attention/ActivityEvent";
import type { Area } from "../../entities/Area";
import type { Habit } from "../../entities/Habit";
import type { Moment } from "../../entities/Moment";
import { Attitude } from "../../value-objects/Attitude";
import {
  DEFAULT_PHASE_CONFIGS,
  Phase,
  type PhaseConfig,
} from "../../value-objects/Phase";
import {
  previousWindow,
  type ReadbackInput,
  readbackSpan,
  weekOf,
  weekReadback,
} from "../WeekReadback";

const MIN = 60_000;
const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
};

let seq = 0;
const ev = (
  surface: ActivitySurface,
  kind: string,
  ts: number,
  payload: Record<string, unknown> = {},
  extra: Partial<ActivityEvent> = {},
): ActivityEvent => ({
  id: `e${seq++}`,
  surface,
  kind,
  ts,
  sessionId: "s",
  payload,
  ...extra,
});

const stamp = {
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const area = (
  id: string,
  name: string,
  order: number,
  surfaces?: Area["surfaces"],
): Area => ({
  id,
  name,
  attitude: null,
  tags: [],
  color: "#000",
  emoji: "",
  isDefault: false,
  order,
  ...(surfaces ? { surfaces } : {}),
  ...stamp,
});

const AREAS = [
  area("themia", "Themia", 0, { apps: ["Slack"], paths: ["/code/themia"] }),
  area("ent", "Entertainment", 1, {
    hosts: ["youtube.com"],
    apps: ["Stremio"],
  }),
  area("wellness", "Wellness", 2),
];

const habit = (
  id: string,
  name: string,
  areaId: string,
  over: Partial<Habit> = {},
): Habit =>
  ({
    id,
    name,
    areaId,
    attitude: Attitude.KEEPING,
    rhythm: { period: "weekly", count: 1 },
    phase: null,
    tags: [],
    emoji: null,
    isArchived: false,
    order: 0,
    ...stamp,
    ...over,
  }) as Habit;

const HABITS = [
  habit("run", "Run", "wellness"),
  habit("sit", "Sit", "wellness"), // last tended a month ago: wilting
  habit("ship", "Ship", "themia", { attitude: Attitude.BEING }),
];

const moment = (
  id: string,
  areaId: string,
  day: string,
  phase: Phase,
  over: Partial<Moment> = {},
): Moment =>
  ({
    id,
    name: id,
    areaId,
    habitId: null,
    cycleId: null,
    cyclePlanId: null,
    phase,
    day,
    order: 0,
    tags: null,
    ...stamp,
    ...over,
  }) as Moment;

const PHASES: PhaseConfig[] = DEFAULT_PHASE_CONFIGS.map((c, i) => ({
  ...c,
  id: `pc${i}`,
  ...stamp,
}));

// The week of Thursday 2026-10-08: Monday 05 → Sunday 11. Last week: 09-28 → 10-04.
const WEEK = weekOf("2026-10-08");

function fixture(): ReadbackInput {
  const events: ActivityEvent[] = [
    // Screen, this week: 20 min Slack, then Brave in front for 40 min while the
    // browser resolves youtube.com, then idle.
    ev("desktop", "app_switched", at("2026-10-06", 10, 0), {
      app_name: "Slack",
    }),
    ev("desktop", "app_switched", at("2026-10-06", 10, 20), {
      app_name: "Brave Browser",
    }),
    ev("browser", "tab_activated", at("2026-10-06", 10, 20), {
      domain: "youtube.com",
    }),
    ev("browser", "focus_end", at("2026-10-06", 11, 0), {}),
    ev("desktop", "idle_start", at("2026-10-06", 11, 0), {
      thresholdMs: 120_000,
    }),
    // An unmapped app, 10 min.
    ev("desktop", "app_switched", at("2026-10-07", 9, 0), {
      app_name: "Voice Memos",
    }),
    ev("desktop", "app_switched", at("2026-10-07", 9, 10), {
      app_name: "Slack",
    }),
    ev("desktop", "idle_start", at("2026-10-07", 9, 15), {
      thresholdMs: 120_000,
    }),
    // Sunday 03:30 still belongs to this week; Monday 03:30 to last.
    ev("desktop", "app_switched", at("2026-10-12", 3, 30), {
      app_name: "Stremio",
    }),
    ev("desktop", "idle_start", at("2026-10-12", 3, 50), {
      thresholdMs: 120_000,
    }),
    ev("desktop", "app_switched", at("2026-10-05", 3, 30), {
      app_name: "Stremio",
    }),
    ev("desktop", "idle_start", at("2026-10-05", 3, 45), {
      thresholdMs: 120_000,
    }),
    // Work, this week: two prompts 3 min apart in a mapped repo. Only human
    // events bound a prompt, so the last prompt of a run adds nothing.
    ev("agent", "prompt", at("2026-10-08", 14, 0), {
      cwd: "/code/themia/leggia",
    }),
    ev("agent", "prompt", at("2026-10-08", 14, 3), {
      cwd: "/code/themia/leggia",
    }),
    ev("agent", "turn_stop", at("2026-10-08", 14, 6), {
      cwd: "/code/themia/leggia",
    }),
    // Body, this week: a 30-min run mapped to the Run habit.
    ev(
      "garmin",
      "workout_completed",
      at("2026-10-09", 7, 0),
      { activityType: "running" },
      { durationMs: 30 * MIN },
    ),
  ];
  const moments: Moment[] = [
    moment("standup", "themia", "2026-10-06", Phase.MORNING, { order: 1 }),
    moment("review", "themia", "2026-10-06", Phase.MORNING, { order: 0 }),
    moment("run", "wellness", "2026-10-09", Phase.MORNING, { habitId: "run" }),
    moment("sit", "wellness", "2026-09-01", Phase.MORNING, { habitId: "sit" }),
    moment("film", "ent", "2026-10-03", Phase.EVENING),
    moment("proposal", "themia", "2026-10-07", Phase.EVENING, {
      status: "tentative",
    }),
  ];
  return {
    events,
    moments,
    habits: HABITS,
    areas: AREAS,
    phaseConfigs: PHASES,
    garminHabitMap: {
      version: 1,
      mappings: { running: { habitId: "run", habitName: "Run" } },
      pending: {},
    },
    now: new Date(at("2026-10-12", 12)),
  };
}

const read = () => weekReadback(fixture(), WEEK.from, WEEK.to);

describe("weekOf", () => {
  it("is Monday → Sunday, whatever day it is given", () => {
    expect(weekOf("2026-10-05")).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
    expect(weekOf("2026-10-11")).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
    expect(previousWindow("2026-10-05", "2026-10-11")).toEqual({
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });

  it("reads the log from last Monday 04:00 to next Monday 04:00", () => {
    expect(readbackSpan(WEEK.from, WEEK.to)).toEqual({
      from: at("2026-09-28", 4),
      to: at("2026-10-12", 4),
    });
  });
});

describe("weekReadback", () => {
  it("lays the board out per day and phase, in order, without tentative moments", () => {
    const r = read();
    expect(r.board.map((d) => d.day)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    const tue = r.board[1];
    expect(tue.phases).toHaveLength(1);
    expect(tue.phases[0].phase).toBe("MORNING");
    expect(tue.phases[0].moments.map((m) => m.name)).toEqual([
      "review",
      "standup",
    ]);
    expect(r.board[2].phases).toEqual([]); // the tentative proposal is not planted
  });

  it("marks a moment untraceable when no surface could see it, never missed", () => {
    const r = read();
    const run = r.board[4].phases[0].moments[0];
    expect(run.traceable).toBe(true); // Wellness has no surfaces, but the watch maps the habit
    const sit = weekReadback(
      { ...fixture(), garminHabitMap: undefined },
      WEEK.from,
      WEEK.to,
    ).board[4].phases[0].moments[0];
    expect(sit.traceable).toBe(false);
    expect(r.board[1].phases[0].moments[0].traceable).toBe(true);
  });

  it("counts planted moments per area, this week and last week, as two numbers", () => {
    expect(read().planted).toEqual([
      { areaId: "themia", areaName: "Themia", thisWeek: 2, lastWeek: 0 },
      { areaId: "ent", areaName: "Entertainment", thisWeek: 0, lastWeek: 1 },
      { areaId: "wellness", areaName: "Wellness", thisWeek: 1, lastWeek: 0 },
    ]);
  });

  it("reads five surfaces; journal and comms are not drawn, not zero", () => {
    const r = read();
    expect(r.footprints.map((f) => [f.surface, f.status])).toEqual([
      ["body", "drawn"],
      ["screen", "drawn"],
      ["work", "drawn"],
      ["journal", "not drawn"],
      ["comms", "not drawn"],
    ]);
    expect(r.footprints[3]).toEqual({
      surface: "journal",
      status: "not drawn",
    });
  });

  it("merges desktop and browser into screen without counting the browser app as unmapped", () => {
    const screen = read().footprints.find((f) => f.surface === "screen");
    if (screen?.status !== "drawn") throw new Error("screen not drawn");
    expect(screen.thisWeek.byArea).toEqual([
      { areaId: "ent", areaName: "Entertainment", minutes: 60 }, // 40 youtube + Sunday-night 20 Stremio
      { areaId: "themia", areaName: "Themia", minutes: 25 },
    ]);
    expect(screen.thisWeek.unmapped).toEqual([
      { locator: "Voice Memos", minutes: 10 },
    ]);
    expect(screen.thisWeek.coverage).toEqual({
      seenHours: 4,
      idleCreditedMin: 0,
      unmappedMin: 10,
    });
    // Monday 03:30 is last week's Sunday night.
    expect(screen.lastWeek.byArea).toEqual([
      { areaId: "ent", areaName: "Entertainment", minutes: 15 },
    ]);
  });

  it("reads work from agent prompts and body from mapped workouts", () => {
    const r = read();
    const work = r.footprints.find((f) => f.surface === "work");
    const body = r.footprints.find((f) => f.surface === "body");
    if (work?.status !== "drawn" || body?.status !== "drawn")
      throw new Error("not drawn");
    expect(work.thisWeek.byArea).toEqual([
      { areaId: "themia", areaName: "Themia", minutes: 3 },
    ]);
    expect(body.thisWeek.byArea).toEqual([
      { areaId: "wellness", areaName: "Wellness", minutes: 30 },
    ]);
    expect(body.lastWeek.coverage).toEqual({
      seenHours: 0,
      idleCreditedMin: 0,
      unmappedMin: 0,
    });
  });

  it("lists habits wilting at the window's close", () => {
    expect(read().wilting).toEqual([
      { habitId: "sit", name: "Sit", areaId: "wellness", areaName: "Wellness" },
    ]);
  });

  it("carries no ratio, share, percentage or direction anywhere", () => {
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, inner] of Object.entries(v)) {
          keys.push(k);
          walk(inner);
        }
    };
    walk(read());
    expect(
      keys.filter((k) =>
        /ratio|share|percent|pct|rate|delta|trend|change|score/i.test(k),
      ),
    ).toEqual([]);
  });
});
