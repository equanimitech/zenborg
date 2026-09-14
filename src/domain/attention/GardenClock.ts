/**
 * GardenClock — resolves instants against the plan's time structure.
 *
 * Pure functions over moments and phaseConfigs. Lifted from
 * scripts/shadow.mts so the MCP server and the script share one
 * implementation.
 */
import type { Instant } from "./ids.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface PhaseConfigRef {
  readonly phase: string;
  readonly startHour: number;
  readonly endHour: number;
}

export interface MomentRef {
  readonly id: string;
  readonly areaId: string;
  readonly day: string | null;
  readonly phase: string | null;
  readonly startTime?: string;
  readonly durationMin?: number;
}

function localDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function phaseAt(
  instant: number,
  phaseConfigs: readonly PhaseConfigRef[],
): string | null {
  const hour = new Date(instant).getHours();
  for (const config of phaseConfigs) {
    const { startHour, endHour } = config;
    const inBand =
      endHour <= startHour
        ? hour >= startHour || hour < endHour
        : hour >= startHour && hour < endHour;
    if (inBand) return config.phase;
  }
  return null;
}

export interface Planting {
  readonly momentIds: readonly string[];
  readonly areaIds: readonly string[];
}

export function plantingsAt(
  instant: number,
  moments: readonly MomentRef[],
  phaseConfigs: readonly PhaseConfigRef[],
): Planting {
  const day = localDate(instant);
  const phase = phaseAt(instant, phaseConfigs);
  const planted = moments.filter((m) => m.day === day && m.phase === phase);
  return {
    momentIds: planted.map((m) => m.id),
    areaIds: [...new Set(planted.map((m) => m.areaId))],
  };
}

export function boundariesIn(
  from: number,
  to: number,
  moments: readonly MomentRef[],
  phaseConfigs: readonly PhaseConfigRef[],
): readonly Instant[] {
  const out = new Set<number>();

  const atHour = (dayStart: Date, hour: number) => {
    const d = new Date(dayStart);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  for (let ts = from; ts <= to + DAY; ts += DAY) {
    const dayStart = new Date(ts);
    for (const config of phaseConfigs) {
      out.add(atHour(dayStart, config.startHour % 24));
      out.add(atHour(dayStart, config.endHour % 24));
    }
  }

  for (const moment of moments) {
    if (moment.day == null || moment.startTime == null) continue;
    const [h, m] = moment.startTime.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const [y, mo, d] = moment.day.split("-").map(Number);
    const start = new Date(y, mo - 1, d, h, m, 0, 0).getTime();
    out.add(start);
    if (moment.durationMin !== undefined && moment.durationMin > 0) {
      out.add(start + moment.durationMin * MINUTE);
    }
  }

  return [...out].filter((b) => b >= from && b < to).sort((a, b) => a - b);
}

/**
 * The clock window for a (day, phase) cell.
 * Returns epoch-ms [from, to) for the given phase band on that day.
 */
export function cellWindow(
  day: string,
  phase: string,
  phaseConfigs: readonly PhaseConfigRef[],
): { from: number; to: number } | null {
  const config = phaseConfigs.find((c) => c.phase === phase);
  if (!config) return null;
  const [y, m, d] = day.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d);
  const atHour = (hour: number) => {
    const dt = new Date(dayStart);
    dt.setHours(hour, 0, 0, 0);
    return dt.getTime();
  };
  const from = atHour(config.startHour % 24);
  let to = atHour(config.endHour % 24);
  if (to <= from) to += 24 * 60 * MINUTE;
  return { from, to };
}
