import { validateTag } from "../services/TagService.ts";
import type { CustomMetric } from "../value-objects/Attitude";
import type { Phase } from "../value-objects/Phase";
import { isValidStartTime } from "../value-objects/Schedule.ts";

/**
 * Moment - A named intention (1-3 words maximum)
 *
 * Represents a conscious allocation of attention to a specific activity.
 * Moments can be unallocated (in the drawing board) or allocated to a
 * specific day and phase.
 *
 * Cycle Integration:
 * - cycleId: Links moment to a time period (for Review mode)
 * - cyclePlanId: Links to budget plan (null = spontaneous, non-null = budgeted)
 * - Budgeted moments: cyclePlanId !== null (pre-created from cycle plans)
 * - Spontaneous moments: cyclePlanId === null (ad-hoc creation)
 *
 * Tags & Metrics (optional):
 * - customMetric: For PUSHING habit support - user-defined performance tracking
 * - tags: Flexible labels for organization (lowercase, no spaces, alphanumeric + hyphen)
 *
 * References (optional):
 * - refs: URLs this moment refers to — the Linear issue, the PR, the doc.
 *   A pointer and nothing else: not an attachment, not a checklist, and
 *   carrying no meaning beyond "this moment refers to that". Any parseable
 *   URL, including app schemes like `things:///show?id=…`.
 *
 * Note: Attitude now lives at Habit/Area level. Moments inherit attitude via:
 * habit?.attitude ?? area?.attitude ?? null
 */
/**
 * Whether this moment is a proposal or a committed intention.
 * Optional; absence means `accepted`. Every moment in the vault today was
 * hand-planted, so absence carries exactly the right meaning and no vault
 * migration is required. Only calendar ingestion ever writes "tentative".
 */
export type MomentStatus = "tentative" | "accepted";

/**
 * Provenance for a moment that mirrors an external calendar event.
 * Absent on moments with no calendar counterpart.
 */
export interface ExternalRef {
  readonly source: "eventkit";
  readonly eventId: string;
  readonly calendarId: string;
  readonly lastWrittenHash: string;
  readonly lastWrittenTitle: string;
  readonly lastSyncedAt: string;
}

export interface Moment {
  readonly id: string;
  name: string;
  areaId: string;
  habitId: string | null; // Optional link to Habit (emergent structure)
  cycleId: string | null; // Which cycle TIME PERIOD this belongs to
  cyclePlanId: string | null; // Which budget plan (null = spontaneous)
  phase: Phase | null;
  day: string | null; // ISO date: "2025-01-15"
  order: number; // Position within the (day, phase) slot; non-negative

  // Clock time (optional). Inherited from the parent habit's schedule at
  // allocation time, overridable per instance. Absent on ambient moments.
  startTime?: string; // "HH:MM", 24h
  durationMin?: number; // positive whole minutes

  status?: MomentStatus;
  externalRef?: ExternalRef;

  emoji?: string | null; // Optional emoji override (inherits from habit or area)
  customMetric?: CustomMetric; // Keep for PUSHING habit support
  tags: string[] | null; // Flexible organization labels
  refs?: readonly string[]; // URLs this moment refers to. Absent = none.

  /**
   * People present at this moment. Many people compose under one moment —
   * a dinner with three friends is ONE moment carrying three ids, not three
   * moments (which would also collide with the max-3-per-(day,phase) cap).
   *
   * Ids are registry entity keys (e.g. `"ada"`) — the registry owns the
   * person's metadata; zenborg stores only the reference (spec D1/D3).
   * Optional: absent means nobody. There is deliberately no `null` form.
   */
  personIds?: string[];

  /**
   * Where this moment happened. Ids are registry entity keys, at whatever
   * grain the moment knows: a moment at `"avalon-cafe"` may also name
   * `"avalon"`, and coarser grains roll up through the place tree (spec D5).
   *
   * This is the `place-` tag grown into the field it always wanted to be.
   * The kernel's flatten rule makes `place-avalon` and `kairos:place/avalon`
   * the same reference; only the storage changes (spec D4).
   *
   * Optional: absent means the place is unknown, which is honest. A wrong
   * place is not. There is deliberately no `null` form.
   */
  placeIds?: string[];

