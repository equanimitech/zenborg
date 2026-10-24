/**
 * The 7 foundational primitives.
 *
 * The domain speaks this layer and only this layer. `Notice`, `Suggestion`,
 * `GapWindow` and `HostBlock` are authoring sugar that desugars before anything
 * reaches the model, exactly as keel's contracts specify: the foundational layer
 * is contract, the intent layer is presentation, and the validator only ever sees
 * foundational primitives.
 *
 * Contract: `keel/docs/primitive-contracts.md`.
 *
 * There is deliberately no `AmbientPrimitive`. keel restricted which primitives a
 * rule could set by excluding CooldownSpec from a union; that restricted category
 * is gone. A rule may set any primitive, teeth included. What protects the person
 * is not who set the fence, it is that every standing fence can be got out of.
 */

import type { Weekday } from "../value-objects/Schedule";
import type { Phase } from "../value-objects/Phase";

/**
 * A chain of selectors for one logical target: the primary, plus fallbacks to
 * emit alongside it. Selectors rot — a site's build-time class names change
 * on the next deploy — so every selector in the chain is matched together
 * rather than primary-then-fallback. The failure mode this trades for is a
 * fallback broad enough to catch more than intended, which is an authoring
 * error visible instantly rather than a silently-dead rule.
 * Contract: `keel/docs/primitive-contracts.md`, "Shared types".
 */
export interface SelectorChain {
  readonly primary: string;
  readonly fallbacks: readonly string[];
}

export interface TransformSpec {
  readonly kind: "transform";
  readonly targets: SelectorChain;
  readonly replacement:
    | { readonly type: "hide" }
    | {
        readonly type: "restyle";
        readonly style: Readonly<Record<string, string>>;
      }
    | { readonly type: "text"; readonly content: string }
    | { readonly type: "template"; readonly templateId: string };
}

/**
 * When a gate fires.
 *
 * Two shapes, and the difference between them is whether there is an event to
 * hang on.
 *
 * `entry` is the decision point the rule's evaluation already produced — the
 * cross-area tool call, the crossing out of a fence, the gap opening, the
 * navigation into a scoped host. Something happened, the rule saw it, and the
 * gate stands in front of it. Every gate written before this type existed was an
 * `entry` gate; the case was implicit, and an absence is a worse way to say a
 * thing than a name.
 *
 * `dwell` is the case the absence could not express. It fires every
 * `everyMinutes` of *accumulated attended dwell* inside the rule's scope — a
 * recurring stopping cue, which is precisely what an engagement-optimised
 * surface removes on purpose. Not a wall-clock timer: a backgrounded tab and an
 * idle person do not accumulate, so it interrupts attending rather than merely
 * existing.
 *
 * The site you are already inside has no entry event left to gate. That is the
 * whole finding of `keel/docs/pain/2026-08-19-linkedin-reloads-the-feed-because-
 * it-is-on-the-wrong-primiti.md`: the alternative reached for was a standing
 * access-block, and a running SPA reads a blocked request as a transient network
 * failure and knocks again, forever. Overconsumption has no event to hang on;
 * the whole problem is that nothing happens.
 *
 * ── Why `entry` and not keel's `navigation` ─────────────────────────────
 *
 * keel's `GateTrigger` (`packages/domain/src/rules.ts`) names four: `navigation`,
 * `element_click`, `session_end`, `dwell`. It was authored for in-page shields,
 * where the only surface is a browser. `RuleScope` here was lifted off
 * browser-only so one rule vocabulary could drive the tray, the plugin and the
 * extension, and the trigger has to be lifted with it or the lift is undone at
 * the primitive. A `PreToolUse` crossing is not a navigation, and the three
 * session-surface rules in `rules/` would each have had to declare one falsely.
 * `entry` is the same shape of thing said at the surface-neutral altitude.
 *
 * `element_click` and `session_end` are deliberately absent rather than
 * overlooked. Nothing here arms them, keel wires neither, and vocabulary no
 * consumer agrees on is the optional escape hatch this field exists not to be.
 * They are one variant away the day a rule needs one.
 *
 * `everyMinutes` counts *attended* dwell, not wall-clock: a backgrounded tab or
 * an idle person does not accrue it. That is keel's contract for the same
 * trigger (`packages/domain/src/rules.ts`), carried over rather than re-derived.
 */
export type GateTrigger =
  | { readonly type: "entry" }
  | { readonly type: "dwell"; readonly everyMinutes: number };

/**
 * Interrupt an action with a surface the user must engage with to proceed.
 *
 * `proceedAffordance` is required, not optional. A gate without an exit does not
 * typecheck, which is what makes invariant 6 a property of the type rather than a
 * promise a validator has to keep.
 *
 * `trigger` is required for the same reason and by the same discipline: a field
 * every consumer must agree on is not a field some rules may omit. Its absence
 * used to mean `entry` by convention, and a convention is a thing a reader has
 * to already know.
 */
