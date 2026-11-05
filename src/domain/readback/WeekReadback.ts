/**
 * The week reads back — what was planted next to the footprints each surface
 * left, and how much of the week each surface could see.
 *
 * One pure function, read by the app and by the MCP `get_footprints` tool, so
 * the two cannot disagree. No I/O: callers read the vault and the
 * activity log and pass them in.
 *
 * Information, never score (docs/principles.md). Planted and footprints sit
 * side by side in minutes and counts; this week and last week are two plain
 * numbers. No field here is a ratio, a percentage, or a direction. Reading the
 * gap between plan and footprints is the gardener's job, not this function's.
 */
import type {
  ActivityEvent,
  ActivitySurface,
} from "../attention/ActivityEvent.ts";
import {
  type DwellSpans,
  dwellSpans,
  type Interval,
  unionMs,
} from "../attention/AttentionSummary.ts";
import {
  boundariesIn,
  cellWindow,
  localDate,
  wakingDayWindow,
} from "../attention/GardenClock.ts";
import { deriveSpans } from "../attention/SpanDerivation.ts";
import { indexSurfaces, resolveArea } from "../attention/SurfaceIndex.ts";
import type { Area } from "../entities/Area.ts";
import type { Cycle } from "../entities/Cycle.ts";
import type { CyclePlan } from "../entities/CyclePlan.ts";
import type { Habit } from "../entities/Habit.ts";
import { countsAsAllocation, type Moment } from "../entities/Moment.ts";
import { workoutsOf } from "../garmin/BodyLog.ts";
import type { GarminHabitMap } from "../garmin/GarminHabitMap.ts";
import {
  type HealthMoment,
  type HealthSubject,
  habitHealthService,
} from "../services/HabitHealthService.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The surfaces a gardener reads, as opposed to the log's sensor surfaces.
 * Each one draws from zero or more sensor surfaces; zero means no spring
 * feeds it yet, and it reads "not drawn" rather than zero.
 */
export type ReadingSurface = "body" | "screen" | "work" | "journal" | "comms";

export const READING_SOURCES: Readonly<
  Record<ReadingSurface, readonly ActivitySurface[]>
> = {
  body: ["garmin"],
  screen: ["desktop", "browser"],
  work: ["agent", "git", "linear"],
  journal: [],
  comms: [],
};

export const READING_SURFACES = Object.keys(
  READING_SOURCES,
) as ReadingSurface[];

/** Every sensor surface the readback draws on; read the log for these. */
export const READBACK_LOG_SURFACES: readonly ActivitySurface[] = [
  ...new Set(Object.values(READING_SOURCES).flat()),
];

/**
 * Dwell caps per sensor surface. A desktop span closes at the next event,
 * including `idle_start` (120 s without input), so a film watched without
 * input ends at idle until the daemon credits it (pitch slice 4).
 */
const CAP_MS: Readonly<Partial<Record<ActivitySurface, number>>> = {
  desktop: 30 * MINUTE,
  agent: 5 * MINUTE,
  browser: 120 * MINUTE, // focus_end/idle_start give real boundaries; cap is a fallback
};

const UNMAPPED_SHOWN = 10;

/**
 * Springs whose lines are day tallies or timestamps, not spans. They are
 * counted, never turned into minutes, and never set against anything.
 */
export type CountedSource = "git" | "linear";

export const COUNT_UNITS: Readonly<Record<CountedSource, string>> = {
  git: "commits",
  linear: "issues moved",
};

/** One counted spring over a window. No line in the window reads "not drawn", not zero. */
export type CountReading =
  | {
      readonly source: CountedSource;
      readonly unit: string;
      readonly status: "not drawn";
    }
  | {
      readonly source: CountedSource;
      readonly unit: string;
      readonly status: "drawn";
      readonly total: number;
      readonly byArea: readonly {
        areaId: string;
        areaName: string;
        count: number;
      }[];
    };