  /**
   * The map link you pasted, kept verbatim as minting evidence.
   *
   * Wake reads this string to parse a label and coordinates, mints the place
   * entity with its parent chain, and owns that metadata from then on. Zenborg
   * holds the string and nothing else: label, latitude and longitude are entity
   * metadata, and D1 forbids zenborg from holding them (spec D5).
   */
  placeUrl?: string;

  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Is this string a parseable URL?
 *
 * Deliberately permissive about the scheme: `things:///show?id=…`,
 * `obsidian://open?…` and `https://…` are all legitimate places a moment can
 * point at. The only thing rejected is a string the URL parser cannot read.
 */
export function isParseableRef(ref: string): boolean {
  try {
    new URL(ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a list of refs, naming the first unparseable one.
 *
 * @returns an error message, or null when every ref parses
 */
export function validateRefs(
  refs: readonly string[] | undefined,
): string | null {
  for (const ref of refs ?? []) {
    if (!isParseableRef(ref.trim())) {
      return `Moment ref is not a parseable URL: ${ref}`;
    }
  }
  return null;
}

/**
 * Trims, drops empties, and de-duplicates refs. Order of first occurrence is
 * preserved — the list reads as the author wrote it.
 */
export function normalizeRefs(refs: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of refs ?? []) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Derives an entity key from a human label.
 *
 * lowercase → strip diacritics → non-alphanumeric to dash → collapse dash
 * runs → trim dashes. `"Café Lab, Vila Madalena"` becomes
 * `"cafe-lab-vila-madalena"`.
 *
 * The rule lives in the kernel contract (`entities.md`, "Deriving a key from
 * a label") because two writers must agree on it without coordinating:
 * zenborg derives a key to write `placeIds`, and wake derives a key from the
 * same label to mint the entity. A copy of this function lives in
 * `mcp-server/validation.ts`, which cannot import from `src/domain`.
 *
 * Zenborg's key is only a proposal. Wake owns collision resolution, and a key
 * that resolves to nothing renders as itself under the kernel's fail-soft rule.
 */
export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Validates the pasted place link.
 *
 * Permissive about the scheme for the same reason `refs` is: a place can
 * arrive as an `https://` map link or as a deep link into another app.
 *
 * @returns an error message, or null when absent or parseable
 */
export function validatePlaceUrl(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }
  if (!isParseableRef(url.trim())) {
    return `Moment placeUrl is not a parseable URL: ${url}`;
  }
  return null;
}

/**
 * Result of moment name validation
 */
export interface MomentNameValidation {
  valid: boolean;
  wordCount?: number;
  error?: string;
}

/**
 * Result type for operations that may fail
 */
export type MomentResult = Moment | { error: string };

/**
 * Validates that a moment name contains 1-3 words
 *
 * @param name - The moment name to validate
 * @returns Validation result with error message if invalid
 */
export function validateMomentName(name: string): MomentNameValidation {
  const trimmed = name.trim();

  if (!trimmed) {
    return {
      valid: false,
      wordCount: 0,
      error: "Moment name cannot be empty",
    };
  }

  // Split by whitespace and filter out empty strings
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);

  if (words.length < 1) {
    return {
      valid: false,
      wordCount: 0,
      error: "Moment name must contain at least 1 word",
    };
  }

  if (words.length > 3) {
    return {
      valid: false,
      wordCount: words.length,
      error: "Moment name cannot exceed 3 words",
    };
  }

  return {
    valid: true,
    wordCount: words.length,
  };
}

/**
 * Counts moments already sitting in a (day, phase) slot.
 *
 * @param excludeMomentId - a moment being moved, which shouldn't count itself
 */
export function countMomentsInPhase(
  moments: readonly Moment[],
  day: string,
  phase: Phase,
  excludeMomentId?: string,
): number {
  let count = 0;
  for (const m of moments) {
    if (excludeMomentId && m.id === excludeMomentId) continue;
    if (m.day === day && m.phase === phase) count++;
  }
  return count;
}

/**
 * Parameters for creating a new moment
 */
export interface CreateMomentProps {
  name: string;
  areaId: string;
  habitId?: string | null; // Optional link to habit
  cycleId?: string | null; // Optional link to cycle
  cyclePlanId?: string | null; // Optional link to cycle plan
  phase?: Phase | null;
  emoji?: string | null; // Optional emoji override
  // REMOVED: attitude (now on Habit/Area)
  tags?: string[];
  customMetric?: CustomMetric; // Keep for habit-inherited PUSHING support
  startTime?: string; // "HH:MM" — usually inherited from the habit's schedule
  durationMin?: number; // positive whole minutes
  refs?: readonly string[]; // URLs this moment refers to
}

/**
 * Validates the optional clock-time fields shared by create and update.
 */
function validateTiming(
  startTime: string | undefined,
  durationMin: number | undefined,
): string | null {
  if (startTime !== undefined && !isValidStartTime(startTime)) {
    return `Moment startTime must be HH:MM (24h), got: ${startTime}`;
  }
  if (
    durationMin !== undefined &&
    (!Number.isInteger(durationMin) || durationMin <= 0)
  ) {
    return "Moment durationMin must be a positive whole number of minutes";
  }
  return null;
}

/**
 * Creates a new unallocated moment
 *
 * @param props - Moment creation parameters
 * @returns New moment or error if validation fails
 */
export function createMoment(props: CreateMomentProps): MomentResult {
  const {
    name,
    areaId,
    habitId = null, // Default to null (orphaned)
    cycleId = null, // Default to null (no cycle)
    cyclePlanId = null, // Default to null (spontaneous)
    phase = null,
    emoji = null, // Default to null (inherits from habit/area)
    tags = [],
    customMetric, // Keep for habit-inherited PUSHING support
    startTime,
    durationMin,
    refs,
  } = props;

  const validation = validateMomentName(name);

  if (!validation.valid) {
    return { error: validation.error! };
  }

  if (!areaId || !areaId.trim()) {
    return { error: "Moment must have an areaId" };
  }

  const timingError = validateTiming(startTime, durationMin);
  if (timingError) {
    return { error: timingError };
  }

  const refsError = validateRefs(refs);
  if (refsError) {
    return { error: refsError };
  }

  const normalizedRefs = normalizeRefs(refs);
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    areaId: areaId.trim(),
    habitId: habitId ? habitId.trim() : null, // Trim or null
    cycleId: cycleId ? cycleId.trim() : null, // Trim or null
    cyclePlanId: cyclePlanId ? cyclePlanId.trim() : null, // Trim or null
    phase,
    day: null,
    order: 0,
    emoji: emoji ? emoji.trim() : null, // Trim or null
    ...(startTime !== undefined ? { startTime } : {}),
    ...(durationMin !== undefined ? { durationMin } : {}),
    customMetric,
    tags: tags.filter(validateTag),
    // Absent, not empty: one representation of "this moment refers to nothing".
    ...(normalizedRefs.length > 0 ? { refs: normalizedRefs } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Parameters for allocating a moment
 */
export interface AllocateMomentProps {
  day: string;
  phase: Phase;
  order: number;
}

/**
 * Allocates a moment to a specific day and phase
 *
 * @param moment - The moment to allocate
 * @param props - Allocation parameters
 * @returns Updated moment
 */
export function allocateMoment(
  moment: Moment,
  props: AllocateMomentProps,
): Moment {
  const { day, phase, order } = props;

  if (order < 0) {
    throw new Error("Order must be non-negative");
  }

  return {
    ...moment,
    day,
    phase,
    order,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Unallocates a moment, returning it to the drawing board
 *
 * @param moment - The moment to unallocate
 * @returns Updated moment with null day/phase
 */
export function unallocateMoment(moment: Moment): Moment {
  return {
    ...moment,
    day: null,
    phase: null,
    order: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Parameters for updating a moment's name
 */
export interface UpdateMomentNameProps {
  name: string;
}

/**
 * Updates the name of a moment
 *
 * @param moment - The moment to update
 * @param props - Update parameters
 * @returns Updated moment or error if validation fails
 */
export function updateMomentName(
  moment: Moment,
  props: UpdateMomentNameProps,
): MomentResult {
  const { name } = props;
  const validation = validateMomentName(name);

  if (!validation.valid) {
    return { error: validation.error! };
  }

  return {
    ...moment,
    name: name.trim(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Parameters for updating a moment's area
 */
export interface UpdateMomentAreaProps {
  areaId: string;
}

/**
 * Updates the area of a moment
 *
 * @param moment - The moment to update
 * @param props - Update parameters
 * @returns Updated moment or error if validation fails
 */
export function updateMomentArea(
  moment: Moment,
  props: UpdateMomentAreaProps,
): MomentResult {
  const { areaId } = props;

  if (!areaId || !areaId.trim()) {
    return { error: "Area ID cannot be empty" };
  }

  return {
    ...moment,
    areaId: areaId.trim(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Parameters for updating a moment's phase grouping
 */
export interface UpdateMomentPhaseGroupingProps {
  phase: Phase | null;
}

/**
 * Updates the phase grouping for an unallocated moment
 * Business rule: Only unallocated moments can have phase grouping
 *
 * @param moment - The moment to update
 * @param props - Update parameters
 * @returns Updated moment or error if validation fails
 */
export function updateMomentPhaseGrouping(
  moment: Moment,
  props: UpdateMomentPhaseGroupingProps,
): MomentResult {
  const { phase } = props;

  if (moment.day !== null) {
    return {
      error: "Cannot set phase grouping for allocated moments",
    };
  }

  return {
    ...moment,
    phase,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Parameters for overriding a moment's clock time.
 * `null` clears the field; `undefined` (absent) leaves it as-is.
 */
export interface UpdateMomentTimingProps {
  startTime?: string | null;
  durationMin?: number | null;
}

/**
 * Overrides the timing a moment inherited from its habit's schedule.
 * A moment can start at 12:15 when the habit says 12:00.
 */
export function updateMomentTiming(
  moment: Moment,
  props: UpdateMomentTimingProps,
): MomentResult {
  const { startTime, durationMin } = props;

  const timingError = validateTiming(
    startTime === null ? undefined : startTime,
    durationMin === null ? undefined : durationMin,
  );
  if (timingError) {
    return { error: timingError };
  }

  const next: Moment = {
    ...moment,
    ...(startTime !== undefined && startTime !== null ? { startTime } : {}),
    ...(durationMin !== undefined && durationMin !== null
      ? { durationMin }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  if (startTime === null) {
    delete next.startTime;
  }
  if (durationMin === null) {
    delete next.durationMin;
  }
  return next;
}

/**
 * Type guard to check if result is an error
 */
export function isMomentError(
  result: MomentResult,
): result is { error: string } {
  return "error" in result;
}

// ============================================================================
// Cycle Integration Helpers
// ============================================================================

/**
 * Checks if a moment is allocated to a day and phase
 *
 * @param moment - The moment to check
 * @returns True if moment has both day and phase set
 */
export function isAllocated(moment: Moment): boolean {
  return moment.day !== null && moment.phase !== null;
}

/**
 * Does this moment count as an allocation of intention?
 *
 * Tentative moments are proposals the calendar made; nothing uninvited is
 * ever counted as an intention the principal made (spec D5, hard invariant).
 * Every read that aggregates moments (health, cycle counts, heatmap density)
 * selects with this single predicate so the filters cannot drift apart.
 * Mirrored in mcp-server/health.ts, a separate package that deliberately
 * does not import from src/domain.
 */
export function countsAsAllocation(moment: Pick<Moment, "status">): boolean {
  return moment.status !== "tentative";
}

/**
 * Accepting is the one gesture that turns a calendar proposal into an
 * intention. Keeps externalRef: the moment stays linked to its event.
 */
export function acceptMoment(moment: Moment): Moment {
  if (moment.status !== "tentative") return moment;
  return {
    ...moment,
    status: "accepted",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Checks if a moment is in the cycle deck (unallocated but budgeted)
 *
 * @param moment - The moment to check
 * @returns True if moment is budgeted but not yet allocated
 */
export function isInDeck(moment: Moment): boolean {
  return !isAllocated(moment) && moment.cyclePlanId !== null;
}

/**
 * Checks if a moment is budgeted (created from a cycle plan)
 *
 * @param moment - The moment to check
 * @returns True if moment was created from a cycle plan
 */
export function isBudgeted(moment: Moment): boolean {
  return moment.cyclePlanId !== null;
}

/**
 * Checks if a moment is spontaneous (created ad-hoc, not from plan)
 *
 * @param moment - The moment to check
 * @returns True if moment was created ad-hoc (not from a cycle plan)
 */
export function isSpontaneous(moment: Moment): boolean {
  return moment.cyclePlanId === null;
}

// ============================================================================
// Habit membership
// ============================================================================

/**
 * True when a moment belongs to a habit — either it was planted against it, or
 * it names it among the people present.
 *
 * People ARE habit records, so one dinner with three friends is ONE moment
 * carrying three `personIds`; a health read of any of those three must see it.
 * For an ordinary habit `personIds` can never hold its own id, so the second
 * clause is provably inert there.
 *
 * Every read that derives a habit's history from the moment log selects with
 * this — `computeHealth` and the `daysSinceLast` emitted beside it — so the two
 * can never disagree about the same person. Mirrored in `mcp-server/health.ts`,
 * a separate package that deliberately does not import from `src/domain`.
 */
/**
 * Sort comparator: startTime first (timed before ambient), then order.
 */
export function compareMoments(a: Moment, b: Moment): number {
  const aTime = a.startTime ?? "";
  const bTime = b.startTime ?? "";
  if (aTime && bTime) return aTime.localeCompare(bTime) || a.order - b.order;
  if (aTime) return -1;
  if (bTime) return 1;
  return a.order - b.order;
}

export function momentInvolvesHabit(
  moment: Pick<Moment, "habitId" | "personIds">,
  habitId: string,
): boolean {
  return (
    moment.habitId === habitId || (moment.personIds?.includes(habitId) ?? false)
  );
}
