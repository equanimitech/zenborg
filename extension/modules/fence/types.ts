/**
 * The unified Fence type — what is in force right now, as the extension sees it.
 *
 * Replaces the retired `ArmedIntervention` from the old interventions module. The key
 * change from that type: `primitive` splits into `enforcement`, which
 * distinguishes `block` (what `cooldown` primitives become) from `gate`. Same
 * two primitives a browser can actuate, same invariant 6 — the type just
 * carries the name the rest of the rebuild uses.
 *
 * ── Invariant 6 is enforced at the parse boundary ───────────────────────
 *
 * `parseFences` (in `parse.ts`) refuses any entry that carries no reachable
 * exit. Sovereignty rests on the exit, not on who set the
 * fence, so a block with no visible way out is a bug rather than a stricter
 * shield.
 *
 * This file is pure: no chrome APIs, no clock, no storage.
 */

import type { GateFriction } from "../friction/gate/decide";

/**
 * The desugared primitive, narrowed to what a browser can actuate.
 *
 * The domain speaks seven primitives; two of them reach a page. `transform`
 * already has its own mirror and interpreter, and `observe`, `schedule`,
 * `intercept` and `actuate` are refused here rather than half-implemented.
 */
export type FenceEnforcement =
  | {
      readonly kind: "block";
      /** `standing` never lapses — what the blocklist has always been. */
      readonly standing: boolean;
      /** Where a lockout is applied. Only `browser` is this surface's to enforce. */
      readonly enforcement: "browser" | "resolver" | "device";
      /**
       * Browser only. `navigation` blocks page loads (main_frame, sub_frame) and
       * spares an open page's sockets; absent means every resource type.
       */
      readonly reach?: "navigation";
    }
  | {
      readonly kind: "gate";
      readonly everyMinutes: number;
      readonly friction: GateFriction;
      /** A click trigger's selectors, primary first. Present means the gate fires
       * on a click on a match, never on dwell. */
      readonly click?: readonly string[];
      /** An entry trigger: the gate asks once on arrival at the host, never on dwell. */
      readonly entry?: true;
    };

/**
 * The exit, in the one shape that covers both primitives.
 *
 * `continue` / `redirect` / `abort` come from a gate's `proceedAffordance`;
 * `wait` / `intention` / `delay` / `out_of_band` from a block's `unlockPath`.
 * A costly exit is still an exit — `out_of_band` is deliberately outside the
 * running system so it cannot be taken in the moment of wanting — but an
 * *absent* one is not, and neither is one with nothing to read.
 */
export interface ProceedAffordance {
  readonly label: string;
  readonly action:
    | { readonly type: "continue" }
    | { readonly type: "redirect"; readonly to: string }
    | { readonly type: "abort" }
    | { readonly type: "wait" }
    | { readonly type: "intention"; readonly prompt: string }
    | { readonly type: "delay"; readonly seconds: number }
    | { readonly type: "out_of_band"; readonly note: string };
}

export interface ScheduleWindow {
  readonly fromHour: number;
  readonly toHour: number;
  readonly weekdays?: readonly string[];
  readonly outsideWindow: "inactive" | "passthrough";
}

export interface GateRungSpec {
  readonly everyMinutes: number;
  readonly friction: GateFriction;
  readonly click?: readonly string[];
  readonly entry?: true;
  readonly proceed: ProceedAffordance;
  readonly abort?: { readonly label: string };
}

export interface Fence {
  readonly id: string;
  /** What the person called it. Shown wherever the exit is shown. */
  readonly label: string;
  /** Registrable hosts. Domains only — never URLs, never paths. */
  readonly domains: readonly string[];
  readonly enforcement: FenceEnforcement;
  readonly proceed: ProceedAffordance;
  readonly abort?: { readonly label: string };
  /** Ladder rungs (two or more gates), rung 0 first; top-level fields mirror rung 0. */
  readonly rungs?: readonly GateRungSpec[];
  /** When set, the fence holds inside this window (and outside it only on `passthrough`). */
  readonly schedule?: ScheduleWindow;
  /**
   * From `RuleSpec.deliveryProbability`. `1` means the rule never withholds;
   * anything below it buys the comparison condition a proximal outcome needs.
   */
  readonly deliveryProbability: number;
  /** From the vault record's `outcome.windowMs`, carried to `decision_point`. */
  readonly windowMs?: number;
  /** From the vault record's `serves.areaId`. */
  readonly servesAreaId?: string;
}

/** The cache, keyed by fence id — the shape of the pushed record. */
export type Fences = Readonly<Record<string, Fence>>;

export type RefusalReason = "no_exit" | "no_domains" | "unactuatable";

export interface Refusal {
  readonly id: string;
  readonly reason: RefusalReason;
}

export interface ParsedFences {
  readonly fences: Fences;
  /** Entries the door turned away. Reported, never silently dropped. */
  readonly refused: readonly Refusal[];
}
