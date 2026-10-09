/**
 * The week reads back — what was planted next to the footprints each surface
 * left, and how much of the week each surface could see.
 *
 * One pure function, read by the app's `/week` and by the MCP `get_footprints`
 * tool, so the two cannot disagree. No I/O: callers read the vault and the
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
import { habitHealthService } from "../services/HabitHealthService.ts";
import type { PhaseConfig } from "../value-objects/Phase.ts";

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
 * including `idle_start` (120 s without input), so a film watched without
 * input ends at idle until the daemon credits it (pitch slice 4).
 */
const CAP_MS: Readonly<Partial<Record<ActivitySurface, number>>> = {
  desktop: 30 * MINUTE,
  agent: 5 * MINUTE,
  browser: 120 * MINUTE, // focus_end/idle_start give real boundaries; cap is a fallback
};

const UNMAPPED_SHOWN = 10;

/** How much of the window a surface could see. Plain counts, never a share. */
export interface Coverage {
  /** Clock hours in which the surface left at least one event. */
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

export interface ReadbackInput {
  /** Activity events covering both `readbackSpan(from, to)` windows. Extra events are ignored. */
  readonly events: readonly ActivityEvent[];
  readonly moments: readonly Moment[];
  readonly habits: readonly Habit[];
  readonly areas: readonly Area[];
  readonly phaseConfigs: readonly PhaseConfig[];
  readonly cycles?: readonly Cycle[];
  readonly cyclePlans?: readonly CyclePlan[];
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

function seenHours(events: readonly ActivityEvent[]): number {
  return new Set(events.map((e) => Math.floor(e.ts / HOUR))).size;
}

interface Located {
  readonly locator: string;
  readonly areaId?: string;
  readonly ms: number;
}

function footprintOf(
  located: readonly Located[],
  events: readonly ActivityEvent[],
  areaName: (id: string) => string,
): Footprint {
  const byArea = new Map<string, number>();
  const unmapped = new Map<string, number>();
  for (const row of located) {
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
      seenHours: seenHours(events),
      idleCreditedMin: 0,
      unmappedMin: toMin(
        [...unmapped.values()].reduce((sum, ms) => sum + ms, 0),
      ),
    },
  };
}

type Resolver = (e: ActivityEvent) => string | undefined;

function spansOf(
  events: readonly ActivityEvent[],
  surface: ActivitySurface,
  resolve: Resolver,
  from: number,
  to: number,
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
function screenLocated(
  events: readonly ActivityEvent[],
  resolve: Resolver,
  from: number,
  to: number,
): Located[] {
  const desktop = spansOf(events, "desktop", resolve, from, to);
  const browser = spansOf(events, "browser", resolve, from, to);
  const browserCover = browser.flatMap((r) => r.spans);

  const areaSpans = new Map<string, Interval[]>();
  const out: Located[] = [];
  for (const row of [...desktop, ...browser]) {
    if (row.areaId !== undefined) {
      areaSpans.set(row.areaId, [
        ...(areaSpans.get(row.areaId) ?? []),
        ...row.spans,
      ]);
    } else if (row.surface === "browser") {
      out.push({ locator: row.locator, ms: unionMs(row.spans) });
    } else {
      // |A \ B| = |A ∪ B| − |B|
      const ms =
        unionMs([...row.spans, ...browserCover]) - unionMs(browserCover);
      out.push({ locator: row.locator, ms });
    }
  }
  for (const [areaId, spans] of areaSpans) {
    out.push({ locator: areaId, areaId, ms: unionMs(spans) });
  }
  return out;
}

function workLocated(
  events: readonly ActivityEvent[],
  resolve: Resolver,
  from: number,
  to: number,
): Located[] {
  return spansOf(events, "agent", resolve, from, to).map((r) => ({
    locator: r.locator,
    ...(r.areaId !== undefined ? { areaId: r.areaId } : {}),
    ms: unionMs(r.spans),
  }));
}

function bodyLocated(
  events: readonly ActivityEvent[],
  habitArea: (habitId: string) => string | undefined,
  map: GarminHabitMap | undefined,
): Located[] {
  return workoutsOf(events, map).map((w) => {
    const areaId = w.habitId !== undefined ? habitArea(w.habitId) : undefined;
    return {
      locator: w.activityType,
      ...(areaId !== undefined ? { areaId } : {}),
      ms: w.elapsedMs,
    };
  });
}

// ── The readback ───────────────────────────────────────────────────────────

function hasSurfaces(area: Area | undefined): boolean {
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
  const allocated = input.moments.filter(
    (m) => countsAsAllocation(m) && m.day !== null,
  );
  const phaseOrder = [...input.phaseConfigs].sort((a, b) => a.order - b.order);
  const board: BoardDay[] = days.map((day) => {
    const dayMoments = allocated.filter(
      (m) => m.day === day && m.phase !== null,
    );
    return {
      day,
      phases: phaseOrder
        .map((pc) => ({
          phase: pc.phase as string,
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
    const of = (surface: ReadingSurface) =>
      inWindow.filter((e) => READING_SOURCES[surface].includes(e.surface));
    return (surface: ReadingSurface): Footprint => {
      const events = of(surface);
      const located =
        surface === "screen"
          ? screenLocated(events, resolve, fromMs, toMs)
          : surface === "work"
            ? workLocated(events, resolve, fromMs, toMs)
            : bodyLocated(events, habitArea, input.garminHabitMap);
      return footprintOf(located, events, areaName);
    };
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

  // Wilting, as of the window's close or now, whichever is earlier
  const close = parseDay(to);
  close.setHours(23, 59, 59, 999);
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
  const moments = [...input.moments];
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
