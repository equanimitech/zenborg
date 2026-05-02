import type { Cycle } from "@/domain/entities/Cycle";

export interface ClampInput {
  cycleId: string;
  edge: "start" | "end";
  candidateDate: string;
  allCycles: Cycle[];
}

export interface ClampResult {
  date: string;
  blockedBy?: string;
}

/**
 * Clamp a candidate ISO date for a cycle's start or end edge against:
 *   1. self-inversion (end ≤ start)
 *   2. neighbor cycles (no overlap allowed)
 *
 * Returns the clamped date and, if clamping happened against a neighbor,
 * the blocking cycle's id (used for visual feedback).
 *
 * Pure — no IO, no observable reads. Caller passes the cycle list.
 */
export function clampCycleEdge({
  cycleId,
  edge,
  candidateDate,
  allCycles,
}: ClampInput): ClampResult {
  const self = allCycles.find((c) => c.id === cycleId);
  if (!self) return { date: candidateDate };

  const others = allCycles.filter((c) => c.id !== cycleId);

  if (edge === "start") {
    // Start cannot pass self.endDate (if set)
    let clamped = candidateDate;
    let blockedBy: string | undefined;

    if (self.endDate !== null && clamped >= self.endDate) {
      clamped = addDays(self.endDate, -1);
    }

    // Cannot enter another cycle's interval [start, end] (or [start, ∞) when ongoing).
    for (const other of others) {
      const inside =
        other.endDate === null
          ? clamped >= other.startDate
          : clamped >= other.startDate && clamped <= other.endDate;
      if (!inside) continue;
      const otherEnd = other.endDate ?? other.startDate;
      const after = addDays(otherEnd, 1);
      if (after > clamped) {
        clamped = after;
        blockedBy = other.id;
      }
    }

    return blockedBy ? { date: clamped, blockedBy } : { date: clamped };
  }

  // edge === "end"
  let clamped = candidateDate;
  let blockedBy: string | undefined;

  if (clamped <= self.startDate) {
    clamped = addDays(self.startDate, 1);
  }

  for (const other of others) {
    const inside =
      other.endDate === null
        ? clamped >= other.startDate
        : clamped >= other.startDate && clamped <= other.endDate;
    if (!inside) continue;
    const before = addDays(other.startDate, -1);
    if (before < clamped) {
      clamped = before;
      blockedBy = other.id;
    }
  }

  return blockedBy ? { date: clamped, blockedBy } : { date: clamped };
}

/**
 * Add (or subtract) whole days to an ISO date string. Returns ISO date.
 * Pure — uses UTC arithmetic to avoid DST drift on day-only dates.
 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Compute whole-day delta between two ISO dates (b - a).
 */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aDate = Date.UTC(ay, am - 1, ad);
  const bDate = Date.UTC(by, bm - 1, bd);
  return Math.round((bDate - aDate) / 86_400_000);
}
