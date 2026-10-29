/**
 * What the phase pane suggests planting: the gardener's own rhythm for the
 * shown phase, and season intentions gone quiet. A mirror of past plantings,
 * never a score. Pure: no I/O, so it runs under `node --test` and inside the
 * Claude Code mod alike.
 */
import type { BoardView } from "../types";
import { addDays } from "./board.ts";
import { labelOf, type Cycle, type Habit, type Vault } from "./garden.ts";

const LOOKBACK_DAYS = 56;
const HALF_LIFE_DAYS = 21;
const SAME_WEEKDAY = 4;
const RHYTHM_ROWS = 3;
const SEASON_ROWS = 2;

/** One habit offered for planting; `note` is neutral history ("last planted 9 days ago"). */
export interface Suggestion {
  habitId: string;
  label: string;
  note?: string;
}
interface Opts {
  /** Habit ids to leave out, e.g. hidden for the waking day. */
  skip?: ReadonlySet<string>;
  /** The shown (day, phase): habits already planted there are left out. */
  view?: BoardView;
  limit?: number;
}

const epochDay = (day: string) => {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const weekdayOf = (day: string) => (epochDay(day) + 4) % 7; // 1970-01-01 was a Thursday
const daysBetween = (from: string, to: string) => epochDay(to) - epochDay(from);

/** Unarchived habits that are not being tapered: the only ones ever offered. */
const offerable = (h: Habit | undefined): h is Habit => !!h && !h.isArchived && h.attitude !== "PRUNING";

/** Days (YYYY-MM-DD) each habit was planted on, from moments set on a day. */
function plantedDays(v: Vault): Map<string, string[]> {
  const byHabit = new Map<string, string[]>();
  for (const m of Object.values(v.moments)) {
    if (!m.habitId || !m.day) continue;
    byHabit.set(m.habitId, [...(byHabit.get(m.habitId) ?? []), m.day]);
  }
  return byHabit;
}

const plantedAt = (v: Vault, view?: BoardView) =>
  new Set(
    view
      ? Object.values(v.moments)
          .filter((m) => m.habitId && m.day === view.day && m.phase === view.phase)
          .map((m) => m.habitId as string)
      : [],
  );

/**
 * The habits planted most in `view.phase` over the 56 days before `today`:
 * a 21-day half-life, `view.day`'s weekday counting x4. Habits already in the
 * shown (day, phase) and `opts.skip` are left out. Top 3 unless `opts.limit`.
 */
export function rhythmRow(v: Vault, view: BoardView, today: string, opts: Opts = {}): Suggestion[] {
  const from = addDays(today, -LOOKBACK_DAYS);
  const wd = weekdayOf(view.day);
  const score = new Map<string, number>();
  for (const m of Object.values(v.moments)) {
    if (!m.habitId || !m.day || m.phase !== view.phase || m.day < from || m.day >= today) continue;
    const w = 0.5 ** (daysBetween(m.day, today) / HALF_LIFE_DAYS) * (weekdayOf(m.day) === wd ? SAME_WEEKDAY : 1);
    score.set(m.habitId, (score.get(m.habitId) ?? 0) + w);
  }
  const here = plantedAt(v, { day: view.day, phase: view.phase });
  const label = labelOf(v.areas);
  return [...score]
    .filter(([id]) => offerable(v.habits[id]) && !here.has(id) && !opts.skip?.has(id))
    .sort(([ia, a], [ib, b]) => b - a || ia.localeCompare(ib))
    .slice(0, opts.limit ?? RHYTHM_ROWS)
    .map(([id]) => ({ habitId: id, label: label(v.habits[id] as Habit) }));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** The cycle whose dates contain `today`, if any. */
export const runningCycle = (v: Vault, today: string): Cycle | undefined =>
  Object.values(v.cycles).find((c) => c.startDate.slice(0, 10) <= today && today <= c.endDate.slice(0, 10));

/**
 * The running cycle's area intentions gone quiet. `matches` maps an area id to
 * the habit ids its intention means (Haiku's reading); an area missing from it
 * falls back to its most-planted habit, one Haiku answered with none gets no
 * row. An intention is quiet when days since any of its habits was planted
 * exceed their median gap between planting days over 56 days (floor 1; with
 * fewer than two planting days the gap is the whole 56). Each offers its
 * most-planted habit; the quietest come first, top 2 unless `opts.limit`.
 */
export function quietIntentions(v: Vault, today: string, matches: Record<string, string[]>, opts: Opts = {}): Suggestion[] {
  const cycle = runningCycle(v, today);
  if (!cycle) return [];
  const from = addDays(today, -LOOKBACK_DAYS);
  const days = plantedDays(v);
  const inWindow = (id: string) => (days.get(id) ?? []).filter((d) => d >= from && d <= today);
  const mostPlanted = (ids: string[]) =>
    [...ids].sort((a, b) => inWindow(b).length - inWindow(a).length || a.localeCompare(b))[0];
  const here = plantedAt(v, opts.view);
  const label = labelOf(v.areas);
  const out: { s: Suggestion; since: number }[] = [];
  for (const areaId of Object.keys(cycle.areaIntentions ?? {})) {
    const own = Object.values(v.habits).filter((h) => h.areaId === areaId && offerable(h)).map((h) => h.id);
    const ids = (matches[areaId] ?? (own.length ? [mostPlanted(own) as string] : [])).filter((id) => offerable(v.habits[id]));
    const pick = mostPlanted(ids);
    if (pick === undefined || here.has(pick) || opts.skip?.has(pick)) continue;
    const planted = ids.flatMap((id) => (days.get(id) ?? []).filter((d) => d <= today));
    const last = planted.sort().at(-1);
    const since = last === undefined ? Infinity : daysBetween(last, today);
    const distinct = [...new Set(ids.flatMap(inWindow))].sort();
    const gaps = distinct.slice(1).map((d, i) => daysBetween(distinct[i] as string, d));
    const quietAfter = Math.max(1, gaps.length ? median(gaps) : LOOKBACK_DAYS);
    if (since <= quietAfter) continue;
    const note = since === Infinity ? "not planted yet" : `last planted ${since} day${since === 1 ? "" : "s"} ago`;
    out.push({ s: { habitId: pick, label: label(v.habits[pick] as Habit), note }, since });
  }
  return out
    .sort((a, b) => b.since - a.since)
    .slice(0, opts.limit ?? SEASON_ROWS)
    .map((x) => x.s);
}

export const MATCH_SYSTEM = `You match a gardener's season intentions to their habits. Reply with only a JSON object, no prose, mapping each area id to the ids of the habits that intention means, e.g. {"<area id>":["<habit id>"]}. Use only habit ids listed under that area. An intention that fits none maps to [].`;

/** The prompt Haiku reads: each running-cycle intention with its area's offerable habits. Null when there is nothing to map. */
export function matchPrompt(v: Vault, cycle: Cycle): string | null {
  const areas = Object.entries(cycle.areaIntentions ?? {}).flatMap(([areaId, intention]) => {
    const habits = Object.values(v.habits)
      .filter((h) => h.areaId === areaId && offerable(h))
      .map((h) => ({ id: h.id, name: h.name }));
    return habits.length ? [{ areaId, intention, habits }] : [];
  });
  return areas.length ? JSON.stringify({ areas }) : null;
}

/**
 * Haiku's reply read strictly against the vault: the first JSON object in it,
 * each area's list cut to that area's offerable habit ids. An area the reply
 * leaves out maps to []. Null when the reply holds no object.
 */
export function parseMatches(v: Vault, cycle: Cycle, reply: string): Record<string, string[]> | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  let raw: unknown;
  try {
    raw = start >= 0 && end > start ? JSON.parse(reply.slice(start, end + 1)) : undefined;
  } catch {
    raw = undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const areaId of Object.keys(cycle.areaIntentions ?? {})) {
    const list = obj[areaId];
    out[areaId] = Array.isArray(list)
      ? list.filter((id): id is string => typeof id === "string" && v.habits[id]?.areaId === areaId && offerable(v.habits[id]))
      : [];
  }
  return out;
}