export interface GateSpec {
  readonly kind: "gate";
  readonly trigger: GateTrigger;
  readonly frictionType:
    | { readonly type: "confirmation" }
    | { readonly type: "intention"; readonly prompt: string }
    | { readonly type: "delay"; readonly seconds: number }
    | { readonly type: "breath"; readonly cycles: number };
  readonly proceedAffordance: {
    readonly label: string;
    readonly action:
      | { readonly type: "continue" }
      | { readonly type: "redirect"; readonly to: string }
      | { readonly type: "abort" };
  };
  readonly abortAffordance?: { readonly label: string };
}

/**
 * Temporal lockout after a triggering event.
 *
 * `unlockPath` is required for the same reason `proceedAffordance` is. This is
 * what makes a rule-set cooldown a boundary rather than a punishment, and it is
 * the structural answer to the Screen Time counter-evidence: teeth cannot stand
 * without a way out, whoever set them.
 */
/**
 * What a browser block stops. Absent means `all`, which is what a block has
 * always been.
 *
 * `navigation` stops page loads only (top-level and framed). A page already
 * open keeps its sockets and requests, so a schedule that switches on at 16:00
 * does not cut a live game and lose it on time, while loading or reloading the
 * site is still refused. It lives on the `browser` variant because only the
 * browser can tell a page load from a websocket; a resolver or a device sees a
 * hostname and nothing else, so `reach` there would be a promise it cannot keep.
 */
export type BlockReach = "all" | "navigation";

/**
 * Where the lockout is applied.
 *
 * `resolver` is the one that reaches a phone, which is the reason host blocking
 * is kept rather than retired. Nothing else in this system covers a device the
 * app does not run on.
 */
export type CooldownEnforcement =
  | { readonly at: "browser"; readonly reach?: BlockReach }
  | { readonly at: "resolver"; readonly profile: string }
  | { readonly at: "device" };

/**
 * How long the lockout holds.
 *
 * `standing` never lapses. It is what the drogue blocklist has always been, and
 * expressing it here is what let host blocking stop being an exception to
 * invariant 6.
 */
export type CooldownDuration =
  | { readonly type: "seconds"; readonly seconds: number }
  | { readonly type: "standing" };

export interface CooldownSpec {
  readonly kind: "cooldown";
  /** Defaults to `browser` when absent. */
  readonly enforcement?: CooldownEnforcement;
  readonly duration: CooldownDuration;
  /**
   * Required, and the reason a cooldown satisfies invariant 6 by type.
   *
   * `out_of_band` is the honest name for a lift that lives outside the running
   * system, so it cannot be taken in the moment of wanting. A costly exit is
   * still an exit, and the cost is what makes the wall hold.
   */
  readonly unlockPath:
    | { readonly type: "wait" }
    | { readonly type: "unlock_with_intention"; readonly prompt: string }
    | { readonly type: "unlock_with_delay"; readonly seconds: number }
    | { readonly type: "out_of_band"; readonly note: string };
}

export interface ObserveSpec {
  readonly kind: "observe";
  readonly signal: string;
  readonly persistedKey: string;
}

export interface ScheduleSpec {
  readonly kind: "schedule";
  readonly window: {
    readonly fromHour: number;
    readonly toHour: number;
    readonly weekdays?: readonly Weekday[];
    readonly cutFrom?: Phase;
  };
  readonly wraps: Primitive;
  readonly outsideWindow: "inactive" | "passthrough";
}

/**
 * Event behaviour modification. Offers no surface of any kind.
 *
 * This is the one primitive that can violate invariant 6, which is why it is the
 * one to watch. Note that it is scoped to events, not to hosts: it carries no
 * host, URL or network field, and neither does any other primitive here.
 */
export interface InterceptSpec {
  readonly kind: "intercept";
  readonly events: readonly ("wheel" | "keydown" | "click" | "scroll")[];
  readonly whenKey?: readonly string[];
  readonly behavior:
    | { readonly type: "suppress" }
    | { readonly type: "rate_limit"; readonly minIntervalMs: number };
}

export interface ActuateSpec {
  readonly kind: "actuate";
  readonly action:
    | { readonly type: "pause_media" }
    | { readonly type: "mute_media" }
    | { readonly type: "blur" };
}

export type Primitive =
  | TransformSpec
  | GateSpec
  | CooldownSpec
  | ObserveSpec
  | ScheduleSpec
  | InterceptSpec
  | ActuateSpec;

/**
 * Whether the primitive can be got out of.
 *
 * `gate` and `cooldown` carry an exit by construction, as required fields.
 * Nothing else does. A `schedule` is transparent: it reads through to the
 * primitive it wraps, because a scheduled gate is still a gate.
 */
export function carriesExit(primitive: Primitive): boolean {
  switch (primitive.kind) {
    case "gate":
    case "cooldown":
      return true;
    case "schedule":
      return carriesExit(primitive.wraps);
    default:
      return false;
  }
}