/** How much of the window a surface could see. Plain counts, never a share. */
export interface Coverage {
  /**
   * Hours the surface actually observed: the union of every span it traced
   * (mapped or not), to one decimal. It can never be smaller than the minutes
   * reported beside it.
   */
  readonly seenHours: number;
  /** Minutes credited through idle (a player holding the display awake). 0 until the daemon reports it. */
  readonly idleCreditedMin: number;
  /** Minutes the surface saw that resolve to no area. */
  readonly unmappedMin: number;
}

export interface Footprint {
  readonly byArea: readonly {
    areaId: string;
    areaName: string;
    minutes: number;
  }[];
  /** The largest unmapped locators (app, host, cwd, activity type). The full total is `coverage.unmappedMin`. */
  readonly unmapped: readonly { locator: string; minutes: number }[];
  readonly coverage: Coverage;
  /** Counted springs on this surface (work: commits, issues moved). Counts, never minutes. */
  readonly counts?: readonly CountReading[];
}

export type SurfaceReading =
  | { readonly surface: ReadingSurface; readonly status: "not drawn" }
  | {
      readonly surface: ReadingSurface;
      readonly status: "drawn";
      readonly thisWeek: Footprint;
      readonly lastWeek: Footprint;
    };

export interface BoardMoment {
  readonly id: string;
  readonly name: string;
  readonly areaId: string;
  readonly habitId?: string;
  /**
   * False when no surface could ever see this moment: its area declares no
   * paths, hosts or apps and no watch activity maps to its habit. Untraceable
   * is not missed.
   */
  readonly traceable: boolean;
}

export interface BoardDay {
  readonly day: string;
  readonly phases: readonly {
    phase: string;
    moments: readonly BoardMoment[];
  }[];
}

/** One planted moment against its cell: what the surfaces saw there. */
export interface TracedMoment {
  readonly momentId: string;
  readonly name: string;
  readonly areaId: string;
  readonly areaName: string;
  readonly phase: string;
  /** The moment's own clock time, when it was planted with one. */
  readonly window?: { readonly start: string; readonly end: string };
  /** Minutes in the cell on the moment's area, per sensor surface. */
  readonly traced: readonly { surface: string; minutes: number }[];
  /** Minutes in the same cell on other areas. */
  readonly elsewhere: readonly {
    surface: string;
    areaName: string;
    minutes: number;
  }[];
  readonly evidence: "traced" | "untraced";
}

/**
 * One day, phase by phase: what `get_day_trace` returned. `unplanted` is
 * attention in a phase that planted nothing for that area.
 *
 * Minutes here are spans (`deriveSpans`: one run of a person's events, cut at
 * the plan's boundaries), so a day's trace need not add up to the dwell minutes
 * in `footprints`. A span ends at its last event: a film that starts and then
 * produces no input is dwell minutes and no trace.
 */
export interface DayTrace {
  readonly day: string;
  readonly moments: readonly TracedMoment[];
  readonly unplanted: readonly {
    phase: string;
    areaName: string;
    surface: string;
    minutes: number;
  }[];
}

export interface WeekReadback {
  readonly window: { readonly from: string; readonly to: string };
  readonly lastWindow: { readonly from: string; readonly to: string };
  readonly board: readonly BoardDay[];
  /** Planted moments per area, this window and the one before. Two counts, no comparison. */
  readonly planted: readonly {
    areaId: string;
    areaName: string;
    thisWeek: number;
    lastWeek: number;
  }[];
  readonly footprints: readonly SurfaceReading[];
  /** Every day of the window that has started, in order. */
  readonly trace: readonly DayTrace[];
  /** Habits wilting at the window's close (or now, if the window is still open). */
  readonly wilting: readonly {
    habitId: string;
    name: string;
    areaId: string;
    areaName: string;
  }[];
}

/*
 * What the readback reads off each record. Narrow on purpose: the vault's
 * records (MCP) and the store's (app) both fit without a cast, and a field
 * renamed in either fails to compile here.
 */
export type ReadbackMoment = Pick<
  Moment,
  "id" | "name" | "areaId" | "order" | "startTime" | "durationMin"
> &
  HealthMoment & { readonly phase: string | null };
