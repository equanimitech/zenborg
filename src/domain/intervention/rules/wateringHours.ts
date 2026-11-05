import type { AreaId, Duration, RuleId } from "../../attention/ids";
import type { Phase } from "../../value-objects/Phase";
import type { Weekday } from "../../value-objects/Schedule";
import type {
  BlockReach,
  CooldownSpec,
  GateSpec,
  Primitive,
  ScheduleSpec,
} from "../Primitive";
import type { DistalRef } from "../ProximalOutcome";
import type { RuleSpec } from "../RuleSpec";

/**
 * Watering hours — a standing temporal attention policy.
 *
 * "This plot is watered mornings" declares a window rather than a single
 * fence: `regular` adds friction outside it, `dry` blocks a surface outright
 * for a spell, `by_hand` asks for a confirming word instead of irrigating on
 * autopilot, `rationed` leaves a host pool open until its attended minutes
 * for the day reach a budget, then walls it. One factory, four modes, because
 * all four are the same fact — a window plus a restriction — read at a
 * different mechanism.
 *
 * A rule is generated per surface actually declared in `restricts`: naming
 * `areas` yields a `garden` rule, `paths` a `session` rule, each `hosts`
 * entry its own `browser` rule. Nothing is emitted for a surface nobody
 * asked to restrict.
 */

export type WateringHoursMode = "regular" | "dry" | "by_hand" | "rationed";

export interface WateringHoursWindow {
  readonly fromHour: number;
  readonly toHour: number;
  readonly weekdays?: readonly Weekday[];
  readonly cutFrom?: Phase;
}

export interface WateringHoursInput {
  readonly policyName: string;
  readonly mode: WateringHoursMode;
  readonly window: WateringHoursWindow;
  readonly serves: DistalRef;
  readonly returnsTo: readonly AreaId[];
  readonly restricts: {
    readonly areas?: readonly AreaId[];
    readonly paths?: readonly string[];
    readonly hosts?: readonly string[];
    readonly tools?: readonly string[];
  };
  readonly prompt?: string;
  readonly unlockNote?: string;
  readonly windowMs?: Duration;
  /**
   * What a `dry` browser block stops. `navigation` refuses page loads but
   * keeps a page already open alive (a live game is not cut at the hour).
   * Browser rules only; absent means `all`.
   */
  readonly reach?: BlockReach;
  /** `rationed` mode: daily attended-minutes budget for the host pool. */
  readonly budget?: {
    readonly minutes: number;
    readonly exclude: readonly string[];
  };
}

const TEN_MINUTES: Duration = 10 * 60_000;
const TEN_SECONDS = 10;

export function wateringPolicyId(
  policyName: string,
  surface: string,
  qualifier?: string,
): RuleId {
  const parts = ["watering", policyName, surface];
  if (qualifier) parts.push(qualifier);
  return parts.join(":");
}

function regularRungs(
  window: WateringHoursWindow,
  prompt: string,
  abortLabel: string,
): readonly Primitive[] {
  const wrap = (gate: GateSpec): ScheduleSpec => ({
    kind: "schedule",
    window,
    outsideWindow: "inactive",
    wraps: gate,
  });

  const first: GateSpec = {
    kind: "gate",
    trigger: { type: "entry" },
    frictionType: { type: "intention", prompt },
    proceedAffordance: {
      label: "Water it anyway",
      action: { type: "continue" },
    },
    abortAffordance: { label: abortLabel },
  };

  const second: GateSpec = {
    kind: "gate",
    trigger: { type: "entry" },
    frictionType: { type: "delay", seconds: TEN_SECONDS },
    proceedAffordance: {
      label: "Water it anyway",
      action: { type: "continue" },
    },
    abortAffordance: { label: abortLabel },
  };

  return [wrap(first), wrap(second)];
}

function dryRung(
  window: WateringHoursWindow,
  unlockNote: string,
  reach: BlockReach | undefined,
): readonly Primitive[] {
  const cooldown: CooldownSpec = {
    kind: "cooldown",
    duration: { type: "standing" },
    unlockPath: { type: "out_of_band", note: unlockNote },
    ...(reach === "navigation"
      ? { enforcement: { at: "browser" as const, reach } }
      : {}),
  };
  return [
    { kind: "schedule", window, outsideWindow: "inactive", wraps: cooldown },
  ];
}

