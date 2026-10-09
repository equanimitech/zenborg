/**
 * Footprints — MCP tool handlers over the activity log and the area map.
 *
 * Read-only aggregates. Privacy tier: minutes and counts only, never window
 * titles, URLs, prompts, or file paths beyond cwd.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  wakingDay,
  wakingDayWindow,
} from "../src/domain/attention/GardenClock.ts";
import type { SurfaceIndex } from "../src/domain/attention/SurfaceIndex.ts";
import { indexSurfaces } from "../src/domain/attention/SurfaceIndex.ts";
import type { AreaSurfaces } from "../src/domain/entities/Area.ts";
import type { GarminHabitMap } from "../src/domain/garmin/GarminHabitMap.ts";
import {
  READBACK_LOG_SURFACES,
  type ReadbackInput,
  readbackSpan,
  type WeekReadback,
  weekOf,
  weekReadback,
} from "../src/domain/readback/WeekReadback.ts";
import { logDir, readActivityLog } from "./activity-log.ts";
import { toHealthSubject } from "./health.ts";
import type {
  Area,
  Cycle,
  CyclePlan,
  Habit,
  Moment,
  PhaseConfig,
} from "./vault.ts";

export function resolveWindow(params: {
  day?: string;
  from?: string;
  to?: string;
}): { from: number; to: number; fromDay: string; toDay: string } {
  if (params.day) {
    const w = wakingDayWindow(params.day);
    return { ...w, fromDay: params.day, toDay: params.day };
  }
  const fromDay = params.from ?? wakingDay();
  const toDay = params.to ?? fromDay;
  const from = wakingDayWindow(fromDay).from;
  const to = wakingDayWindow(toDay).to;
  return { from, to, fromDay, toDay };
}

export const AREA_MAP_PATH = "area-map.json";

/** Derive the area map from surfaces on area entities. */
export function loadSurfaces(
  _vaultRoot: string,
  areas?: Record<string, Area>,
): SurfaceIndex {
  if (areas) return indexSurfaces(areas);
  return { paths: [], hosts: [], apps: [] };
}

/**
 * Migrate area-map.json entries onto area entities as surfaces.
 * Idempotent — skips areas that already have surfaces, removes the legacy file when done.
 */
export function migrateSurfaces(
  vaultRoot: string,
  areas: Record<string, Area>,
): { migrated: number; alreadyDone: boolean } {
  const mapFile = path.join(vaultRoot, AREA_MAP_PATH);
  if (!fs.existsSync(mapFile)) return { migrated: 0, alreadyDone: true };

  let raw: { paths?: any[]; hosts?: any[]; apps?: any[] };
  try {
    raw = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  } catch {
    return { migrated: 0, alreadyDone: false };
  }

  const byArea = new Map<
    string,
    { paths: string[]; hosts: string[]; apps: string[] }
  >();
  for (const r of raw.paths ?? []) {
    if (!r.areaId || !r.prefix) continue;
    const entry = byArea.get(r.areaId) ?? { paths: [], hosts: [], apps: [] };
    entry.paths.push(r.prefix);
    byArea.set(r.areaId, entry);
  }
  for (const r of raw.hosts ?? []) {
    if (!r.areaId || !r.host) continue;
    const entry = byArea.get(r.areaId) ?? { paths: [], hosts: [], apps: [] };
    entry.hosts.push(r.host);
    byArea.set(r.areaId, entry);
  }
  for (const r of raw.apps ?? []) {
    if (!r.areaId || !r.app) continue;
    const entry = byArea.get(r.areaId) ?? { paths: [], hosts: [], apps: [] };
    entry.apps.push(r.app);
    byArea.set(r.areaId, entry);
  }

  let migrated = 0;
  for (const [areaId, surfaces] of byArea) {
    const area = areas[areaId];
    if (!area) continue;
    if (area.surfaces) continue;
    const s: AreaSurfaces = {
      ...(surfaces.paths.length > 0 ? { paths: surfaces.paths } : {}),
      ...(surfaces.hosts.length > 0 ? { hosts: surfaces.hosts } : {}),
      ...(surfaces.apps.length > 0 ? { apps: surfaces.apps } : {}),
    };
    (area as any).surfaces = s;
    (area as any).updatedAt = new Date().toISOString();
    migrated++;
  }

  if (migrated > 0) {
    fs.renameSync(mapFile, `${mapFile}.bak`);
  }

  return { migrated, alreadyDone: false };
}

export interface SurfaceMapResult {
  paths: Array<{ prefix: string; areaId: string; areaName: string }>;
  hosts: Array<{ host: string; areaId: string; areaName: string }>;
  apps: Array<{ app: string; areaId: string; areaName: string }>;
  stale: Array<{ kind: string; key: string; areaId: string }>;
}

export function getSurfaces(
  _vaultRoot: string,
  areas: Record<string, Area>,
): SurfaceMapResult {
  const map = indexSurfaces(areas);
  const areaName = (id: string) => areas[id]?.name ?? id;

  return {
    paths: map.paths.map((r) => ({
      prefix: r.prefix,
      areaId: r.areaId,
      areaName: areaName(r.areaId),
    })),
    hosts: map.hosts.map((r) => ({
      host: r.host,
      areaId: r.areaId,
      areaName: areaName(r.areaId),
    })),
    apps: map.apps.map((r) => ({
      app: r.app,
      areaId: r.areaId,
      areaName: areaName(r.areaId),
    })),
    stale: [],
  };
}

