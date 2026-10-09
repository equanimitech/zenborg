/**
 * People derivations for the MCP server.
 *
 * Mirrors src/domain/services/PersonService.ts. Still a copy, though the
 * server now imports the domain directly (health.ts delegates to
 * HabitHealthService), so folding it in is open. Until then the two must
 * stay in lockstep; they are small and fully covered by tests on both sides.
 *
 * A person is a registry entity (spec D1), not a habit. Zenborg holds only
 * references: `Moment.personIds` carries entity keys such as `"ada"`. The
 * declared contact cadence and the paused/active status are registry facts
 * and arrive here as parameters — this module never reads a habit record and
 * never stores anything (spec D9). The outreach queue is a read composed at
 * query time from registry cadence plus zenborg moments.
 *
 * Health is NEVER stored. Recomputed on every read.
 */
import { type Cadence, cadenceDays, overdueRatio } from "./cadence.js";
import type { Health } from "./health.js";
import { parseVaultDay } from "./health.js";
import type { Moment } from "./vault.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Every moment involving this person.
 *
 * `habitId` is matched as well as `personIds` so that history predating the
 * people migration still counts — those moments were planted against the
 * person's own habit record, whose id the person kept. Most moments in a real
 * vault carry neither field, so the optional chain is load-bearing.
 */
export function personMoments(personKey: string, moments: Moment[]): Moment[] {
  const found: Moment[] = [];
  for (const m of moments) {
    if (
      m.habitId === personKey ||
      (m.personIds?.includes(personKey) ?? false)
    ) {
      found.push(m);
    }
  }
  return found;
}

/**
 * The most recent day this person was actually seen or spoken to.
 *
 * Future-dated moments are excluded: an arranged dinner is not contact yet.
 * Use `hasArrangedContact` for the "already sorted, stop nagging" signal.
 */
export function latestContactDate(
  personKey: string,
  moments: Moment[],
  now: Date,
): Date | null {
  let latest: Date | null = null;
  for (const m of personMoments(personKey, moments)) {
    if (m.day === null) {
      continue;
    }
    const d = parseVaultDay(m.day);
    if (d > now) {
      continue;
    }
    if (latest === null || d > latest) {
      latest = d;
    }
  }
  return latest;
}

/**
 * True when something with this person is already on the calendar ahead.
 *
 * The outreach queue uses this to stay quiet about someone you have already
 * reached out to. Known hole: a moment that keeps being postponed holds a
 * person out of the queue indefinitely. Accepted — it is visible in the
 * moment itself.
 */
export function hasArrangedContact(
  personKey: string,
  moments: Moment[],
  now: Date,
): boolean {
  for (const m of personMoments(personKey, moments)) {
    if (m.day === null) {
      continue;
    }
    if (parseVaultDay(m.day) > now) {
      return true;
    }
  }
  return false;
}

/**
 * Whole days since the last real contact. Null means never.
 *
 * Floors, whereas `personHealth` compares the fractional elapsed days against
 * the threshold — so this can show a stable "7" while health flips from
 * blooming to wilting at midday.
 */
export function daysSinceLastContact(
  personKey: string,
  moments: Moment[],
  now: Date,
): number | null {
  const last = latestContactDate(personKey, moments, now);
  if (last === null) {
    return null;
  }
  return Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY);
}

/**
 * Person health: declared cadence and silence only.
 *
 *   paused          -> "unstated"  (stepped back deliberately, never nagged)
 *   no cadence      -> "unstated"  (a roster entry, not a commitment)
 *   never seen      -> "wilting"
 *   within bucket   -> "blooming"
 *   past bucket     -> "wilting"
 *
 * Cadence and status are registry facts, passed in — zenborg stores neither.
 */
export function personHealth(
  personKey: string,
  cadence: Cadence | null,
  moments: Moment[],
  now: Date,
): Health {
  if (cadence === null) {
    return "unstated";
  }
  const last = latestContactDate(personKey, moments, now);
  if (last === null) {
    return "wilting";
  }
  const daysSince = (now.getTime() - last.getTime()) / MS_PER_DAY;
  return daysSince <= cadenceDays(cadence) ? "blooming" : "wilting";
}

