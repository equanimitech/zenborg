/**
 * The weekly appetite check, pure: the table for every allocation, the
 * cycle-level figures, and the Themia-only extract that may leave zenborg.
 *
 * The extract is built here, not filtered by a prompt: personal allocations
 * (any area but Themia) are never in it, nor are totals that would imply them
 * (capacity left to bet, whole-pool hours).
 */
import {
  type Allocation,
  BUGS_OPS_SHARE,
  COOL_DOWN_DAYS,
  isBugsOpsLane,
} from "../entities/Allocation.ts";

export interface SpendRow {
  id: string;
  days: number;
  pct: number;
}

export interface CheckRow {
  name: string;
  kind: Allocation["kind"];
  area: string;
  aim?: string;
  days: number;
  appetiteDays: number;
  pct: number;
}

export interface AppetiteCheck {
  rows: CheckRow[];
  unattributedPct: number;
  bugsOps?: {
    days: number;
    pctOfCapacity: number;
    limitPctOfCapacity: number;
    over: boolean;
  };
  capacityDays: number;
  daysLeftToBet: number;
  /** Themia allocations only; safe for Linear and Slack. */
  themiaExtract: {
    rows: CheckRow[];
    unattributedPct: number;
    bugsOps?: AppetiteCheck["bugsOps"];
  };
}

const fold = (s: string) => s.trim().toLowerCase();
const THEMIA = "themia";
const round = (n: number, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

/** An allocation's area is free text: an area id or a name. */
export const areaName = (
  area: string,
  areas: Record<string, { name: string }>,
): string => areas[area]?.name ?? area;

export const isThemia = (
  area: string,
  areas: Record<string, { name: string }>,
): boolean => fold(areaName(area, areas)) === THEMIA;

export function appetiteCheck(
  allocations: readonly Allocation[],
  spend: { allocations: readonly SpendRow[]; unattributedPct: number },
  capacityDays: number,
  areas: Record<string, { name: string }> = {},
): AppetiteCheck {
  const spent = new Map(spend.allocations.map((r) => [r.id, r]));
  const rows = allocations.map((a) => ({
    name: a.name,
    kind: a.kind,
    area: areaName(a.area, areas),
    aim: a.aim,
    days: spent.get(a.id)?.days ?? 0,
    appetiteDays: a.appetiteDays,
    pct: spent.get(a.id)?.pct ?? 0,
  }));
  const lane = allocations.find(isBugsOpsLane);
  const bugsDays = lane ? (spent.get(lane.id)?.days ?? 0) : 0;
  const bugsOps = lane && {
    days: bugsDays,
    pctOfCapacity: round((bugsDays / capacityDays) * 100, 0),
    limitPctOfCapacity: BUGS_OPS_SHARE * 100,
    over: bugsDays / capacityDays > BUGS_OPS_SHARE,
  };
  const planned = allocations.reduce((s, a) => s + a.appetiteDays, 0);
  return {
    rows,
    unattributedPct: spend.unattributedPct,
    bugsOps,
    capacityDays,
    daysLeftToBet: capacityDays - COOL_DOWN_DAYS - planned,
    themiaExtract: {
      rows: rows.filter((_, i) => isThemia(allocations[i].area, areas)),
      unattributedPct: spend.unattributedPct,
      bugsOps: lane && isThemia(lane.area, areas) ? bugsOps : undefined,
    },
  };
}