export function mapArea(
  _vaultRoot: string,
  areas: Record<string, Area>,
  params: { kind: string; key: string; area: string | null },
): { ok: boolean; message: string; mutated: boolean } {
  if (params.area === null) {
    for (const a of Object.values(areas)) {
      const s = a.surfaces;
      if (!s) continue;
      const field =
        params.kind === "path"
          ? "paths"
          : params.kind === "host"
            ? "hosts"
            : "apps";
      const list = s[field];
      if (!list || !list.includes(params.key)) continue;
      const filtered = list.filter((v) => v !== params.key);
      (a as any).surfaces = {
        ...s,
        [field]: filtered.length > 0 ? filtered : undefined,
      };
      (a as any).updatedAt = new Date().toISOString();
      return {
        ok: true,
        message: `Removed ${params.kind} rule for "${params.key}" from ${a.name}`,
        mutated: true,
      };
    }
    return {
      ok: false,
      message: `No ${params.kind} rule for "${params.key}"`,
      mutated: false,
    };
  }

  const area = Object.values(areas).find(
    (a) =>
      a.id === params.area ||
      a.name.toLowerCase() === params.area!.toLowerCase(),
  );
  if (!area)
    return {
      ok: false,
      message: `Area not found: ${params.area}`,
      mutated: false,
    };

  // Remove from any other area first
  for (const a of Object.values(areas)) {
    if (a.id === area.id) continue;
    const s = a.surfaces;
    if (!s) continue;
    const field =
      params.kind === "path"
        ? "paths"
        : params.kind === "host"
          ? "hosts"
          : "apps";
    const list = s[field];
    if (!list || !list.includes(params.key)) continue;
    (a as any).surfaces = {
      ...s,
      [field]: list.filter((v) => v !== params.key),
    };
    (a as any).updatedAt = new Date().toISOString();
  }

  const field =
    params.kind === "path"
      ? "paths"
      : params.kind === "host"
        ? "hosts"
        : "apps";
  const existing = area.surfaces?.[field] ?? [];
  if (!existing.includes(params.key)) {
    (area as any).surfaces = {
      ...(area.surfaces ?? {}),
      [field]: [...existing, params.key],
    };
    (area as any).updatedAt = new Date().toISOString();
  }

  return {
    ok: true,
    message: `Mapped ${params.kind} "${params.key}" → ${area.name}`,
    mutated: true,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Footprints — the week read back
// ────────────────────────────────────────────────────────────────────────

export interface FootprintCollections {
  areas: Record<string, Area>;
  habits: Record<string, Habit>;
  moments: Record<string, Moment>;
  phaseConfigs: Record<string, PhaseConfig>;
  cycles: Record<string, Cycle>;
  cyclePlans: Record<string, CyclePlan>;
}

/** Longest explicit range; a readback is a week, a month at most. */
export const MAX_FOOTPRINT_DAYS = 31;

/** Why these params cannot be read, or null when they can. */
export function footprintParamsError(params: {
  day?: string;
  from?: string;
  to?: string;
}): string | null {
  if (params.to && !params.from)
    return "`to` needs `from`; pass `day` to read a week";
  if (params.day && params.from) return "pass `day` or `from`/`to`, not both";
  if (params.from && params.to) {
    if (params.to < params.from)
      return `to (${params.to}) is before from (${params.from})`;
    const days =
      Math.round(
        (wakingDayWindow(params.to).from - wakingDayWindow(params.from).from) /
          86_400_000,
      ) + 1;
    if (days > MAX_FOOTPRINT_DAYS)
      return `range is ${days} days; read at most ${MAX_FOOTPRINT_DAYS}`;
  }
  return null;
}

/**
 * The window to read: an explicit `from`/`to` range, else the Monday → Sunday
 * week holding `day` (default: today's waking day).
 */
export function footprintWindow(
  params: { day?: string; from?: string; to?: string },
  now: Date = new Date(),
): { from: string; to: string } {
  if (params.from) return { from: params.from, to: params.to ?? params.from };
  return weekOf(params.day ?? wakingDay(now));
}

/** `get_footprints`: the one domain readback over the vault and the log. */
export function getFootprints(
  vaultRoot: string,
  c: FootprintCollections,
  params: { day?: string; from?: string; to?: string },
  garminHabitMap?: GarminHabitMap,
  now: Date = new Date(),
): WeekReadback {
  const { from, to } = footprintWindow(params, now);
  const span = readbackSpan(from, to);
  const events = readActivityLog(
    logDir(vaultRoot),
    span.from,
    span.to,
    READBACK_LOG_SURFACES,
  );
  const input: ReadbackInput = {
    events,
    moments: Object.values(c.moments),
    habits: Object.values(c.habits).map(toHealthSubject),
    areas: Object.values(c.areas),
    phaseConfigs: Object.values(c.phaseConfigs),
    cycles: Object.values(c.cycles),
    cyclePlans: Object.values(c.cyclePlans),
    ...(garminHabitMap ? { garminHabitMap } : {}),
    now,
  };
  return weekReadback(input, from, to);
}