/**
 * Sort key for the outreach queue, applied to `overdueRatio`. Null (never
 * contacted) ranks above every ratio, and stays finite so two of them compare
 * to 0 rather than NaN.
 */
export function overdueRank(ratio: number | null): number {
  return ratio === null ? Number.MAX_SAFE_INTEGER : ratio;
}

/**
 * A person as wake's registry hands them over (spec D10). The registry owns
 * display name, aliases and every other piece of entity metadata; zenborg
 * receives only what the queue needs. No name on purpose — fail-soft says
 * render the key.
 */
export interface RegistryPerson {
  key: string;
  cadence: Cadence | null;
  tags: string[];
  favorite: boolean;
  basePlace: string | null;
}

export interface PersonToReach {
  key: string;
  tags: string[];
  cadence: Cadence | null;
  daysSinceLastContact: number | null;
  overdueRatio: number | null;
  /**
   * Is this person somewhere other than where the season is being lived?
   *
   * `null` means the question could not be asked: either the registry does not
   * know where they are based, or the current cycle states no place. Unknown
   * is not the same as near, and a row says so rather than guessing.
   */
  far: boolean | null;
}

/**
 * Where a person is, against where the season is.
 *
 * Both sides are entity keys, and both sides derive them with the same slug
 * rule, so this is a plain comparison and not a matching problem.
 */
function isFar(
  basePlace: string | null,
  here: string[] | undefined,
): boolean | null {
  if (basePlace === null || here === undefined || here.length === 0) {
    return null;
  }
  return !here.includes(basePlace);
}

/**
 * The outreach queue: who has gone quiet past their declared cadence with
 * nothing already arranged, most overdue first.
 *
 * Ranked by overdue RATIO (days-since / cadence bucket days), never raw days:
 * raw days would park the long-cadence tail at the head of the queue forever
 * and bury the short-cadence people the queue exists to protect.
 *
 * Pure — the tool handler only reads the registry list and the moments and
 * hands them over, so the filter chain, the sort direction and the after-sort
 * slice are all testable without a vault. An empty registry (spec C4: wake's
 * key-resolve tool does not exist yet) is a normal empty queue, never an
 * error.
 */
export function selectPeopleToReach(
  people: RegistryPerson[],
  moments: Moment[],
  now: Date,
  opts: {
    tag?: string;
    limit?: number;
    here?: string[];
    far?: boolean;
  } = {},
): PersonToReach[] {
  const { tag, limit, here, far } = opts;
  const results: PersonToReach[] = [];

  for (const person of people) {
    if (tag && !person.tags.includes(tag)) {
      continue;
    }
    // Paused and cadence-less people are "unstated", never wilting.
    if (
      personHealth(person.key, person.cadence, moments, now) !==
      "wilting"
    ) {
      continue;
    }
    // Already reached out and agreed a date — stay quiet.
    if (hasArrangedContact(person.key, moments, now)) {
      continue;
    }

    const distance = isFar(person.basePlace, here);
    // Nobody is excluded by a distance that could not be checked. The same
    // call `practicesForGap` makes one field over: a list that shrinks in
    // silence is a failure nobody sees, while one extra row costs a glance.
    if (far !== undefined && distance !== null && distance !== far) {
      continue;
    }

    const daysSince = daysSinceLastContact(person.key, moments, now);
    results.push({
      key: person.key,
      tags: person.tags,
      cadence: person.cadence,
      daysSinceLastContact: daysSince,
      overdueRatio:
        daysSince === null || person.cadence === null
          ? null
          : overdueRatio(daysSince, person.cadence),
      far: distance,
    });
  }

  // Sort FIRST, then slice — `limit` must surface the most overdue, not an
  // arbitrary prefix of the registry's order.
  results.sort(
    (a, b) => overdueRank(b.overdueRatio) - overdueRank(a.overdueRatio),
  );
  return limit ? results.slice(0, limit) : results;
}
