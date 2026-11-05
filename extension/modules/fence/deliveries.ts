/**
 * Today's deliveries per rule — neutral counts over the local log. Pure.
 *
 * No rates, no scores: a withheld point is not a failure and a continue is not a
 * success. Reads `decision_point` and the settlement kinds only.
 */

import type { ActivityEvent } from "../domain";

export interface DeliveryRow {
  readonly ruleId: string;
  readonly points: number;
  readonly shown: number;
  readonly withheld: number;
  readonly continued: number;
  readonly left: number;
}

/** Host events plus not-yet-flushed outbox events, deduped by `id` (host copy wins). */
export function mergeById<T extends { readonly id: string }>(host: readonly T[], outbox: readonly T[]): T[] {
  const seen = new Set(host.map((e) => e.id));
  return [...host, ...outbox.filter((e) => !seen.has((e as { id: string }).id))];
}

const EMPTY =(ruleId: string): DeliveryRow => ({
  ruleId,
  points: 0,
  shown: 0,
  withheld: 0,
  continued: 0,
  left: 0,
});

/** One row per rule that had a decision point in `events`, ordered by rule id. */
export function tallyDeliveries(events: readonly Pick<ActivityEvent, "kind" | "payload">[]): DeliveryRow[] {
  const rows = new Map<string, DeliveryRow>();
  const bump = (ruleId: string, f: (r: DeliveryRow) => DeliveryRow) =>
    rows.set(ruleId, f(rows.get(ruleId) ?? EMPTY(ruleId)));
  for (const e of events) {
    const ruleId = e.payload?.ruleId;
    if (typeof ruleId !== "string") continue;
    if (e.kind === "decision_point") {
      const delivered = e.payload?.delivered === true;
      bump(ruleId, (r) => ({
        ...r,
        points: r.points + 1,
        shown: r.shown + (delivered ? 1 : 0),
        withheld: r.withheld + (delivered ? 0 : 1),
      }));
    } else if (e.kind === "intervention_clicked_through") {
      bump(ruleId, (r) => ({ ...r, continued: r.continued + 1 }));
    } else if (e.kind === "intervention_dismissed") {
      bump(ruleId, (r) => ({ ...r, left: r.left + 1 }));
    }
  }
  // Settlements alone (no decision point today) are not a delivery row.
  return [...rows.values()].filter((r) => r.points > 0).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
