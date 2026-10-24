/**
 * Gate decision — the effectful half. Reads the local event log, computes
 * dwell, and answers "should this page be gated right now?".
 *
 * Dwell is computed with `bouts()` from the domain module, deliberately: it is the
 * same function `tide` and every retrospective read through, so the number the
 * gate acts on is the number the analysis reports. A second dwell
 * implementation here would be a second answer to "how long was I on YouTube",
 * and the two would drift.
 */

import { bouts, createDomain } from "../../domain";
import { startOfLocalDay } from "@/modules/activity/events";
import { queryEvents } from "@/modules/relay/client";
import { storage } from "wxt/storage";
import { crossingsOf, gateAtRung, NO_CROSSINGS, recordCrossing, type Crossings } from "./ladder";
import { isArrival } from "./arrival";
import { nextFiredAt, shouldGate, type GateReading } from "./state";

/**
 * What the gate asks of you when it fires — the author's declared mechanism, carried
 * whole rather than flattened to a string.
 *
 * `delay` and `breath` put the cost on CONTINUING. Nothing here ever delays leaving:
 * the abort affordance is live from the first frame, because friction on stopping is
 * punishment, and punishment is on the repo's documented-failure list.
 */
export type GateFriction =
  | { readonly type: "intention"; readonly prompt: string }
  | { readonly type: "confirmation" }
  | { readonly type: "delay"; readonly seconds: number }
  | { readonly type: "breath"; readonly cycles: number };

/** One rung of a ladder: everything that varies as the person crosses. */
export interface DwellRung {
  readonly everyMinutes: number;
  readonly friction: GateFriction;
  /** Click-trigger selectors for this rung; absent means a dwell rung. */
  readonly click?: readonly string[];
  /** Entry-trigger rung; absent means dwell (or click). */
  readonly entry?: true;
  readonly proceed: DwellGate["proceed"];
  readonly abort: DwellGate["abort"];
}

/** A dwell gate as the extension sees it, pulled from ~/.zenborg/keel/rules. */
export interface DwellGate {
  readonly ruleId: string;
  readonly domains: readonly string[];
  readonly everyMinutes: number;
  readonly friction: GateFriction;
  readonly proceed: {
    readonly label: string;
    readonly action:
      | { readonly type: "continue" }
      | { readonly type: "redirect"; readonly to: string }
      | { readonly type: "abort" };
  };
  readonly abort: { readonly label: string };
  /**
   * Click trigger: the selectors of the controls this gate stands in front of.
   * Present, the gate fires on a click on a match (`evaluateClickGate`) and never
   * on dwell; absent, it is a dwell gate.
   */
  readonly click?: readonly string[];
  /**
   * Entry trigger: the gate asks once when the person arrives at the host (`isArrival`)
   * and never on dwell. Absent, it is a dwell gate (or a click gate).
   */
  readonly entry?: true;
  /** `RuleSpec.deliveryProbability`, when below 1. Drawn per click and per entry firing. */
  readonly deliveryProbability?: number;
  /** Ladder: two or more rungs, indexed by today's crossings. Top-level fields mirror rung 0. */
  readonly rungs?: readonly DwellRung[];
  /** @deprecated Pre-2026-08-08 mirror shape. Read only by `normalizeGate`. */
  readonly prompt?: string;
}

/**
 * Accept a mirror written by an older host.
 *
 * The policy mirror survives extension restarts, so between an extension update and the
 * next policy pull the stored gates are still `{ruleId, domains, everyMinutes, prompt}`.
 * Reading that shape as the new one would render a gate with no friction and no labels —
 * failing toward a blank interstitial, which is worse than the old behaviour.
 */
export function normalizeGate(gate: DwellGate): DwellGate {
  if (gate.friction !== undefined && gate.proceed !== undefined) {
    return gate;
  }
  return {
    ...gate,
    friction: gate.friction ?? {
      type: "intention",
      prompt: gate.prompt ?? "Still what you came for?",
    },
    proceed: gate.proceed ?? { label: "Keep watching", action: { type: "continue" } },
    abort: gate.abort ?? { label: "Close the tab" },
  };
}

/** Dwell reading at which each gate last fired, keyed by rule id. Day-scoped. */
export const gateFiredAt = storage.defineItem<Record<string, number>>("local:friction:gateFiredAt", {
  fallback: {},
});

/** The day the fired-at map belongs to; a new day resets it. */
export const gateFiredDay = storage.defineItem<string>("local:friction:gateFiredDay", {
  fallback: "",
});

