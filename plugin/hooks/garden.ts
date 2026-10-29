/**
 * The garden as the moment band reads it. Pure: no I/O, so it runs under
 * `node --test` and inside the Claude Code mod alike.
 */
import type { Band, Tap } from "../types";
import { staleReason, wakingDayKey } from "../domain/attention/ActiveMoment.ts";

export interface PhaseConfig {
  phase: string;
  label: string;
  emoji?: string | null;
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
  cyclePlanId?: string | null;
  habitId?: string | null;
  durationMin?: number | null;
}
export interface Habit extends Named {
  id: string;
  phase?: string | null;
  isArchived?: boolean;
  /** "PRUNING" marks a deliberate taper. */
  attitude?: string | null;
}
export interface Cycle {
  id: string;
  /** "YYYY-MM-DD", inclusive both ends. */
  startDate: string;
  endDate: string;
  /** What each area means this season, in the gardener's words. */
  areaIntentions?: Record<string, string>;
}
export interface Area {
  id: string;
  name: string;
  emoji?: string | null;
  order?: number;
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
  cycles: Record<string, Cycle>;
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
  return matchNamed(Object.values(habits).filter((h) => !h.isArchived), query).slice(0, limit);
}

/** Items whose name contains the query, accent- and case-folded; prefix matches first, then by order. */
export function matchNamed<T extends Named>(items: T[], query: string): T[] {
  const q = fold(query.trim());
  if (!q) return [];
  const byOrder = (a: Named, b: Named) => (a.order ?? 0) - (b.order ?? 0);
  const hits = items.filter((x) => fold(x.name).includes(q)).sort(byOrder);
  return [...hits.filter((x) => fold(x.name).startsWith(q)), ...hits.filter((x) => !fold(x.name).startsWith(q))];
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
    const dur = active.durationMin;
    const time = !v.active.at
      ? ""
      : dur
        ? ageMin < dur
          ? ` · ${Math.ceil(dur - ageMin)}m left`
          : ""
        : ` · ${Math.floor(Math.max(ageMin, 0))}m`;
    return { status: `≋ ${label(active)}${time}`, band: null };
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

export type NowPlan =
  | { kind: "reply"; text: string }
  | { kind: "set"; momentId: string; text: string }
  | { kind: "move"; momentId: string; day: string; phase: string; text: string }
  | { kind: "plant"; habitId: string; day: string; phase: string; text: string }
  | { kind: "create"; name: string; areaId?: string; day: string; phase: string; text: string };

/**
 * What `/now <words>` does: a planted moment (this phase, then another), a
 * drawing-board moment, a habit, else a new standalone moment. Pure.
 */
export function resolveNow(v: Vault, words: string, now: Date, cwd?: string): NowPlan {
  const phase = currentPhase(Object.values(v.phases), now);
  if (!phase) return { kind: "reply", text: "now: no phase right now" };
  const today = wakingDayKey(now);
  const label = labelOf(v.areas);
  const moments = Object.values(v.moments);
  const planted = moments.filter((m) => m.day === today);
  const here = planted.filter((m) => m.phase === phase.phase);
  const q = words.trim().replace(/\s+/g, " ");

  if (!q) {
    const names = here.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((m) => m.name);
    return { kind: "reply", text: names.length ? `now: ${names.join(" · ")}` : "now: nothing planted this phase" };
  }

  const steps: [Moment[], (m: Moment) => NowPlan][] = [
    [here, (m) => ({ kind: "set", momentId: m.id, text: `≋ ${label(m)}, now` })],
    [planted, (m) => ({ kind: "set", momentId: m.id, text: `≋ ${label(m)}, now` })],
    [
      moments.filter((m) => !m.day),
      (m) => ({ kind: "move", momentId: m.id, day: today, phase: phase.phase, text: `≋ ${label(m)}, from the board` }),
    ],
  ];
  for (const [pool, plan] of steps) {
    const hit = matchNamed(pool, q)[0];
    if (hit) return plan(hit);
  }
  const habit = matchHabits(v.habits, q, 1)[0];
  if (habit) {
    return { kind: "plant", habitId: habit.id, day: today, phase: phase.phase, text: `≋ ${label(habit)}, planted` };
  }

  if (q.split(" ").length > 3) return { kind: "reply", text: "now: 3 words or fewer, nothing changed" };
  const areaId = areaOfCwd(v.areas, cwd);
  const area = areaId ? v.areas[areaId] : undefined;
  return {
    kind: "create",
    name: q,
    areaId,
    day: today,
    phase: phase.phase,
    text: `≋ new moment "${q}" planted${area ? ` in ${area.name}` : ""}`,
  };
}
