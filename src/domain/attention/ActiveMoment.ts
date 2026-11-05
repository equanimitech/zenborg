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

/**
 * The pointer as stored. `until` + `returnTo` make it a timed switch: the
 * pointer names `momentId` until `until`, then the one it switched away from.
 * Switch, don't stack: there is only ever one place to return to.
 */
export interface PointerAt {
  momentId: string;
  at: string;
}
export interface Pointer extends PointerAt {
  until?: string;
  returnTo?: PointerAt;
}

/**
 * The pointer in force at `now`. Expiry is resolved lazily, on read, the same
 * way by every reader: past `until` the pointer is `returnTo`, or nothing. The
 * file is left as written; the next write starts from what is in force. An
 * unparseable `until` reads as untimed (fail soft).
 */
export function resolvePointer(
  p: Pointer | null | undefined,
  now: number,
): Pointer | null {
  if (!p?.momentId) return null;
  if (!p.until || !(Date.parse(p.until) <= now)) return p;
  return p.returnTo?.momentId
    ? { momentId: p.returnTo.momentId, at: p.returnTo.at }
    : null;
}

/**
 * The pointer after switching to `momentId` at `at`. Without `minutes` it is a
 * plain set (no timer). With `minutes` it returns to what was in force — or,
 * when that was itself a timed switch, to where that one would return, so a
 * second switch never nests. `current` must already be resolved.
 */
export function switchPointer(
  current: Pointer | null,
  momentId: string,
  at: string,
  minutes?: number,
): Pointer {
  if (!minutes || minutes <= 0) return { momentId, at };
  const base = current?.until ? current.returnTo : current;
  const until = new Date(Date.parse(at) + minutes * 60_000).toISOString();
  return {
    momentId,
    at,
    until,
    ...(base?.momentId && base.momentId !== momentId
      ? { returnTo: { momentId: base.momentId, at: base.at } }
      : {}),
  };
}
