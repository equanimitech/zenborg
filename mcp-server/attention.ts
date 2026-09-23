/**
 * Attention analytics — MCP tool handlers for the plan↔trace bridge.
 *
 * Read-only aggregates over keel's activity log. Privacy tier: minutes and
 * counts only, never window titles, URLs, prompts, or file paths beyond cwd.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { SurfaceIndex } from "../src/domain/attention/SurfaceIndex.ts";
import { indexSurfaces, resolveArea } from "../src/domain/attention/SurfaceIndex.ts";
import type { AreaSurfaces } from "../src/domain/entities/Area.ts";
import {
  agentSessions,
  byArea,
  coverage,
  dwellRows,
  type DwellConfig,
} from "../src/domain/attention/AttentionSummary.ts";
import {
  boundariesIn,
  cellWindow,
  type MomentRef,
  type PhaseConfigRef,
} from "../src/domain/attention/GardenClock.ts";
import { spanDuration, spanOverlaps } from "../src/domain/attention/Span.ts";
import { deriveSpans } from "../src/domain/attention/SpanDerivation.ts";
import { logDir, readActivityLog } from "./activity-log.ts";
import type { Area, Moment, PhaseConfig } from "./vault.ts";

const DEFAULT_CAP_MS: Record<string, number> = {
  desktop: 30 * 60_000,
  agent: 5 * 60_000,
  browser: 120 * 60_000, // focus_end/idle_start give real boundaries; cap is a fallback
};

const DAY_START_HOUR = 4;

export function wakingDayWindow(day: string): { from: number; to: number } {
  const [y, m, d] = day.split("-").map(Number);
  const from = new Date(y, m - 1, d, DAY_START_HOUR, 0, 0, 0).getTime();
  const to = from + 24 * 60 * 60_000;
  return { from, to };
}

export function todayStr(): string {
  const now = new Date();
  const h = now.getHours();
  if (h < DAY_START_HOUR) {
    now.setDate(now.getDate() - 1);
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function resolveWindow(params: {
  day?: string;
  from?: string;
  to?: string;
}): { from: number; to: number; fromDay: string; toDay: string } {
  if (params.day) {
    const w = wakingDayWindow(params.day);
    return { ...w, fromDay: params.day, toDay: params.day };
  }
  const fromDay = params.from ?? todayStr();
  const toDay = params.to ?? fromDay;
  const from = wakingDayWindow(fromDay).from;
  const to = wakingDayWindow(toDay).to;
  return { from, to, fromDay, toDay };
}

function msToMin(ms: number): number {
  return Math.round(ms / 60_000);
}

function timeStr(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
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

  const byArea = new Map<string, { paths: string[]; hosts: string[]; apps: string[] }>();
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

export interface AttentionResult {
  window: { from: string; to: string };
  coverage: Array<{
    surface: string;
    first?: string;
    last?: string;
    events: number;
  }>;
  surfaces: Array<{
    surface: string;
    byArea: Array<{
      areaId: string;
      areaName: string;
      minutes: number;
      visits: number;
    }>;
    unmapped: Array<{ locator: string; minutes: number; visits: number }>;
  }>;
  sessions?: Array<{
    sessionId: string;
    cwd?: string;
    start: string;
    end: string;
    minutes: number;
    prompts: number;
  }>;
}

export function getAttention(
  vaultRoot: string,
  areas: Record<string, Area>,
  params: {
    day?: string;
    from?: string;
    to?: string;
    surfaces?: string[];
    pathPrefix?: string;
  },
): AttentionResult {
  const window = resolveWindow(params);
  const surfaceIndex = loadSurfaces(vaultRoot, areas);
  const traceSurfaces = (params.surfaces ?? [
    "desktop",
    "agent",
    "browser",
  ]) as Array<"desktop" | "agent" | "browser">;
  const dir = logDir(vaultRoot);
  const events = readActivityLog(dir, window.from, window.to, traceSurfaces);

  const areaName = (id: string) =>
    areas[id]?.name ?? id;
  const resolver = (e: Parameters<typeof resolveArea>[1]) =>
    resolveArea(surfaceIndex, e);

  const surfaceResults = traceSurfaces.map((surface) => {
    const config: DwellConfig = {
      capMs: DEFAULT_CAP_MS[surface] ?? 30 * 60_000,
    };
    let rows = dwellRows(events, surface, resolver, config);

    if (params.pathPrefix && surface === "agent") {
      const prefix = params.pathPrefix.replace(/^~/, process.env.HOME ?? "~");
      rows = rows.filter(
        (r) => r.locator === prefix || r.locator.startsWith(`${prefix}/`),
      );
    }

    const mapped = byArea(rows);
    const unmapped = rows
      .filter((r) => r.areaId === undefined)
      .slice(0, 10);

    return {
      surface,
      byArea: mapped.map((a) => ({
        areaId: a.areaId,
        areaName: areaName(a.areaId),
        minutes: msToMin(a.ms),
        visits: a.visits,
      })),
      unmapped: unmapped.map((r) => ({
        locator: r.locator,
        minutes: msToMin(r.ms),
        visits: r.visits,
      })),
    };
  });

  const cov = coverage(events, traceSurfaces).map((c) => ({
    surface: c.surface,
    ...(c.first !== undefined ? { first: timeStr(c.first) } : {}),
    ...(c.last !== undefined ? { last: timeStr(c.last) } : {}),
    events: c.events,
  }));

  const result: AttentionResult = {
    window: { from: window.fromDay, to: window.toDay },
    coverage: cov,
    surfaces: surfaceResults,
  };

  if (traceSurfaces.includes("agent")) {
    const sessions = agentSessions(events);
    result.sessions = sessions.map((s) => ({
      sessionId: s.sessionId,
      ...(s.cwd ? { cwd: s.cwd } : {}),
      start: timeStr(s.start),
      end: timeStr(s.end),
      minutes: msToMin(s.end - s.start),
      prompts: s.prompts,
    }));
  }

  return result;
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
    paths: map.paths.map((r) => ({ prefix: r.prefix, areaId: r.areaId, areaName: areaName(r.areaId) })),
    hosts: map.hosts.map((r) => ({ host: r.host, areaId: r.areaId, areaName: areaName(r.areaId) })),
    apps: map.apps.map((r) => ({ app: r.app, areaId: r.areaId, areaName: areaName(r.areaId) })),
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
      const field = params.kind === "path" ? "paths" : params.kind === "host" ? "hosts" : "apps";
      const list = s[field];
      if (!list || !list.includes(params.key)) continue;
      const filtered = list.filter((v) => v !== params.key);
      (a as any).surfaces = {
        ...s,
        [field]: filtered.length > 0 ? filtered : undefined,
      };
      (a as any).updatedAt = new Date().toISOString();
      return { ok: true, message: `Removed ${params.kind} rule for "${params.key}" from ${a.name}`, mutated: true };
    }
    return { ok: false, message: `No ${params.kind} rule for "${params.key}"`, mutated: false };
  }

  const area = Object.values(areas).find(
    (a) => a.id === params.area || a.name.toLowerCase() === params.area!.toLowerCase(),
  );
  if (!area) return { ok: false, message: `Area not found: ${params.area}`, mutated: false };

  // Remove from any other area first
  for (const a of Object.values(areas)) {
    if (a.id === area.id) continue;
    const s = a.surfaces;
    if (!s) continue;
    const field = params.kind === "path" ? "paths" : params.kind === "host" ? "hosts" : "apps";
    const list = s[field];
    if (!list || !list.includes(params.key)) continue;
    (a as any).surfaces = {
      ...s,
      [field]: list.filter((v) => v !== params.key),
    };
    (a as any).updatedAt = new Date().toISOString();
  }

  const field = params.kind === "path" ? "paths" : params.kind === "host" ? "hosts" : "apps";
  const existing = area.surfaces?.[field] ?? [];
  if (!existing.includes(params.key)) {
    (area as any).surfaces = {
      ...(area.surfaces ?? {}),
      [field]: [...existing, params.key],
    };
    (area as any).updatedAt = new Date().toISOString();
  }

  return { ok: true, message: `Mapped ${params.kind} "${params.key}" → ${area.name}`, mutated: true };
}

// ────────────────────────────────────────────────────────────────────────
// Day trace — plan vs actual
// ────────────────────────────────────────────────────────────────────────

export interface DayTraceResult {
  day: string;
  coverage: Array<{ surface: string; first?: string; last?: string; events: number }>;
  moments: Array<{
    momentId: string;
    name: string;
    areaId: string;
    areaName: string;
    phase: string | null;
    window?: { start: string; end: string };
    traced: Array<{ surface: string; minutes: number }>;
    elsewhere: Array<{ surface: string; areaName: string; minutes: number }>;
    evidence: "traced" | "untraced";
  }>;
  unplanted: Array<{ phase: string; areaName: string; surface: string; minutes: number }>;
}

export function getDayTrace(
  vaultRoot: string,
  areas: Record<string, Area>,
  moments: Record<string, Moment>,
  phaseConfigRecs: Record<string, PhaseConfig>,
  params: { day?: string; idleGapMin?: number },
): DayTraceResult {
  const day = params.day ?? todayStr();
  const idleGapMs = (params.idleGapMin ?? 15) * 60_000;
  const surfaceIndex = loadSurfaces(vaultRoot, areas);
  const areaName = (id: string) => areas[id]?.name ?? id;

  const window = wakingDayWindow(day);
  const dir = logDir(vaultRoot);
  const surfaces = ["desktop", "agent", "browser"] as const;
  const events = readActivityLog(dir, window.from, window.to, surfaces);

  const momentsList = Object.values(moments) as MomentRef[];
  const pcList = Object.values(phaseConfigRecs) as PhaseConfigRef[];

  const boundaries = boundariesIn(window.from, window.to, momentsList, pcList);
  const resolver = (e: Parameters<typeof resolveArea>[1]) => resolveArea(surfaceIndex, e);
  const spans = deriveSpans(events, resolver, { idleGapMs, boundaries });

  const cov = coverage(events, surfaces).map((c) => ({
    surface: c.surface,
    ...(c.first !== undefined ? { first: timeStr(c.first) } : {}),
    ...(c.last !== undefined ? { last: timeStr(c.last) } : {}),
    events: c.events,
  }));

  const dayMoments = Object.values(moments).filter(
    (m) => m.day === day && m.phase !== null,
  );

  const tracedPhases = new Set<string>();

  const momentResults = dayMoments.map((m) => {
    const cell = cellWindow(day, m.phase!, pcList);
    if (!cell) {
      return {
        momentId: m.id,
        name: m.name,
        areaId: m.areaId,
        areaName: areaName(m.areaId),
        phase: m.phase,
        traced: [] as Array<{ surface: string; minutes: number }>,
        elsewhere: [] as Array<{ surface: string; areaName: string; minutes: number }>,
        evidence: "untraced" as const,
      };
    }

    tracedPhases.add(m.phase!);

    const cellSpans = spans.filter((s) => spanOverlaps(s, cell.from, cell.to));
    const traced = new Map<string, number>();
    const elsewhere = new Map<string, { areaId: string; ms: number }>();

    for (const span of cellSpans) {
      const overlapStart = Math.max(span.start, cell.from);
      const overlapEnd = Math.min(span.end, cell.to);
      const ms = Math.max(0, overlapEnd - overlapStart);
      if (ms === 0) continue;

      const event = events.find((e) => e.id === span.sourceEventIds[0]);
      const surface = event?.surface ?? "agent";

      if (span.areaId === m.areaId) {
        traced.set(surface, (traced.get(surface) ?? 0) + ms);
      } else {
        const key = `${surface}:${span.areaId}`;
        const existing = elsewhere.get(key);
        if (existing) {
          existing.ms += ms;
        } else {
          elsewhere.set(key, { areaId: span.areaId, ms });
        }
      }
    }

    const hasWindow = m.startTime !== undefined;
    return {
      momentId: m.id,
      name: m.name,
      areaId: m.areaId,
      areaName: areaName(m.areaId),
      phase: m.phase,
      ...(hasWindow && m.startTime
        ? {
            window: {
              start: m.startTime,
              end: m.durationMin
                ? (() => {
                    const [h, min] = m.startTime!.split(":").map(Number);
                    const total = h * 60 + min + m.durationMin!;
                    const p = (n: number) => String(n).padStart(2, "0");
                    return `${p(Math.floor(total / 60) % 24)}:${p(total % 60)}`;
                  })()
                : m.startTime,
            },
          }
        : {}),
      traced: [...traced.entries()]
        .map(([surface, ms]) => ({ surface, minutes: msToMin(ms) }))
        .filter((t) => t.minutes > 0),
      elsewhere: [...elsewhere.entries()]
        .map(([key, { areaId, ms }]) => ({
          surface: key.split(":")[0],
          areaName: areaName(areaId),
          minutes: msToMin(ms),
        }))
        .filter((e) => e.minutes > 0),
      evidence: traced.size > 0 ? ("traced" as const) : ("untraced" as const),
    };
  });

  // Unplanted: spans in phases with no planted moments for that area
  const plantedAreasByPhase = new Map<string, Set<string>>();
  for (const m of dayMoments) {
    if (!m.phase) continue;
    const set = plantedAreasByPhase.get(m.phase) ?? new Set();
    set.add(m.areaId);
    plantedAreasByPhase.set(m.phase, set);
  }

  const unplantedAcc = new Map<string, number>();
  for (const span of spans) {
    for (const pc of pcList) {
      const cell = cellWindow(day, pc.phase, pcList);
      if (!cell || !spanOverlaps(span, cell.from, cell.to)) continue;
      const planted = plantedAreasByPhase.get(pc.phase);
      if (planted && planted.has(span.areaId)) continue;

      const overlapStart = Math.max(span.start, cell.from);
      const overlapEnd = Math.min(span.end, cell.to);
      const ms = Math.max(0, overlapEnd - overlapStart);
      if (ms === 0) continue;

      const event = events.find((e) => e.id === span.sourceEventIds[0]);
      const surface = event?.surface ?? "agent";
      const key = `${pc.phase}:${span.areaId}:${surface}`;
      unplantedAcc.set(key, (unplantedAcc.get(key) ?? 0) + ms);
    }
  }

  const unplanted = [...unplantedAcc.entries()]
    .map(([key, ms]) => {
      const [phase, areaId, surface] = key.split(":");
      return { phase, areaName: areaName(areaId), surface, minutes: msToMin(ms) };
    })
    .filter((u) => u.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  return { day, coverage: cov, moments: momentResults, unplanted };
}