/** When each entry gate last saw an attended poll, keyed by rule id. Background only. */
export const gateLastSeen = storage.defineItem<Record<string, number>>("local:friction:gateLastSeen", {
  fallback: {},
});

/** Proceeds per rule today — the ladder's position. Written only by the background. */
export const gateCrossings = storage.defineItem<Crossings>("local:friction:gateCrossings", {
  fallback: NO_CROSSINGS,
});

/**
 * Day key on the SAME boundary the dwell read uses.
 *
 * These must not disagree. `dwellTodayFor` reads from `startOfLocalDay`, so a
 * UTC-based key would leave a window (two hours, in Paris in August) where
 * dwell has already reset to ~0 while `lastFiredAtMs` still holds the previous
 * day's total — during which the gate silently never fires. That window falls
 * just after local midnight, which is exactly when a long night session is
 * running.
 */
export function dayKey(now: number): string {
  return String(startOfLocalDay(now));
}

/** Attended ms today across `domains`, via the shared bout derivation.
 *
 * Reads from the native host (the store) rather than the local IndexedDB
 * outbox: the relay deletes events on ack, so after a flush the outbox
 * holds at most a few minutes of events — never enough for a multi-minute
 * gate threshold. The host holds the full day. When the host is unreachable,
 * queryEvents returns [] — but then no events have been flushed either, so
 * the outbox would be equally empty. */
export async function dwellTodayFor(
  domains: readonly string[],
  now: number = Date.now()
): Promise<number> {
  const wanted = new Set(domains.map((d) => createDomain(d)));
  const events = await queryEvents(startOfLocalDay(now));
  let total = 0;
  for (const bout of bouts(events)) {
    for (const [domain, ms] of bout.byDomain) {
      if (wanted.has(domain)) {
        total += ms;
      }
    }
  }
  return total;
}

export interface GateVerdict {
  readonly fire: boolean;
  readonly dwellMs: number;
  /**
   * Which rule fired. Present only on a firing, and it travels all the way to
   * the page and back so the delivery and its settlement name the same thing —
   * an `intervention_shown` nobody can join to its outcome settles nothing.
   */
  readonly ruleId?: string;
  readonly friction?: GateFriction;
  readonly proceed?: DwellGate["proceed"];
  readonly abort?: DwellGate["abort"];
  /** Rung index the rule was on when it fired; 0 for a single-gate rule. */
  readonly rung?: number;
  /** Interval of the rung that fired, for picking among rules. */
  readonly everyMinutes?: number;
}

/** The person chose to proceed on `ruleId`: one more crossing today. Background only. */
export async function recordProceed(ruleId: string, now: number = Date.now()): Promise<void> {
  await gateCrossings.setValue(recordCrossing(await gateCrossings.getValue(), dayKey(now), ruleId));
}

/**
 * Decide whether `gate` should fire, and record the firing if so.
 *
 * Recording happens here rather than in the content script because the content
 * script is untrusted and can be reloaded at will — a page that could decline
 * to report "I showed the gate" would get a free pass by refreshing.
 */
export async function evaluateGate(
  gate: DwellGate,
  now: number = Date.now(),
  draw: number = Math.random()
): Promise<GateVerdict> {
  const base = normalizeGate(gate);
  const today = dayKey(now);
  if ((await gateFiredDay.getValue()) !== today) {
    await gateFiredDay.setValue(today);
    await gateFiredAt.setValue({});
  }

  const { gate: g, rung } = gateAtRung(
    base,
    crossingsOf(await gateCrossings.getValue(), today, base.ruleId)
  );
  // A click rung never fires on dwell: that is the mid-game interruption it exists to end.
  if (g.click !== undefined) {
    return { fire: false, dwellMs: 0 };
  }
  if (g.entry) {
    // Every attended poll refreshes the stay; only the first after a long absence asks.
    // A withheld delivery (the draw) still consumes the arrival: once per visit, not
    // "retry on the next poll until the dice land".
    const seen = await gateLastSeen.getValue();
    const arrived = isArrival(seen[g.ruleId] ?? null, now);
    await gateLastSeen.setValue({ ...seen, [g.ruleId]: now });
    if (!arrived || draw >= (g.deliveryProbability ?? 1)) {
      return { fire: false, dwellMs: 0 };
    }
    return {
      fire: true,
      dwellMs: await dwellTodayFor(g.domains, now),
      ruleId: g.ruleId,
      friction: g.friction,
      proceed: g.proceed,
      abort: g.abort,
      rung,
      everyMinutes: g.everyMinutes,
    };
  }
  const dwellMs = await dwellTodayFor(g.domains, now);
  const fired = await gateFiredAt.getValue();
  const reading: GateReading = {
    dwellMs,
    lastFiredAtMs: fired[g.ruleId] ?? 0,
    everyMs: g.everyMinutes * 60_000,
  };

  if (!shouldGate(reading)) {
    return { fire: false, dwellMs };
  }
  await gateFiredAt.setValue({ ...fired, [g.ruleId]: nextFiredAt(reading) });
  return {
    fire: true,
    dwellMs,
    ruleId: g.ruleId,
    friction: g.friction,
    proceed: g.proceed,
    abort: g.abort,
    rung,
    everyMinutes: g.everyMinutes,
  };
}

