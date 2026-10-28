/**
 * The garden as the moment band reads it. Pure: no I/O, so it runs under
 * `node --test` and inside the Claude Code mod alike.
 */
import type { Band, Tap } from "../types";
import { staleReason, wakingDayKey } from "../domain/attention/ActiveMoment.ts";

export interface PhaseConfig {
  phase: string;
  label: string;
  startHour: number;
  endHour: number;
}
interface Named {
  name: string;
  emoji?: string | null;
  areaId?: string | null;
  order?: number;
}
export interface Moment extends Named {
  id: string;
  day?: string | null;
  phase?: string | null;
}
export interface Habit extends Named {
  id: string;
  phase?: string | null;
  isArchived?: boolean;
}
export interface Area {
  id: string;
  name: string;
  emoji?: string | null;
  tags?: string[];
  /** Territory the area declares; `paths` are absolute prefixes. */
  surfaces?: { paths?: string[] } | null;
}
export interface Vault {
  active: { momentId?: string; at?: string };
  moments: Record<string, Moment>;
  habits: Record<string, Habit>;
  areas: Record<string, Area>;
  phases: Record<string, PhaseConfig>;
}
export interface Reading {
  status: string;
  band: Band | null;
}

/** A moment set longer ago than this reads as stale, as in moment-awareness. */
export const STALE_AFTER_MIN = 120;
const MAX_TAPS = 3;

export function currentPhase(phases: PhaseConfig[], now: Date): PhaseConfig | null {
  const hour = now.getHours();
  for (const cfg of phases) {
    const { startHour, endHour } = cfg;
    const inside =
      endHour <= startHour
        ? hour >= startHour || hour < endHour
        : hour >= startHour && hour < endHour;
    if (inside) return cfg;
  }
  return null;
}

/** "this morning", "tonight". */
const thisPhase = (label: string) =>
  label.toLowerCase() === "night" ? "tonight" : `this ${label.toLowerCase()}`;

/** "<emoji> <name>", the emoji falling back to the area's. */
export const labelOf = (areas: Record<string, Area>) => (x: Named) => {
  const emoji = x.emoji ?? (x.areaId ? areas[x.areaId]?.emoji : undefined);
  return emoji ? `${emoji} ${x.name}` : x.name;
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Unarchived habits of any phase whose name contains the query; prefix matches first, then by order. */
export function matchHabits(habits: Record<string, Habit>, query: string, limit = MAX_TAPS): Habit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const byOrder = (a: Named, b: Named) => (a.order ?? 0) - (b.order ?? 0);
  const hits = Object.values(habits)
    .filter((h) => !h.isArchived && fold(h.name).includes(q))
    .sort(byOrder);
  return [...hits.filter((h) => fold(h.name).startsWith(q)), ...hits.filter((h) => !fold(h.name).startsWith(q))].slice(0, limit);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const under = (cwd: string, p: string) => cwd === p || cwd.startsWith(p.endsWith("/") ? p : `${p}/`);

/**
 * The area of a working directory. Declared `surfaces.paths` first (deepest
 * prefix wins); otherwise a cwd segment equal to the squashed area name.
 */
export function areaOfCwd(areas: Record<string, Area>, cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  let best: { id: string; len: number } | undefined;
  for (const a of Object.values(areas)) {
    for (const p of a.surfaces?.paths ?? []) {
      if (under(cwd, p) && p.length > (best?.len ?? -1)) best = { id: a.id, len: p.length };
    }
  }
  if (best) return best.id;
  const segments = new Set(cwd.split("/").map(squash).filter(Boolean));
  return Object.values(areas).find((a) => squash(a.name) !== "" && segments.has(squash(a.name)))?.id;
}

/** Workspace area, then craft areas, then the rest; the caller's order breaks ties (sort is stable). */
const relevance = (areas: Record<string, Area>, cwd: string | undefined) => {
  const here = areaOfCwd(areas, cwd);
  const rank = (h: Named) =>
    h.areaId && h.areaId === here ? 0 : h.areaId && areas[h.areaId]?.tags?.includes("craft") ? 1 : 2;
  return (a: Named, b: Named) => rank(a) - rank(b);
};

export function reading(v: Vault, now: Date, cwd?: string): Reading | null {
  const phase = currentPhase(Object.values(v.phases), now);
  if (!phase) return null;
  const today = wakingDayKey(now);
  const label = labelOf(v.areas);
  const byOrder = (a: Named, b: Named) => (a.order ?? 0) - (b.order ?? 0);

  // A pointer to a moment off today's board reads as none (staleReason).
  const pointed = v.active.momentId ? v.moments[v.active.momentId] : undefined;
  const active = pointed && staleReason(pointed, today) === null ? pointed : null;

  const fromPhase =
    active?.phase && active.phase !== phase.phase
      ? (Object.values(v.phases).find((p) => p.phase === active.phase)?.label ?? active.phase).toLowerCase()
      : null;
  const ageMin = active && v.active.at ? (now.getTime() - Date.parse(v.active.at)) / 60_000 : 0;
  const why = fromPhase !== null ? `from the ${fromPhase}` : `set ${Math.floor(ageMin / 60)}h ago`;

  if (active && fromPhase === null && ageMin <= STALE_AFTER_MIN) {
    return { status: `≋ ${label(active)}`, band: null };
  }
  const status = active ? `≋ ${label(active)} · ${why}` : `≋ ${phase.label}`;

  const planted = Object.values(v.moments)
    .filter((m) => m.day === today && m.phase === phase.phase && m.id !== active?.id)
    .sort(byOrder);
  const taps: Tap[] =
    planted.length > 0
      ? planted
          .slice(0, MAX_TAPS)
          .map((m) => ({ kind: "tend" as const, momentId: m.id, label: label(m) }))
      : Object.values(v.habits)
          .filter((h) => !h.isArchived && h.phase === phase.phase)
          .sort(byOrder)
          .sort(relevance(v.areas, cwd))
          .slice(0, MAX_TAPS)
          .map((h) => ({ kind: "plant" as const, habitId: h.id, label: `+ ${label(h)}` }));
  // No taps still keeps the band, and its search, while there are habits to find.
  if (taps.length === 0 && !Object.values(v.habits).some((h) => !h.isArchived)) return { status, band: null };

  const line = active
    ? `≋ ${active.name} ${fromPhase !== null ? "is" : "was"} ${why}`
    : `≋ ${planted.length > 0 ? "No intention" : "Nothing planted"} ${thisPhase(phase.label)}`;
  return { status, band: { day: today, phase: phase.phase, line, taps } };
}
