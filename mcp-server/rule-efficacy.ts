/**
 * get_rule_efficacy: delivered vs withheld, per browser rule.
 *
 * Reads `decision_point` events and browser dwell from the log and hands them
 * to the pure `ruleEfficacy`. The settle clock is `min(end of range, now)`:
 * a point whose window is still open stays unsettled.
 */
import {
  decisionPointsOf,
  ruleEfficacy,
} from "../src/domain/intervention/browserEfficacy.ts";
import { readActivityLog } from "./activity-log.js";
import { midnight } from "./site-minutes.js";

const DAY_MS = 24 * 60 * 60_000;

export function getRuleEfficacy(
  dir: string,
  params: { ruleId?: string; from: string; to: string },
  now: number = Date.now(),
) {
  const from = midnight(params.from);
  const to = Math.min(midnight(params.to, 1), now);
  // A day either side: the settle walk needs the state before a window and
  // the events just after it.
  const events = readActivityLog(dir, from - DAY_MS, to + DAY_MS, ["browser"]);
  const points = decisionPointsOf(events).filter(
    (p) => !params.ruleId || p.ruleId === params.ruleId,
  );
  const rules = ruleEfficacy(points, events, { from, to });
  return {
    window: { from: params.from, to: params.to },
    outcome:
      "attended minutes on the rule's host in the window after each decision point",
    rules,
    ...(rules.length === 0
      ? { note: "No decision_point events in this range." }
      : {}),
  };
}

/** Concise keeps each rule's arms and line; full adds the rung and trigger splits. */
export function conciseRuleEfficacy(payload: unknown): unknown {
  const p = payload as ReturnType<typeof getRuleEfficacy>;
  return {
    ...p,
    rules: p.rules.map(({ byRung: _r, byTrigger: _t, ...rest }) => rest),
  };
}