export type ReadbackHabit = Pick<Habit, "name" | "areaId" | "isArchived"> &
  HealthSubject;
export type ReadbackArea = Pick<Area, "id" | "name" | "order" | "surfaces">;
export type ReadbackPhaseConfig = {
  readonly phase: string;
  readonly order: number;
  readonly startHour: number;
  readonly endHour: number;
};
export type ReadbackCycle = Pick<Cycle, "id" | "startDate" | "endDate">;
export type ReadbackCyclePlan = Pick<
  CyclePlan,
  "habitId" | "cycleId" | "rhythmOverride"
>;

export interface ReadbackInput {
  /** Activity events covering both `readbackSpan(from, to)` windows. Extra events are ignored. */
  readonly events: readonly ActivityEvent[];
  readonly moments: readonly ReadbackMoment[];
  readonly habits: readonly ReadbackHabit[];
  readonly areas: readonly ReadbackArea[];
  readonly phaseConfigs: readonly ReadbackPhaseConfig[];
  readonly cycles?: readonly ReadbackCycle[];
  readonly cyclePlans?: readonly ReadbackCyclePlan[];
  readonly garminHabitMap?: GarminHabitMap;
  readonly now: Date;
}

// ── Windows ────────────────────────────────────────────────────────────────

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return localDate(d.getTime());
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday → Sunday holding `day`. */
export function weekOf(day: string): { from: string; to: string } {
  const offset = (parseDay(day).getDay() + 6) % 7; // Monday = 0
  const from = addDays(day, -offset);
  return { from, to: addDays(from, 6) };
}

/** The window of equal length that ends the day before `from`. */
export function previousWindow(
  from: string,
  to: string,
): { from: string; to: string } {
  const n = daysBetween(from, to).length;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** Epoch-ms `[from, to)` covering the previous window and this one — what to read from the log. */
export function readbackSpan(
  from: string,
  to: string,
): { from: number; to: number } {
  return {
    from: wakingDayWindow(previousWindow(from, to).from).from,
    to: wakingDayWindow(to).to,
  };
}

// ── Footprints ─────────────────────────────────────────────────────────────

const toMin = (ms: number) => Math.round(ms / MINUTE);

function clip(
  spans: readonly Interval[],
  from: number,
  to: number,
): Interval[] {
  return spans
    .map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as const)
    .filter(([s, e]) => e > s);
}

interface Located {
  readonly locator: string;
  readonly areaId?: string;
  readonly ms: number;
}

/** One surface's rows, and every span it observed (the ground for `seenHours`). */
interface Reading {
  readonly rows: readonly Located[];
  readonly observed: readonly Interval[];
  readonly counts?: readonly CountReading[];
}

function footprintOf(
  { rows, observed, counts }: Reading,
  areaName: (id: string) => string,
  areaOrder: (id: string) => number,
): Footprint {
  const byArea = new Map<string, number>();
  const unmapped = new Map<string, number>();
  for (const row of rows) {
    if (row.areaId === undefined)
      unmapped.set(row.locator, (unmapped.get(row.locator) ?? 0) + row.ms);
    else byArea.set(row.areaId, (byArea.get(row.areaId) ?? 0) + row.ms);
  }
  return {
    byArea: [...byArea.entries()]
      .map(([areaId, ms]) => ({
        areaId,
        areaName: areaName(areaId),
        minutes: toMin(ms),
      }))
      .filter((a) => a.minutes > 0)
      // The gardener's own area order. Sorting by minutes would read as a ranking.
      .sort((a, b) => areaOrder(a.areaId) - areaOrder(b.areaId)),
    unmapped: [...unmapped.entries()]
      .map(([locator, ms]) => ({ locator, minutes: toMin(ms) }))
      .filter((r) => r.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, UNMAPPED_SHOWN),
    coverage: {
      seenHours: Math.round((unionMs(observed) / HOUR) * 10) / 10,
      idleCreditedMin: 0,
      unmappedMin: toMin(
        [...unmapped.values()].reduce((sum, ms) => sum + ms, 0),
      ),
    },
    ...(counts ? { counts } : {}),
  };
}

