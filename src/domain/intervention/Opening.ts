/**
 * Planned openings and the pass allowance: the two non-rule records `fences.json` carries.
 *
 * An **opening** is a time-boxed lift declared ahead (BCT 1.4, action planning):
 * its hosts come out of scheduled blocks and gates from `from` until `until`,
 * then it closes by itself. It never draws on the pass allowance.
 *
 * The **pass allowance** prices the block page's pass: `perMonth` passes of
 * `hours` each, resetting on the 1st, local time. Absent, the extension uses
 * the defaults below.
 *
 * Neither is a `RuleSpec`, so every rule reader skips them (`isRuleRecord`)
 * and every rule writer carries them through untouched.
 */

export const OPENING_KIND = "opening";
export const PASS_ALLOWANCE_KIND = "pass-allowance";
export const PASS_ALLOWANCE_ID = "pass-allowance";

export interface OpeningRecord {
  readonly id: string;
  readonly kind: typeof OPENING_KIND;
  readonly hosts: readonly string[];
  /** ISO-8601 UTC. */
  readonly from: string;
  /** ISO-8601 UTC, exclusive. */
  readonly until: string;
  readonly reason: string;
}

export interface PassAllowanceRecord {
  readonly id: typeof PASS_ALLOWANCE_ID;
  readonly kind: typeof PASS_ALLOWANCE_KIND;
  readonly perMonth: number;
  readonly hours: number;
}

export const DEFAULT_PASS_ALLOWANCE = { perMonth: 4, hours: 3 } as const;

/** A `RuleSpec` carries `primitives`; nothing else in `fences.json` does. */
export function isRuleRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { primitives?: unknown }).primitives)
  );
}

export function isOpeningRecord(value: unknown): value is OpeningRecord {
  return (value as { kind?: unknown } | null)?.kind === OPENING_KIND;
}

const HOST_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;

/**
 * An instant from what a person says: "20:00" is today at 20h local, anything
 * else must parse as a date-time. `after` rolls a clock time to the next day
 * when it would not come after it, so "20:00 to 01:00" crosses midnight.
 */
export function resolveInstant(input: string, now: Date, after?: Date): Date | null {
  const clock = CLOCK.exec(input.trim());
  if (clock) {
    const [h, m] = [Number(clock[1]), Number(clock[2])];
    if (h > 23 || m > 59) return null;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (after && d.getTime() <= after.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  const t = Date.parse(input);
  return Number.isFinite(t) ? new Date(t) : null;
}

export interface OpeningInput {
  readonly hosts: readonly string[];
  readonly from: string;
  readonly until: string;
  readonly reason: string;
}

/** The `opening` record for `input`, or what is wrong with it. */
export function buildOpening(
  input: OpeningInput,
  now: Date,
): { readonly record: OpeningRecord } | { readonly problems: string[] } {
  const problems: string[] = [];
  const hosts = [
    ...new Set(input.hosts.map((h) => h.trim().toLowerCase().replace(/^www\./, ""))),
  ];
  if (hosts.length === 0) problems.push("name at least one host");
  for (const h of hosts) {
    if (!HOST_PATTERN.test(h)) {
      problems.push(`"${h}" is not a registrable host: pass "example.com", not a URL`);
    }
  }
  const reason = input.reason.trim();
  if (reason === "") problems.push("say what it is for: the reason is the plan");
  const from = resolveInstant(input.from, now);
  const until = from ? resolveInstant(input.until, now, from) : null;
  if (!from) problems.push(`"${input.from}" is not a time: pass "20:00" or an ISO date-time`);
  if (from && !until) {
    problems.push(`"${input.until}" is not a time: pass "01:00" or an ISO date-time`);
  }
  if (from && until && until.getTime() <= from.getTime()) {
    problems.push("`until` must come after `from`");
  }
  if (until && until.getTime() <= now.getTime()) {
    problems.push("that window is already over");
  }
  if (problems.length > 0 || !from || !until) return { problems };

  const fromIso = from.toISOString();
  return {
    record: {
      id: `opening:${fromIso}:${hosts.map((h) => h.replace(/\./g, "-")).join("+")}`,
      kind: OPENING_KIND,
      hosts,
      from: fromIso,
      until: until.toISOString(),
      reason,
    },
  };
}

/** Active or still to come at `now`. An opening that has closed is history. */
export function isOpeningLive(record: OpeningRecord, now: Date): boolean {
  return Date.parse(record.until) > now.getTime();
}

/** The `pass-allowance` record, or what is wrong with the numbers. */
export function buildPassAllowance(
  perMonth: number,
  hours: number,
): { readonly record: PassAllowanceRecord } | { readonly problems: string[] } {
  const problems: string[] = [];
  if (!Number.isInteger(perMonth) || perMonth < 0) {
    problems.push("perMonth is a whole number, 0 or more");
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    problems.push("hours is more than 0 and at most 24");
  }
  if (problems.length > 0) return { problems };
  return {
    record: { id: PASS_ALLOWANCE_ID, kind: PASS_ALLOWANCE_KIND, perMonth, hours },
  };
}
