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
import { localDate, wakingDayWindow } from "../attention/GardenClock.ts";
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
  work: ["agent"],
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
 * including `idle_start` (120 s without input). Idle minutes an app held the
 * Mac awake through are credited separately, capped at `IDLE_CREDIT_CAP_MS`
 * (3 h), not at these.
 */
const CAP_MS: Readonly<Partial<Record<ActivitySurface, number>>> = {
  desktop: 30 * MINUTE,
  agent: 5 * MINUTE,
  browser: 120 * MINUTE, // focus_end/idle_start give real boundaries; cap is a fallback
};

const UNMAPPED_SHOWN = 10;

/** How much of the window a surface could see. Plain counts, never a share. */
export interface Coverage {
  /**
   * Hours the surface actually observed: the union of every span it traced
   * (mapped or not), to one decimal. It can never be smaller than the minutes
   * reported beside it.
   */
  readonly seenHours: number;
  /** Minutes credited through idle: an app held the Mac awake (a player, say) while no input came. Already inside the minutes beside it. */
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
export type ReadbackMoment = Pick<Moment, "id" | "name" | "areaId" | "order"> &
  HealthMoment & { readonly phase: string | null };
export type ReadbackHabit = Pick<Habit, "name" | "areaId" | "isArchived"> &
  HealthSubject;
export type ReadbackArea = Pick<Area, "id" | "name" | "order" | "surfaces">;
export type ReadbackPhaseConfig = {
  readonly phase: string;
  readonly order: number;
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
  /** The observed spans credited through idle. */
  readonly idleCredited?: readonly Interval[];
}

function footprintOf(
  { rows, observed, idleCredited = [] }: Reading,
  areaName: (id: string) => string,
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
      .sort((a, b) => b.minutes - a.minutes),
    unmapped: [...unmapped.entries()]
      .map(([locator, ms]) => ({ locator, minutes: toMin(ms) }))
      .filter((r) => r.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, UNMAPPED_SHOWN),
    coverage: {
      seenHours: Math.round((unionMs(observed) / HOUR) * 10) / 10,
      idleCreditedMin: toMin(unionMs(idleCredited)),
      unmappedMin: toMin(
        [...unmapped.values()].reduce((sum, ms) => sum + ms, 0),
      ),
    },
  };
}

type Resolver = (e: ActivityEvent) => string | undefined;

interface ReadContext {
  readonly events: readonly ActivityEvent[];
  readonly resolve: Resolver;
  readonly from: number;
  readonly to: number;
  readonly habitArea: (habitId: string) => string | undefined;
  readonly garminHabitMap?: GarminHabitMap;
}

function spansOf(
  { events, resolve, from, to }: ReadContext,
  surface: ActivitySurface,
): DwellSpans[] {
  return dwellSpans(events, surface, resolve, {
    capMs: CAP_MS[surface] ?? 30 * MINUTE,
  }).map((r) => ({
    ...r,
    spans: clip(r.spans, from, to),
    idleCredited: clip(r.idleCredited, from, to),
  }));
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
    idleCredited: desktop.flatMap((r) => r.idleCredited),
  };
}

function readWork(ctx: ReadContext): Reading {
  const agent = spansOf(ctx, "agent");
  return {
    rows: agent.map((r) => ({
      locator: r.locator,
      ...(r.areaId !== undefined ? { areaId: r.areaId } : {}),
      ms: unionMs(r.spans),
    })),
    observed: agent.flatMap((r) => r.spans),
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
  const board: BoardDay[] = days.map((day) => {
    const dayMoments = allocated.filter((m) => m.day === day);
    return {
      day,
      phases: phaseOrder
        .map((pc) => ({
          phase: pc.phase,
          moments: dayMoments
            .filter((m) => m.phase === pc.phase)
            .sort((a, b) => a.order - b.order)
            .map((m) => ({
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
    };
  });

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
          ...(input.garminHabitMap
            ? { garminHabitMap: input.garminHabitMap }
            : {}),
        }),
        areaName,
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
      .sort(
        (a, b) =>
          (areasById.get(a.areaId)?.order ?? 0) -
          (areasById.get(b.areaId)?.order ?? 0),
      ),
    footprints,
    wilting,
  };
}