type Resolver = (e: ActivityEvent) => string | undefined;

interface ReadContext {
  readonly events: readonly ActivityEvent[];
  readonly resolve: Resolver;
  readonly from: number;
  readonly to: number;
  readonly habitArea: (habitId: string) => string | undefined;
  readonly areaName: (areaId: string) => string;
  readonly garminHabitMap?: GarminHabitMap;
}

function spansOf(
  { events, resolve, from, to }: ReadContext,
  surface: ActivitySurface,
): DwellSpans[] {
  return dwellSpans(events, surface, resolve, {
    capMs: CAP_MS[surface] ?? 30 * MINUTE,
  }).map((r) => ({ ...r, spans: clip(r.spans, from, to) }));
}

/**
 * Desktop and browser together. Per area, the union of both surfaces' spans.
 * An unmapped app counts only where no browser span covers it: "Brave
 * Browser" in front while the browser surface resolved the tab is not
 * unmapped time, it is the browser's.
 */
function readScreen(ctx: ReadContext): Reading {
  const desktop = spansOf(ctx, "desktop");
  const browser = spansOf(ctx, "browser");
  const browserCover = browser.flatMap((r) => r.spans);

  const areaSpans = new Map<string, Interval[]>();
  const rows: Located[] = [];
  for (const row of [...desktop, ...browser]) {
    if (row.areaId !== undefined) {
      areaSpans.set(row.areaId, [
        ...(areaSpans.get(row.areaId) ?? []),
        ...row.spans,
      ]);
    } else if (row.surface === "browser") {
      rows.push({ locator: row.locator, ms: unionMs(row.spans) });
    } else {
      // |A \ B| = |A ∪ B| − |B|
      const ms =
        unionMs([...row.spans, ...browserCover]) - unionMs(browserCover);
      rows.push({ locator: row.locator, ms });
    }
  }
  for (const [areaId, spans] of areaSpans) {
    rows.push({ locator: areaId, areaId, ms: unionMs(spans) });
  }
  return {
    rows,
    observed: [...desktop, ...browser].flatMap((r) => r.spans),
  };
}

/**
 * What one event adds to its spring's count, and under which key. Commits
 * sum; an issue counts once however many times it moved.
 */
const COUNT_KEY: Readonly<
  Record<CountedSource, (e: ActivityEvent) => { key: string; n: number }>
> = {
  git: (e) => ({
    key: e.id,
    n: typeof e.payload.commits === "number" ? e.payload.commits : 0,
  }),
  linear: (e) => ({ key: String(e.payload.issue), n: 1 }),
};

