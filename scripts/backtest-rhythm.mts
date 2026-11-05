/**
 * Backtests `rhythmRow` against the real vault (read only), printing aggregates
 * only: top-3 and top-5 precision and recall over the day-phases of the 28 days
 * before a date, each scored on history strictly before that day-phase.
 *
 *   node scripts/backtest-rhythm.mts [YYYY-MM-DD]   (default: today)
 *
 * The target day-phase's own moments are removed from the vault first, so the
 * "already planted here" exclusion cannot leak the answer.
 */
import { readFileSync } from "node:fs";
import { addDays } from "../plugin/hooks/board.ts";
import { rhythmRow } from "../plugin/hooks/suggest.ts";

const root = process.env.ZENBORG_HOME ?? `${process.env.HOME}/.zenborg`;
const read = (f: string) => {
  try {
    return JSON.parse(readFileSync(`${root}/${f}`, "utf8")) ?? {};
  } catch {
    return {};
  }
};
const moments: Record<string, { habitId?: string; day?: string; phase?: string }> = read("moments.json");
const vault = { active: {}, moments, habits: read("habits.json"), areas: read("areas.json"), phases: {}, cycles: {} };

const end = process.argv[2] ?? new Date().toLocaleDateString("sv");
const PHASES = ["MORNING", "AFTERNOON", "EVENING", "NIGHT"];
const tally = { n: 0, 3: { hit: 0, offered: 0 }, 5: { hit: 0, offered: 0 }, actual: 0 };
for (let i = 1; i <= 28; i++) {
  const day = addDays(end, -i);
  for (const phase of PHASES) {
    const at = (m: { day?: string; phase?: string }) => m.day === day && m.phase === phase;
    const actual = new Set(Object.values(moments).filter((m) => at(m) && m.habitId).map((m) => m.habitId as string));
    if (actual.size === 0) continue;
    const without = { ...vault, moments: Object.fromEntries(Object.entries(moments).filter(([, m]) => !at(m))) };
    tally.n++;
    tally.actual += actual.size;
    for (const k of [3, 5] as const) {
      const picks = rhythmRow(without, { day, phase }, day, { limit: k });
      tally[k].offered += picks.length;
      tally[k].hit += picks.filter((s) => actual.has(s.habitId)).length;
    }
  }
}
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
console.log(`${tally.n} day-phases before ${end}`);
for (const k of [3, 5] as const) {
  console.log(`top-${k}: precision ${pct(tally[k].hit, tally[k].offered)}, recall ${pct(tally[k].hit, tally.actual)}`);
}
