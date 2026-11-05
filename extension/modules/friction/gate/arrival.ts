/**
 * Entry gates: pure. An entry gate asks once when the person ARRIVES at a host
 * and not again while they stay.
 *
 * Arrival: the first attended visit after at least `AWAY_MS` away from the host's
 * domains, or the first of the local day. A reload or SPA route change inside a stay
 * is not one: the stay's last attended poll is seconds old.
 */

import { startOfLocalDay } from "@/modules/activity/events";

/** Time away that makes the next visit a new arrival. */
export const AWAY_MS = 30 * 60_000;

/** Is a visit at `now` an arrival, given the last attended moment (null: never seen)? */
export function isArrival(lastAttendedMs: number | null, now: number): boolean {
  if (lastAttendedMs === null) return true;
  if (startOfLocalDay(lastAttendedMs) !== startOfLocalDay(now)) return true;
  return now - lastAttendedMs >= AWAY_MS;
}