function countOf(
  { events, resolve, areaName }: ReadContext,
  source: CountedSource,
): CountReading {
  const unit = COUNT_UNITS[source];
  const mine = events.filter((e) => e.surface === source);
  if (mine.length === 0) return { source, unit, status: "not drawn" };
  const all = new Map<string, number>();
  const perArea = new Map<string, Map<string, number>>();
  for (const e of mine) {
    const { key, n } = COUNT_KEY[source](e);
    all.set(key, n);
    const areaId = resolve(e);
    if (areaId === undefined) continue;
    const keys = perArea.get(areaId) ?? new Map<string, number>();
    keys.set(key, n);
    perArea.set(areaId, keys);
  }
  const sum = (m: Map<string, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);
  return {
    source,
    unit,
    status: "drawn",
    total: sum(all),
    byArea: [...perArea.entries()]
      .map(([areaId, keys]) => ({
        areaId,
        areaName: areaName(areaId),
        count: sum(keys),
      }))
      .filter((a) => a.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Agent prompts as minutes; git and Linear as counts beside them. A commit
 * tally or a state change has no span, so it never becomes minutes and never
 * counts as seen time.
 */
function readWork(ctx: ReadContext): Reading {
  const agent = spansOf(ctx, "agent");
  return {
    rows: agent.map((r) => ({
      locator: r.locator,
      ...(r.areaId !== undefined ? { areaId: r.areaId } : {}),
      ms: unionMs(r.spans),
    })),
    observed: agent.flatMap((r) => r.spans),
    counts: [countOf(ctx, "git"), countOf(ctx, "linear")],
  };
}

/**
 * Workouts only. Sleep is not attention placed in an area, so it is neither a
 * footprint nor counted as seen here; `get_body` reads it back on its own.
 * The watch's all-day samples are not observed spans either.
 */
function readBody({
  events,
  habitArea,
  garminHabitMap,
  from,
  to,
}: ReadContext): Reading {
  const workouts = workoutsOf(events, garminHabitMap);
  return {
    rows: workouts.map((w) => {
      const areaId = w.habitId !== undefined ? habitArea(w.habitId) : undefined;
      return {
        locator: w.activityType,
        ...(areaId !== undefined ? { areaId } : {}),
        ms: w.elapsedMs,
      };
    }),
    observed: clip(
      workouts.map((w) => [w.start, w.start + w.elapsedMs] as const),
      from,
      to,
    ),
  };
}

const NOTHING: Reading = { rows: [], observed: [] };

/**
 * How each reading surface is read. A record, not a chain of ternaries, so a
 * surface added later must name its reader, and journal and comms can never
 * fall through into the Garmin parser.
 */
const READERS: Readonly<Record<ReadingSurface, (ctx: ReadContext) => Reading>> =
  {
    body: readBody,
    screen: readScreen,
    work: readWork,
    journal: () => NOTHING,
    comms: () => NOTHING,
  };

// ── Day trace ──────────────────────────────────────────────────────────────

const TRACE_SURFACES: readonly ActivitySurface[] = [
  ...READING_SOURCES.screen,
  ...READING_SOURCES.work,
];

/** Silence that ends a span. */
const TRACE_IDLE_GAP_MS = 15 * MINUTE;

interface TracePiece {
  readonly areaId: string;
  readonly surface: string;
  readonly ms: number;
}

/** Pieces summed per (surface, area), in the order they were first seen. */
function tally(pieces: readonly TracePiece[]): TracePiece[] {
  const acc = new Map<string, TracePiece>();
  for (const p of pieces) {
    const key = `${p.surface}:${p.areaId}`;
    acc.set(key, { ...p, ms: p.ms + (acc.get(key)?.ms ?? 0) });
  }
  return [...acc.values()];
}

function clockWindow(startTime: string, durationMin = 0) {
  const [h, m] = startTime.split(":").map(Number);
  const end = h * 60 + m + durationMin;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    start: startTime,
    end: `${p(Math.floor(end / 60) % 24)}:${p(end % 60)}`,
  };
}

interface TraceContext {
  readonly input: ReadbackInput;
  readonly phases: readonly ReadbackPhaseConfig[];
  readonly resolve: Resolver;
  readonly areaName: (id: string) => string;
  readonly areaOrder: (id: string) => number;
  readonly plantedIn: (day: string, phase: string) => ReadbackMoment[];
}

/*
 * ponytail: spans here, dwell in `footprints`, as `get_day_trace` and
 * `get_attention` did before them, so the two can disagree on one day. Move
 * this onto dwell spans when the dwell methods are reconciled; the minutes will
 * change, and sunrise reads them.
 */
function traceDay(day: string, ctx: TraceContext): DayTrace {
  const { input, phases, resolve, areaName, areaOrder, plantedIn } = ctx;
  const { from, to } = wakingDayWindow(day);
  const events = input.events.filter(
    (e) => e.ts >= from && e.ts < to && TRACE_SURFACES.includes(e.surface),
  );
  const surfaceOf = new Map(events.map((e) => [e.id, e.surface]));
  const spans = deriveSpans(events, resolve, {
    idleGapMs: TRACE_IDLE_GAP_MS,
    boundaries: boundariesIn(from, to, input.moments, phases),
  });

  const cells = phases.flatMap(({ phase }) => {
    const cell = cellWindow(day, phase, phases);
    if (cell === null) return [];
    const pieces = spans.flatMap((span): TracePiece[] => {
      const ms = Math.min(span.end, cell.to) - Math.max(span.start, cell.from);
      if (ms <= 0) return [];
      // A span can cross surfaces; it is credited to the one that opened it.
      const surface = surfaceOf.get(span.sourceEventIds[0]) ?? "agent";
      return [{ areaId: span.areaId, surface, ms }];
    });
    return [{ phase, pieces, planted: plantedIn(day, phase) }];
  });

  const moments = cells.flatMap(({ phase, pieces, planted }) =>
    planted.map((m): TracedMoment => {
      const traced = tally(pieces.filter((p) => p.areaId === m.areaId));
      return {
        momentId: m.id,
        name: m.name,
        areaId: m.areaId,
        areaName: areaName(m.areaId),
        phase,
        ...(m.startTime
          ? { window: clockWindow(m.startTime, m.durationMin) }
          : {}),
        traced: traced
          .map(({ surface, ms }) => ({ surface, minutes: toMin(ms) }))
          .filter((t) => t.minutes > 0),
        elsewhere: tally(pieces.filter((p) => p.areaId !== m.areaId))
          .map(({ surface, areaId, ms }) => ({
            surface,
            areaName: areaName(areaId),
            minutes: toMin(ms),
          }))
          .filter((e) => e.minutes > 0),
        evidence: traced.length > 0 ? "traced" : "untraced",
      };
    }),
  );

  const unplanted = cells.flatMap(({ phase, pieces, planted }) => {
    const plantedAreas = new Set(planted.map((m) => m.areaId));
    return tally(pieces.filter((p) => !plantedAreas.has(p.areaId)))
      .sort((a, b) => areaOrder(a.areaId) - areaOrder(b.areaId))
      .map(({ surface, areaId, ms }) => ({
        phase,
        areaName: areaName(areaId),
        surface,
        minutes: toMin(ms),
      }))
      .filter((u) => u.minutes > 0);
  });

  return { day, moments, unplanted };
}

// ── The readback ───────────────────────────────────────────────────────────

function hasSurfaces(area: ReadbackArea | undefined): boolean {
  const s = area?.surfaces;
  return Boolean(s?.paths?.length || s?.hosts?.length || s?.apps?.length);
}

/**
 * Read a window back. `from` and `to` are inclusive waking days
 * (`YYYY-MM-DD`, days roll at 04:00). For a week, pass `weekOf(day)`.
 */
export function weekReadback(
  input: ReadbackInput,
  from: string,
  to: string,
): WeekReadback {
  const areasById = new Map(input.areas.map((a) => [a.id, a]));
  const habitsById = new Map(input.habits.map((h) => [h.id, h]));
  const areaName = (id: string) => areasById.get(id)?.name ?? id;
  const areaOrder = (id: string) => areasById.get(id)?.order ?? 0;
  const index = indexSurfaces(Object.fromEntries(areasById));
  const resolve: Resolver = (e) => resolveArea(index, e);

  const last = previousWindow(from, to);
  const days = daysBetween(from, to);
  const lastDays = new Set(daysBetween(last.from, last.to));
  const thisDays = new Set(days);

  // Board
  const garminHabits = new Set(
    Object.values(input.garminHabitMap?.mappings ?? {}).map((m) => m.habitId),
  );
  // Planted = a day and a phase. A moment with a day but no phase sits on no
  // board cell, so it is counted nowhere, keeping the board and `planted` equal.
  const allocated = input.moments.filter(
    (m) => countsAsAllocation(m) && m.day !== null && m.phase !== null,
  );
  const phaseOrder = [...input.phaseConfigs].sort((a, b) => a.order - b.order);
  const plantedIn = (day: string, phase: string) =>
    allocated
      .filter((m) => m.day === day && m.phase === phase)
      .sort((a, b) => a.order - b.order);
  const board: BoardDay[] = days.map((day) => ({
    day,
    phases: phaseOrder
      .map((pc) => ({
        phase: pc.phase,
        moments: plantedIn(day, pc.phase).map((m) => ({
          id: m.id,
          name: m.name,
          areaId: m.areaId,
          ...(m.habitId ? { habitId: m.habitId } : {}),
          traceable:
            hasSurfaces(areasById.get(m.areaId)) ||
            (m.habitId !== null && garminHabits.has(m.habitId)),
        })),
      }))
      .filter((p) => p.moments.length > 0),
  }));

  // Planted, two plain counts
  const planted = new Map<string, { thisWeek: number; lastWeek: number }>();
  for (const m of allocated) {
    const inThis = thisDays.has(m.day as string);
    if (!inThis && !lastDays.has(m.day as string)) continue;
    const entry = planted.get(m.areaId) ?? { thisWeek: 0, lastWeek: 0 };
    if (inThis) entry.thisWeek += 1;
    else entry.lastWeek += 1;
    planted.set(m.areaId, entry);
  }

  // Footprints
  const habitArea = (id: string) => habitsById.get(id)?.areaId;
  const read = (window: { from: string; to: string }) => {
    const fromMs = wakingDayWindow(window.from).from;
    const toMs = wakingDayWindow(window.to).to;
    const inWindow = input.events.filter((e) => e.ts >= fromMs && e.ts < toMs);
    return (surface: ReadingSurface): Footprint =>
      footprintOf(
        READERS[surface]({
          events: inWindow.filter((e) =>
            READING_SOURCES[surface].includes(e.surface),
          ),
          resolve,
          from: fromMs,
          to: toMs,
          habitArea,
          areaName,
          ...(input.garminHabitMap
            ? { garminHabitMap: input.garminHabitMap }
            : {}),
        }),
        areaName,
        areaOrder,
      );
  };
  const thisRead = read({ from, to });
  const lastRead = read(last);
  const footprints: SurfaceReading[] = READING_SURFACES.map((surface) =>
    READING_SOURCES[surface].length === 0
      ? { surface, status: "not drawn" }
      : {
          surface,
          status: "drawn",
          thisWeek: thisRead(surface),
          lastWeek: lastRead(surface),
        },
  );

  // Trace, for the days that have begun: a day still ahead has seen nothing
  const trace = days
    .filter((day) => wakingDayWindow(day).from <= input.now.getTime())
    .map((day) =>
      traceDay(day, {
        input,
        phases: phaseOrder,
        resolve,
        areaName,
        areaOrder,
        plantedIn,
      }),
    );

  // Wilting, as of the window's close (the last waking day's end) or now,
  // whichever is earlier. Moments planted after the window cannot rescue it.
  const close = new Date(wakingDayWindow(to).to);
  const asOf = input.now < close ? input.now : close;
  const asOfDay = localDate(asOf.getTime());
  const cyclesById = new Map((input.cycles ?? []).map((c) => [c.id, c]));
  const activePlan = (habitId: string) =>
    (input.cyclePlans ?? []).find((p) => {
      if (p.habitId !== habitId) return false;
      const c = cyclesById.get(p.cycleId);
      return (
        c !== undefined &&
        c.startDate <= asOfDay &&
        (!c.endDate || c.endDate >= asOfDay)
      );
    }) ?? null;
  const moments = input.moments.filter((m) => m.day === null || m.day <= to);
  const wilting = input.habits
    .filter((h) => !h.isArchived)
    .filter(
      (h) =>
        habitHealthService.computeHealth(h, activePlan(h.id), moments, asOf) ===
        "wilting",
    )
    .map((h) => ({
      habitId: h.id,
      name: h.name,
      areaId: h.areaId,
      areaName: areaName(h.areaId),
    }))
    .sort(
      (a, b) =>
        a.areaName.localeCompare(b.areaName) || a.name.localeCompare(b.name),
    );

  return {
    window: { from, to },
    lastWindow: last,
    board,
    planted: [...planted.entries()]
      .map(([areaId, counts]) => ({
        areaId,
        areaName: areaName(areaId),
        ...counts,
      }))
      // The gardener's own area order. Sorting by count would read as a ranking.
      .sort((a, b) => areaOrder(a.areaId) - areaOrder(b.areaId)),
    footprints,
    trace,
    wilting,
  };
}
