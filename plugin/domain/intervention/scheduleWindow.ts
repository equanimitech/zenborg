/**
 * Is `now` inside a schedule primitive's window?
 *
 * The one reading of `ScheduleSpec.window`, shared by every surface that
 * evaluates one: the wrapped primitive applies INSIDE the window, and the
 * window wraps midnight when `toHour <= fromHour` — so 22→2 is [22,24) ∪ [0,2)
 * and 0→0 is the whole day. 0→24 is also the whole day, without wrapping.
 * A weekday list, when present, limits the window to those days (by the day
 * `now` falls on). Hours are local: watering hours are wall-clock policy.
 *
 * Dependency-free on purpose: the plugin and the extension vendor this file
 * byte-for-byte (`plugin/domain/intervention/`, `extension/modules/fence/`),
 * and a drift test on each side pins the copy.
 */

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export interface HourWindow {
  readonly fromHour: number;
  readonly toHour: number;
  readonly weekdays?: readonly string[];
}

export function isInScheduleWindow(window: HourWindow, now: Date): boolean {
  if (window.weekdays && window.weekdays.length > 0) {
    if (!window.weekdays.includes(WEEKDAYS[now.getDay()])) return false;
  }
  const hour = now.getHours();
  const { fromHour, toHour } = window;
  return toHour <= fromHour
    ? hour >= fromHour || hour < toHour
    : hour >= fromHour && hour < toHour;
}
