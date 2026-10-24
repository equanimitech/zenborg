/**
 * Click gates: pure. No chrome APIs, no clock, no DOM beyond `matches`.
 *
 * A click gate stands in front of the control that STARTS the next round (a
 * game's Play, New game, Rematch), never in front of the round itself. A dwell
 * gate on a chess site fired with the clock running; the click is the one
 * moment that is a decision rather than an interruption.
 */

import type { DwellGate } from "./decide";

/** One rule's click selectors, as the page needs them. */
export interface ClickGate {
  readonly ruleId: string;
  readonly selectors: readonly string[];
}

/** The part of an `Element` the decision reads. */
export interface Matchable {
  matches(selector: string): boolean;
}

/**
 * Every click gate among `gates`, with the selectors of all its rungs.
 *
 * The union, not the current rung's: the page does not know the rung, and the
 * background re-checks it on every click, so a selector here only ever earns a
 * question to the background, never a firing on its own.
 */
export function clickGatesOf(gates: readonly DwellGate[]): readonly ClickGate[] {
  const out: ClickGate[] = [];
  for (const gate of gates) {
    const selectors = new Set(gate.click ?? []);
    for (const rung of gate.rungs ?? []) {
      for (const s of rung.click ?? []) selectors.add(s);
    }
    if (selectors.size > 0) out.push({ ruleId: gate.ruleId, selectors: [...selectors] });
  }
  return out;
}

function safeMatches(el: Matchable, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false; // An invalid selector is an authoring error, never a broken page.
  }
}

/**
 * Does this click land on a gated control?
 *
 * `path` is the event's composed path, target first, so "the target or an
 * ancestor" is one walk, and a control inside a shadow root is still found.
 * Returns the rule and the matching element (the one to replay the click on).
 */
export function clickGateHit<T extends Matchable>(
  path: readonly unknown[],
  gates: readonly ClickGate[]
): { readonly ruleId: string; readonly element: T } | null {
  for (const node of path) {
    if (typeof (node as Partial<Matchable> | null)?.matches !== "function") continue;
    const el = node as T;
    for (const gate of gates) {
      if (gate.selectors.some((s) => safeMatches(el, s))) {
        return { ruleId: gate.ruleId, element: el };
      }
    }
  }
  return null;
}

/**
 * The one-shot bypass for replaying a click the person chose to proceed with.
 *
 * `replay` lets exactly the dispatch it makes through: the flag is up only for
 * the synchronous duration of `dispatch`, so the next click, even on the same
 * control, is gated again.
 */
export function createReplay(): {
  readonly bypassing: () => boolean;
  readonly replay: (dispatch: () => void) => void;
} {
  let active = false;
  return {
    bypassing: () => active,
    replay(dispatch) {
      active = true;
      try {
        dispatch();
      } finally {
        active = false;
      }
    },
  };
}
