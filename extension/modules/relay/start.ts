// Starting a moment from the new tab. Mirrors plugin/hooks/moment-band.tsx
// `switchMinutes`; the host rejects anything outside 1..240.
const DEFAULT_MIN = 120;
const MAX_MIN = 240;

export function switchMinutes(durationMin: number | null | undefined): number {
  return Math.min(durationMin && durationMin > 0 ? durationMin : DEFAULT_MIN, MAX_MIN);
}

/** The active moment and finished ones stay put; the host has no release path. */
export function canStart(m: { active: boolean; status: string }): boolean {
  return !m.active && m.status !== "DONE";
}
