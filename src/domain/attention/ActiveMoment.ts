/**
 * When is the active-moment pointer stale?
 *
 * The one reading, shared by every reader of `activeMoment.json`. A pointer is
 * stale when the moment it names is gone or sits on a day other than the
 * waking-day. A stale pointer reads as no active moment ("released"); readers
 * never mutate, so the file is left for the next `set_active_moment` to
 * overwrite.
 *
 * Dependency-free on purpose: the plugin vendors this file byte-for-byte
 * (`plugin/domain/attention/ActiveMoment.ts`), and a test pins the copy.
 */

/** The waking-day rolls at 04:00 rather than midnight. */
export const DAY_START_HOUR = 4;

export function wakingDayKey(now: Date = new Date()): string {
  const rolled = new Date(now.getTime() - DAY_START_HOUR * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${rolled.getFullYear()}-${p(rolled.getMonth() + 1)}-${p(rolled.getDate())}`;
}

/** Why the pointer is stale, or `null` when the moment is on `today`. */
export function staleReason(
  moment: { day?: string | null } | undefined,
  today: string,
): string | null {
  if (!moment) return "moment no longer exists";
  if (moment.day === today) return null;
  return `moment is allocated to ${moment.day ?? "no day"}, not today`;
}
