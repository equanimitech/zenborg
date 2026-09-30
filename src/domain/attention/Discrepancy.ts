import type { AreaId, Instant, MomentId } from "./ids";

/**
 * The spine of the model: the gap between what was planted and what was observed.
 *
 * Everything downstream reads a discrepancy. Nothing downstream re-derives one.
 */

export type DiscrepancyKind = "drift" | "absence" | "overrun" | "fragmentation";

/**
 * The raw observation, uncut.
 *
 * Deliberately not a class or a band. There is no basis for choosing where a cut
 * goes until shadow mode has recorded real values, and the cut lands at no more
 * than three classes when it does, per the taxonomy's ceiling on derived facts.
 * Do not add a MagnitudeClass here.
 */
export type Magnitude = number;

export interface Discrepancy {
  readonly kind: DiscrepancyKind;
  readonly magnitude: Magnitude;
  /**
   * Every moment planted in the (day, phase) cell. A set, not a moment.
   *
   * Every moment planted in the (day, phase) cell. No cardinality bound.
   */
  readonly plantedMomentIds: readonly MomentId[];
  /** The area attention actually resolved to. Absent when nothing was observed. */
  readonly observedAreaId?: AreaId;
  readonly since: Instant;
}

/**
 * True for a well-formed drift.
 *
 * An empty planting is not a discrepancy against everything, it is the absence of
 * a plan to be discrepant with, so a drift with no plantings is malformed rather
 * than merely uninteresting.
 */
export function isDrift(discrepancy: Discrepancy): boolean {
  return (
    discrepancy.kind === "drift" && discrepancy.plantedMomentIds.length > 0
  );
}

/**
 * True for a well-formed absence.
 *
 * The mirror of `isDrift`, and its condition is the exact inverse: attention was
 * observed and the cell held nothing to observe it against. Working with no
 * intention set is not the harmless case the empty cell first looked like, it is
 * its own discrepancy, and the taxonomy already reserved the word.
 *
 * An absence carrying plantings is malformed, not merely uninteresting: if
 * something was planted, the question is whether attention matched it, and that
 * question is `drift`.
 */
export function isAbsence(discrepancy: Discrepancy): boolean {
  return (
    discrepancy.kind === "absence" && discrepancy.plantedMomentIds.length === 0
  );
}

/**
 * How far a departure from a session fence went, as the session declares it.
 *
 * Distance classifies commitment fit; what the fence does about it is set by
 * what the departure costs attention (decision 2026-09-30): near is held to a
 * capture, far waits for a breakpoint, away is not the coding hook's to gate.
 * `inside` is not a distance, it is no departure, so it is not listed here.
 */
export type DriftDistance = "near" | "far" | "away";
