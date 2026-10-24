import type { RuleId } from "../attention/ids";
import type { Primitive } from "./Primitive";
import type { DistalRef, ProximalOutcomeSpec } from "./ProximalOutcome";

/**
 * The intervention option.
 *
 * Extends keel's RuleSpec rather than replacing it: it already wraps primitives,
 * carries metadata, declares fade policy and passes a validator. Two additions
 * and one generalisation.
 */

export type BehavioralMechanism =
  | "cue-removal"
  | "access-block"
  | "friction"
  | "substitution"
  | "self-monitoring";

export type FadeEligibility = "auto" | "manual" | "never";

/**
 * Lifting scope off browser-only is what lets one rule vocabulary drive the tray,
 * the plugin and the extension.
 */
export type RuleScope =
  | {
      readonly surface: "browser";
      readonly domain: string | readonly string[];
      readonly matches: readonly string[];
    }
  | {
      readonly surface: "session";
      readonly paths: readonly string[];
      readonly match?: "outside" | "inside";
      readonly tools?: readonly string[];
    }
  | { readonly surface: "desktop"; readonly apps: readonly string[] }
  | {
      readonly surface: "garden";
      readonly areaIds: readonly string[];
    };

export interface RuleSpec {
  readonly id: RuleId;
  readonly name: string;
  readonly description: string;
  readonly scope: RuleScope;
  readonly mechanism: BehavioralMechanism;
  readonly fadeEligibility: FadeEligibility;
  /** Required. A rule that cannot name what it should shift will not compile. */
  readonly outcome: ProximalOutcomeSpec;
  /** Required. Points at the season's intention you already declared. */
  readonly serves: DistalRef;
  /**
   * Required. The randomisation probability at the decision point, which is what
   * makes the single-subject design readable rather than anecdotal.
   */
  readonly deliveryProbability: number;
  readonly primitives: readonly Primitive[];
}

/**
 * A dwell interval that is not a positive number of minutes is not an interval.
 *
 * Zero or a negative accumulates to "due" the instant the rule is in scope, and
 * a cue that is always due is a wall wearing a gate's clothes: the exit is still
 * there in the type and unreachable in practice, because taking it puts you
 * straight back in front of the next one. Invariant 6 is about an exit that can
 * actually be taken.
 *
 * Recursive through `schedule` for the same reason `carriesExit` is: a scheduled
 * gate is still a gate.
 */
function triggerProblems(primitives: readonly Primitive[]): readonly string[] {
  const problems: string[] = [];
  for (const primitive of primitives) {
    if (primitive.kind === "schedule") {
      for (const p of triggerProblems([primitive.wraps])) problems.push(p);
      continue;
    }
    if (primitive.kind !== "gate") continue;
    if (primitive.trigger.type === "click") {
      // A click gate with no selector stands in front of nothing: a rule that
      // validates and never fires, which is the silently-dead failure.
      if (primitive.trigger.selectors.primary.trim() === "") {
        problems.push("gate.trigger.selectors.primary must name a selector");
      }
      continue;
    }
    if (primitive.trigger.type !== "dwell") continue;
    const every = primitive.trigger.everyMinutes;
    if (!Number.isFinite(every) || every <= 0) {
      problems.push("gate.trigger.everyMinutes must be positive");
    }
  }
  return problems;
}

/**
 * Structural checks a rule must pass. Returns every problem found, not the first.
 *
 * Reporting one problem at a time turns authoring into a guessing game, and this
 * validator is read by a person composing a rule by hand.
 */
export function validateRuleSpec(rule: RuleSpec): readonly string[] {
  const problems: string[] = [];

  if (rule.primitives.length === 0) {
    problems.push("a rule must carry at least one primitive");
  }

  if (rule.deliveryProbability < 0 || rule.deliveryProbability > 1) {
    problems.push("deliveryProbability must be between 0 and 1");
  }

  if (rule.outcome.windowMs <= 0) {
    problems.push("outcome.windowMs must be positive");
  }

  if (rule.outcome.claim.trim().length === 0) {
    problems.push("outcome.claim must say what the rule should shift");
  }

  const measure = rule.outcome.measure;
  if (
    (measure.kind === "next_span_in" || measure.kind === "no_span_matching") &&
    measure.areaIds.length === 0
  ) {
    // Every measure must be answerable from the log. A return measure naming no
    // area has nothing to look for, so it reports unknown forever, which is the
    // unevaluable state this layer exists to leave behind.
    problems.push("outcome.measure names no area, so it can never be settled");
  }

  for (const problem of triggerProblems(rule.primitives)) {
    problems.push(problem);
  }

  if (rule.scope.surface === "browser") {
    const domains = Array.isArray(rule.scope.domain)
      ? rule.scope.domain
      : [rule.scope.domain];
    if (domains.length === 0 || domains.every((d) => !d.trim())) {
      problems.push("scope.domain must name at least one registrable domain");
    }
    if (rule.scope.matches.length === 0) {
      problems.push("scope.matches must be non-empty");
    }
    if (rule.scope.matches.includes("*://*/*")) {
      problems.push("scope.matches must not be global");
    }
  }

  if (rule.scope.surface === "garden") {
    if (rule.scope.areaIds.length === 0) {
      problems.push("scope.areaIds must be non-empty for a garden-scoped rule");
    }
  }

  return problems;
}
