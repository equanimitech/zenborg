/**
 * Delivery events — pure builders for the three reserved intervention kinds.
 *
 * **Interventions are log events, not a second collection.** The event taxonomy
 * reserved `intervention_shown`, `intervention_dismissed` and
 * `intervention_clicked_through` under P5, and reserved means the name is
 * claimed and the first writer creates it. This is that writer. Standing an
 * `interventions/` collection up beside `logs` would give one fact two homes,
 * which is the drift the unification exists to remove — and it would put the
 * settlement of a proximal outcome in a different stream from the attention it
 * is settled against.
 *
 * Grammar: each is a **completion** (past tense), carries no `durationMs`
 * because no interval was measured, and carries domains only.
 *
 * Contract: `docs/event-taxonomy.md`.
 */

import type { ActivityEvent } from "../domain";
import { buildBrowserEvent } from "../activity/events";

/**
 * The three kinds a delivery produces. `intervention_effective` is reserved
 * too, but it is `settleProximalOutcome`'s verdict — a read-side derivation
 * over these — so this surface deliberately never writes it.
 */
export const INTERVENTION_KINDS = [
  "intervention_shown",
  "intervention_dismissed",
  "intervention_clicked_through",
] as const;

export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

/** Which primitive was delivered. Kept coarse — the rule id carries the rest. */
export type DeliveredPrimitive = "gate" | "cooldown";

export interface InterventionEventInput {
  readonly kind: InterventionKind;
  readonly ruleId: string;
  /** Browser-attested, from `sender.tab.url`. Never from the page's message. */
  readonly domain: string;
  readonly primitive: DeliveredPrimitive;
  readonly id: string;
  readonly ts: number;
  readonly sessionId: string;
}

export function interventionEvent(input: InterventionEventInput): ActivityEvent {
  return buildBrowserEvent({
    id: input.id,
    kind: input.kind,
    ts: input.ts,
    sessionId: input.sessionId,
    payload: { domain: input.domain, ruleId: input.ruleId, primitive: input.primitive },
  });
}

/**
 * One decision point: a moment the rule COULD have asked, drawn against its
 * `deliveryProbability`. Written for the withheld arm too, so the micro-randomised
 * comparison has both sides. Domains only; never a URL.
 */
export interface DecisionPoint {
  readonly ruleId: string;
  readonly trigger: "dwell" | "entry" | "click";
  /** True = the overlay was shown. */
  readonly delivered: boolean;
  /** The rule's deliveryProbability (1 if absent). */
  readonly p: number;
  /** The uniform draw in [0,1); delivered iff draw < p, unless superseded. */
  readonly draw: number;
  readonly rung: number;
  readonly windowMs: number;
  readonly servesAreaId?: string;
  /** Present on every withheld point. */
  readonly reason?: "draw" | "superseded";
}

export const DEFAULT_WINDOW_MS = 600_000;

/** Reserved kind for the decision log; written by `decisionPointEvent`. */
export const DECISION_POINT_KIND = "decision_point";

export function decisionPointEvent(input: {
  readonly point: DecisionPoint;
  readonly domain: string;
  readonly id: string;
  readonly ts: number;
  readonly sessionId: string;
}): ActivityEvent {
  const { point: p } = input;
  return buildBrowserEvent({
    id: input.id,
    kind: DECISION_POINT_KIND,
    ts: input.ts,
    sessionId: input.sessionId,
    payload: {
      ruleId: p.ruleId,
      domain: input.domain,
      trigger: p.trigger,
      delivered: p.delivered,
      p: p.p,
      draw: p.draw,
      rung: p.rung,
      windowMs: p.windowMs,
      ...(p.servesAreaId === undefined ? {} : { servesAreaId: p.servesAreaId }),
      ...(p.reason === undefined ? {} : { reason: p.reason }),
    },
  });
}

/** What the page sends back once the person has chosen. */
export interface SettlementMessage {
  readonly type: "kairos-intervention-settled";
  readonly ruleId: string;
  readonly proceeded: boolean;
}

const MAX_RULE_ID = 128;

/**
 * Validate a settlement from an untrusted content script.
 *
 * The page may lie about *which* rule settled, but not about the domain — the
 * background takes that from the browser-attested sender tab, exactly as the
 * sensor channel does. What the page cannot do is decline to report: the
 * `intervention_shown` half is written background-side when the gate fires, so
 * a page that stays quiet leaves a shown with no settlement, which reads as
 * the abandonment it was.
 */
export function isSettlement(msg: unknown): msg is SettlementMessage {
  if (typeof msg !== "object" || msg === null) {
    return false;
  }
  const m = msg as Record<string, unknown>;
  if (m.type !== "kairos-intervention-settled") {
    return false;
  }
  if (typeof m.ruleId !== "string" || m.ruleId.length === 0 || m.ruleId.length > MAX_RULE_ID) {
    return false;
  }
  return typeof m.proceeded === "boolean";
}

/**
 * Proceeding and leaving are different facts about the same delivery.
 *
 * `clicked_through` is not a failure and `dismissed` is not a success — which
 * of them the rule wanted is what its proximal outcome states, and settling
 * that is a read over this stream rather than a judgment made here.
 */
export function settlementKind(proceeded: boolean): InterventionKind {
  return proceeded ? "intervention_clicked_through" : "intervention_dismissed";
}