function byHandRungs(
  window: WateringHoursWindow,
  prompt: string,
): readonly Primitive[] {
  const wrap = (gate: GateSpec): ScheduleSpec => ({
    kind: "schedule",
    window,
    outsideWindow: "inactive",
    wraps: gate,
  });

  const first: GateSpec = {
    kind: "gate",
    trigger: { type: "entry" },
    frictionType: { type: "confirmation" },
    proceedAffordance: {
      label: "By hand — write it",
      action: { type: "continue" },
    },
    abortAffordance: { label: "Describe it instead" },
  };

  const second: GateSpec = {
    kind: "gate",
    trigger: { type: "entry" },
    frictionType: {
      type: "intention",
      prompt: prompt || "What are you writing by hand?",
    },
    proceedAffordance: {
      label: "By hand — write it",
      action: { type: "continue" },
    },
    abortAffordance: { label: "Describe it instead" },
  };

  return [wrap(first), wrap(second)];
}

function primitivesFor(
  input: WateringHoursInput,
  browser = false,
): readonly Primitive[] {
  switch (input.mode) {
    case "regular":
      return regularRungs(
        input.window,
        input.prompt || "This plot is watered at other hours. Continue?",
        "Back to the scheduled plots",
      );
    case "dry":
      return dryRung(
        input.window,
        input.unlockNote || "Re-declare watering hours to lift.",
        browser ? input.reach : undefined,
      );
    case "by_hand":
      return byHandRungs(input.window, input.prompt || "");
    case "rationed": {
      const [rung] = dryRung(
        input.window,
        input.unlockNote || "Tomorrow.",
        browser ? input.reach : undefined,
      );
      if (rung.kind !== "schedule" || !input.budget) return [rung];
      return [
        {
          ...rung,
          budget: {
            minutes: input.budget.minutes,
            pool: input.policyName,
            exclude: [...input.budget.exclude],
          },
        },
      ];
    }
  }
}

function mechanismFor(mode: WateringHoursMode): "friction" | "access-block" {
  return mode === "dry" || mode === "rationed" ? "access-block" : "friction";
}

export function wateringHoursRules(input: WateringHoursInput): RuleSpec[] {
  const rules: RuleSpec[] = [];
  const { restricts, policyName } = input;
  const mechanism = mechanismFor(input.mode);
  const windowMs = input.windowMs ?? TEN_MINUTES;

  const base = {
    description: `Watering hours policy "${policyName}" (${input.mode})`,
    mechanism,
    fadeEligibility: "manual" as const,
    outcome: {
      claim: `attention returns to a watered plot rather than staying outside "${policyName}"`,
      measure: { kind: "next_span_in" as const, areaIds: [...input.returnsTo] },
      windowMs,
    },
    serves: input.serves,
    deliveryProbability: 1,
  };

  if (restricts.areas && restricts.areas.length > 0) {
    rules.push({
      ...base,
      id: wateringPolicyId(policyName, "garden"),
      name: `${policyName} (garden)`,
      scope: { surface: "garden", areaIds: [...restricts.areas] },
      primitives: primitivesFor(input),
    });
  }

  if (restricts.paths && restricts.paths.length > 0) {
    rules.push({
      ...base,
      id: wateringPolicyId(policyName, "session"),
      name: `${policyName} (session)`,
      scope: {
        surface: "session",
        paths: [...restricts.paths],
        match: "inside" as const,
        ...(restricts.tools && restricts.tools.length > 0
          ? { tools: [...restricts.tools] }
          : {}),
      },
      primitives: primitivesFor(input),
    });
  }

  if (restricts.hosts && restricts.hosts.length > 0) {
    for (const host of restricts.hosts) {
      rules.push({
        ...base,
        id: wateringPolicyId(policyName, "browser", host),
        name: `${policyName} (${host})`,
        scope: {
          surface: "browser",
          domain: host,
          matches: [`*://${host}/*`, `*://*.${host}/*`],
        },
        primitives: primitivesFor(input, true),
      });
    }
  }

  return rules;
}
