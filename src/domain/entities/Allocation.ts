/**
 * Allocation - a slice of a cycle's capacity, spent on purpose.
 *
 * A **bet** has a defined outcome and ends at cool-down. A **lane** is
 * standing work that renews every cycle with one named aim. Both carry an
 * appetite in days; the cycle carries the capacity they draw from.
 *
 * Pure: the invariants live here, so the MCP server and the app agree.
 * Pitch: docs/pitches/2026-10-28-shape-up-for-one.md (equanimitech/docs).
 */
export type AllocationKind = "bet" | "lane";

export interface Allocation {
  readonly id: string;
  kind: AllocationKind;
  name: string;
  /** Area id or name; free text, resolved by the reader. */
  area: string;
  /** Linear project URL | pitch path | repo path. How the meter attributes. */
  link: string;
  appetiteDays: number;
  /** The one thing this lane is for this cycle. Required on a lane. */
  aim?: string;
}

/** Default days per cycle (about 72 merged hours at 6 h a day). */
export const DEFAULT_CAPACITY_DAYS = 12;
/** Cool-down takes half a day inside the capacity. */
export const COOL_DOWN_DAYS = 0.5;
/** The Bugs & ops lane may take at most this share of capacity. */
export const BUGS_OPS_SHARE = 0.25;
/** Name of the lane that Bug / Backfill / « Run: » issues are charged to. */
export const BUGS_OPS_NAME = "Bugs & ops";

const EPS = 1e-9;

const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export const isBugsOpsLane = (a: Pick<Allocation, "kind" | "name">) =>
  a.kind === "lane" && fold(a.name) === fold(BUGS_OPS_NAME);

/** Every invariant violation, empty when the table is valid. */
export function allocationErrors(
  allocations: readonly Allocation[],
  capacityDays: number = DEFAULT_CAPACITY_DAYS,
): string[] {
  const errors: string[] = [];
  if (!(capacityDays > 0)) errors.push("Capacity must be positive");

  const ids = new Set<string>();
  for (const a of allocations) {
    const label = `"${a.name}"`;
    if (ids.has(a.id)) errors.push(`Duplicate allocation id ${a.id}`);
    ids.add(a.id);
    if (!a.name.trim()) errors.push("An allocation needs a name");
    if (!a.link.trim()) errors.push(`${label} needs a link`);
    if (!(a.appetiteDays > 0))
      errors.push(`${label} needs an appetite above 0 days`);
    if (a.kind === "lane" && !a.aim?.trim())
      errors.push(`Lane ${label} requires an aim`);
  }

  const total = allocations.reduce((s, a) => s + a.appetiteDays, 0);
  const budget = capacityDays - COOL_DOWN_DAYS;
  if (total > budget + EPS)
    errors.push(
      `Appetites total ${total} d, over ${budget} d (capacity ${capacityDays} d minus ${COOL_DOWN_DAYS} d cool-down)`,
    );

  const bugsOps = allocations
    .filter(isBugsOpsLane)
    .reduce((s, a) => s + a.appetiteDays, 0);
  const bugsOpsMax = capacityDays * BUGS_OPS_SHARE;
  if (bugsOps > bugsOpsMax + EPS)
    errors.push(
      `${BUGS_OPS_NAME} is ${bugsOps} d, over a quarter of capacity (${bugsOpsMax} d)`,
    );

  return errors;
}
