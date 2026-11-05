/**
 * Gate ladders — pure. Escalation by crossings, as data.
 *
 * A browser fence whose `primitives` holds more than one `gate` is a ladder: each rung is
 * a full gate (own dwell interval, friction, labels). A crossing is one "proceed" on that
 * rule today; the next firing lands on rung `min(crossings, last)`. Mirrors `rungFor` in
 * `src/domain/intervention/rules/sessionFence.ts` (clamp at the last rung).
 */

import type { DwellGate } from "./decide";

/** Crossings per rule for one local day. A new day key reads as empty. */
export interface Crossings {
  readonly day: string;
  readonly counts: Readonly<Record<string, number>>;
}

export const NO_CROSSINGS: Crossings = { day: "", counts: {} };

export function crossingsOf(state: Crossings, day: string, ruleId: string): number {
  return state.day === day ? (state.counts[ruleId] ?? 0) : 0;
}

/** Count one proceed. Rolls the state over when the day has changed. */
export function recordCrossing(state: Crossings, day: string, ruleId: string): Crossings {
  const counts = state.day === day ? state.counts : {};
  return { day, counts: { ...counts, [ruleId]: (counts[ruleId] ?? 0) + 1 } };
}

/** Which rung a rule is on: 0 for a single-gate rule, clamped at the last rung. */
export function rungIndex(rungCount: number, crossings: number): number {
  const n = Number.isFinite(crossings) ? Math.max(0, Math.floor(crossings)) : 0;
  return Math.max(0, Math.min(n, rungCount - 1));
}

/** The gate as it stands at `crossings`: the current rung's fields laid over the rule. */
export function gateAtRung(gate: DwellGate, crossings: number): { gate: DwellGate; rung: number } {
  const rungs = gate.rungs;
  if (rungs === undefined || rungs.length < 2) {
    return { gate, rung: 0 };
  }
  const rung = rungIndex(rungs.length, crossings);
  return { gate: { ...gate, ...rungs[rung] }, rung };
}