/**
 * The verdict for a click on one of `gate`'s controls.
 *
 * The click itself is the decision point, so there is no interval to check: the
 * rung is today's crossings, and the only reason not to fire is the delivery
 * draw. `draw` is injectable so a test can pin it. A withheld delivery writes
 * nothing; the click goes through as if no gate were there.
 */
export async function evaluateClickGate(
  gate: DwellGate,
  now: number = Date.now(),
  draw: number = Math.random()
): Promise<GateVerdict> {
  const base = normalizeGate(gate);
  const { gate: g, rung } = gateAtRung(
    base,
    crossingsOf(await gateCrossings.getValue(), dayKey(now), base.ruleId)
  );
  if (g.click === undefined || draw >= (g.deliveryProbability ?? 1)) {
    return { fire: false, dwellMs: 0 };
  }
  return {
    fire: true,
    dwellMs: await dwellTodayFor(g.domains, now),
    ruleId: g.ruleId,
    friction: g.friction,
    proceed: g.proceed,
    abort: g.abort,
    rung,
    everyMinutes: g.everyMinutes,
  };
}

/**
 * A redirect target, or `null` if it is not one zenborg will navigate to.
 *
 * Mirrors `safeRedirect` in `apps/plugin/store.mjs`. Duplicated rather than shared
 * because the agent is plain `@ts-check` JS that deploys standalone and cannot import
 * from a TS package — the same constraint that makes the kernel a contract rather than
 * a package. Two short functions with one behaviour, tested on both sides.
 */
export function safeRedirect(to: unknown): string | null {
  if (typeof to !== "string" || !to.trim()) {
    return null;
  }
  const url = to.trim();
  if (url.startsWith("/") && !url.startsWith("//")) {
    return url;
  }
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Every gate covering `domain`. */
export function gatesFor(gates: readonly DwellGate[], domain: string): DwellGate[] {
  return gates.filter((gate) => gate.domains.includes(domain));
}

/** The first gate covering `domain`, or null. Used for the arm handshake, which only
 * asks "is this domain gated at all". */
export function gateFor(gates: readonly DwellGate[], domain: string): DwellGate | null {
  return gatesFor(gates, domain)[0] ?? null;
}

/**
 * Evaluate every gate on a domain and surface the most demanding one that fired.
 *
 * Two things this fixes at once.
 *
 * **A second rule on a domain used to be silently dropped.** `gateFor` returned the
 * first match and nothing else was ever consulted, so authoring a second YouTube gate
 * produced a rule file that did nothing — the same shape of failure as the dead
 * selectors, and the reason escalation could not be expressed as data.
 *
 * **Escalation is now just several rules.** A cheap cue every 20 minutes and a longer
 * beat every 60 are two rules, not a new primitive. When both come due on the same
 * poll, the rarer one wins: a larger interval is the later stage of a progression, and
 * the later stage is the one worth showing. The overlay never stacks.
 *
 * Every due gate is still RECORDED, including the ones not shown. Skipping that would
 * leave the cheap gate perpetually due, so it would fire on the very next poll — thirty
 * seconds after the expensive one, which is how a stopping cue becomes noise.
 */
export async function evaluateGates(
  gates: readonly DwellGate[],
  now: number = Date.now()
): Promise<GateVerdict> {
  let best: GateVerdict = { fire: false, dwellMs: 0 };
  let bestEvery = -1;
  for (const gate of gates) {
    const verdict = await evaluateGate(gate, now);
    if (!verdict.fire) {
      if (!best.fire) {
        best = { ...best, dwellMs: Math.max(best.dwellMs, verdict.dwellMs) };
      }
      continue;
    }
    const every = verdict.everyMinutes ?? gate.everyMinutes;
    if (!best.fire || every > bestEvery) {
      best = verdict;
      bestEvery = every;
    }
  }
  return best;
}
