import { observable } from "@legendapp/state";
import type { Moment } from "@/domain/entities/Moment";
import type { Attitude, CustomMetric } from "@/domain/value-objects/Attitude";
import type { Phase } from "@/domain/value-objects/Phase";
import type { Rhythm } from "@/domain/value-objects/Rhythm";
import { getTodayISO } from "@/lib/dates";

/**
 * UI State Store - Transient application state
 *
 * This store contains ephemeral UI state that doesn't need to be persisted
 * to IndexedDB or synced to the backend. Examples:
 * - Last used area ID (for convenience, not critical data)
 * - UI preferences (theme, collapsed sections, etc.)
 * - Temporary UI state (loading states, error messages)
 * - Focus state
 * - Modal/drawer open states
 *
 * Design decision: Use localStorage for UI preferences that should persist
 * across sessions, but keep state in-memory by default for performance.
 */

// ============================================================================
// UI Preferences (persisted to localStorage)
// ============================================================================

/**
 * Last used area ID - for preserving area selection in Create mode
 * Persisted to localStorage (lightweight, synchronous, UI-only)
 */
export const lastUsedAreaId$ = observable<string | null>(null);

/**
 * Duplicate mode flag for drag & drop
 * True when Option/Alt is held during drag operations
 * Ephemeral - not persisted
 */
export const isDuplicateMode$ = observable<boolean>(false);

/**
 * Cycle deck collapsed state
 * Controls whether the CycleDeck panel is visible or collapsed (header only)
 * Ephemeral - not persisted
 */
export const cycleDeckCollapsed$ = observable<boolean>(false);

/**
 * Cycle deck edit mode
 * Controls whether count controls and editing features are shown
 * Ephemeral - not persisted
 */
export const cycleDeckEditMode$ = observable<boolean>(false);

export type CultivateZoom = "phase" | "time";

export const cultivateZoom$ = observable<CultivateZoom>("phase");

export type PlantEntity = "habits" | "people" | "places";
export type HabitGroupBy = "area" | "attitude" | "phase" | "tag";
export type PeopleGroupBy = "tag" | "place";
export type PlacesGroupBy = "tree" | "map";
export type PlantGroupBy = HabitGroupBy | PeopleGroupBy | PlacesGroupBy;

export interface PlantViewConfig {
  entity: PlantEntity;
  groupBy: PlantGroupBy;
  filter: string;
}

const ENTITY_DEFAULTS: Record<PlantEntity, PlantGroupBy> = {
  habits: "area",
  people: "tag",
  places: "tree",
};

export const plantViewConfig$ = observable<PlantViewConfig>({
  entity: "habits",
  groupBy: "area",
  filter: "",
});

export function setPlantEntity(entity: PlantEntity): void {
  plantViewConfig$.set({
    entity,
    groupBy: ENTITY_DEFAULTS[entity],
    filter: "",
  });
}

export function setPlantGroupBy(groupBy: PlantGroupBy): void {
  plantViewConfig$.groupBy.set(groupBy);
}

export function setPlantFilter(filter: string): void {
  plantViewConfig$.filter.set(filter);
}

/**
 * Day-note inline-edit state.
 * `editingDay` is the ISO date currently being edited (null = no edit).
 * `draft` is the in-flight title text. Ephemeral, not persisted.
 */
export const dayNoteEditState$ = observable<{
  editingDay: string | null;
  draft: string;
}>({
  editingDay: null,
  draft: "",
});

export function openDayNoteEdit(date: string, currentTitle: string): void {
  dayNoteEditState$.set({ editingDay: date, draft: currentTitle });
}

export function closeDayNoteEdit(): void {
  dayNoteEditState$.set({ editingDay: null, draft: "" });
}

/**
 * In-flight preview for a cycle resize drag.
 * Set on pointerdown of a CycleResizeHandle, mutated on each move, cleared
 * on release. Drives a translucent overlay rendered by BandedHeatmap so the
 * user sees the candidate range update smoothly while dragging — without
 * committing the new dates until release.
 */
export const cycleResizePreview$ = observable<{
  cycleId: string;
  edge: "start" | "end";
  date: string;
} | null>(null);

/**
 * Brief highlight on a cycle whose neighbor blocked an in-flight resize.
 * Auto-clears 300ms after being set. Read by `BandedHeatmapCycleBlock`.
 */
export const cycleClampHighlight$ = observable<{ cycleId: string } | null>(
  null,
);

let clampClearTimer: ReturnType<typeof setTimeout> | null = null;

export function flashCycleClamp(cycleId: string): void {
  cycleClampHighlight$.set({ cycleId });
  if (clampClearTimer) clearTimeout(clampClearTimer);
  clampClearTimer = setTimeout(() => {
    cycleClampHighlight$.set(null);
    clampClearTimer = null;
  }, 300);
}

/**
 * Currently selected cycle ID for the CycleDeck pane
 * When null, defaults to the active cycle
 * Ephemeral - not persisted
 */
export const cycleDeckSelectedCycleId$ = observable<string | null>(null);

/**
 * Currently selected season for the Harvest pane
 * When null, harvest opens on the most recently closed season
 * Ephemeral - not persisted: which season you last read back is not a
 * preference, and harvest should open on what just closed
 */
export const harvestSelectedCycleId$ = observable<string | null>(null);

// ============================================================================
// Focus State (for keyboard navigation)
// ============================================================================

/**
 * Currently focused moment ID (for keyboard navigation)
 * Ephemeral - not persisted
 */
export const focusedMomentId$ = observable<string | null>(null);

/**
 * Currently focused timeline cell (for keyboard navigation)
 * Ephemeral - not persisted
 */
export const focusedCell$ = observable<{
  day: string;
  phase: import("@/domain/value-objects/Phase").Phase;
} | null>(null);

/**
 * Day selected in the cycle heatmap. Drives Timeline scroll/expand.
 * Ephemeral - not persisted. null = no override (Timeline anchors on today).
 */
export const selectedDay$ = observable<string | null>(null);

// ============================================================================
// Modal/Dialog State
// ============================================================================

/**
 * Moment form dialog state
 * Controls the create/edit moment modal
 * Ephemeral - not persisted
 */
export interface MomentFormState {
  open: boolean;
  mode: "create" | "edit";
  /** Form field values - directly editable via the store */
  name: string;
  areaId: string;
  phase: Phase | null;
  isAllocated: boolean;
  showCreateMore: boolean;
  /** For edit mode: the moment ID being edited */
  editingMomentId: string | null;
  /** For create mode: prefilled allocation data (when creating from timeline click) */
  prefilledAllocation: {
    day?: string;
    phase?: string;
  } | null;
  /** Clock time, shown in the form when a phase is selected */
  startTime?: string;
  /** Attitudes & Tags (Phase 2 features) */
  emoji: string | null;
  attitude: Attitude | null;
  tags?: string[];
  customMetric?: CustomMetric;
  mentionIds?: string[];
  habitId: string | null;
}

export const momentFormState$ = observable<MomentFormState>({
  open: false,
  mode: "create",
  name: "",
  areaId: "",
  phase: null,
  isAllocated: false,
  showCreateMore: false,
  editingMomentId: null,
  prefilledAllocation: null,
  emoji: null,
  attitude: null,
  tags: [],
  customMetric: undefined,
  mentionIds: [],
  habitId: null,
});

/**
 * Helper function to open moment form in create mode
 */
export function openMomentFormCreate(params?: {
  areaId?: string;
  phase?: Phase | null;
  day?: string;
  phaseStr?: string;
  attitude?: Attitude;
}) {
  const areaId = params?.areaId || lastUsedAreaId$.peek() || "";
  const day = params?.day || selectedDay$.peek() || getTodayISO();
  const phaseStr = params?.phaseStr;
  const isAllocated = !!(day && phaseStr);

  momentFormState$.set({
    open: true,
    mode: "create",
    name: "",
    areaId,
    phase: params?.phase ?? null,
    isAllocated,
    showCreateMore: true,
    editingMomentId: null,
    prefilledAllocation: day && phaseStr ? { day, phase: phaseStr } : null,
    emoji: null,
    attitude: params?.attitude ?? null,
    tags: [],
    customMetric: undefined,
    mentionIds: [],
    habitId: null,
  });
}

/**
 * Helper function to open moment form in edit mode
 */
export function openMomentFormEdit(momentId: string, moment: Moment) {
  // Note: attitude is now inherited from habit or area, not stored on moment
  // The form state keeps attitude for display/editing purposes
  momentFormState$.set({
    open: true,
    mode: "edit",
    name: moment.name,
    areaId: moment.areaId,
    phase: moment.phase,
    isAllocated: !!(moment.day && moment.phase),
    showCreateMore: false,
    editingMomentId: momentId,
    prefilledAllocation: null,
    startTime: moment.startTime,
    emoji: moment.emoji || null,
    attitude: null,
    tags: moment.tags || [],
    customMetric: moment.customMetric,
    mentionIds: [...(moment.personIds || []), ...(moment.placeIds || [])],
    habitId: moment.habitId,
  });
}

/**
 * Helper function to close moment form
 */
export function closeMomentForm() {
  momentFormState$.set({
    open: false,
    mode: "create",
    name: "",
    areaId: "",
    phase: null,
    isAllocated: false,
    showCreateMore: false,
    editingMomentId: null,
    prefilledAllocation: null,
    emoji: null,
    attitude: null,
    tags: [],
    customMetric: undefined,
    mentionIds: [],
    habitId: null,
  });
}

/**
 * Habit form dialog state
 * Controls the create/edit habit modal
 * Ephemeral - not persisted
 */
export interface HabitFormState {
  open: boolean;
  mode: "create" | "edit";
  /** Form field values - directly editable via the store */
  name: string;
  areaId: string;
  emoji: string | null;
  attitude: Attitude | null;
  phase: Phase | null;
  tags: string[];
  aliases: string[];
  parentHabitId: string | null;
  durationMin: number | null;

  rhythm: Rhythm | null;
  /** For edit mode: the habit ID being edited */
  editingHabitId: string | null;
}

export const habitFormState$ = observable<HabitFormState>({
  open: false,
  mode: "create",
  name: "",
  areaId: "",
  emoji: null,
  attitude: null,
  phase: null,
  tags: [],
  aliases: [],
  parentHabitId: null,
  durationMin: null,

  rhythm: null,
  editingHabitId: null,
});

/**
 * Helper function to open habit form in create mode
 */
export function openHabitFormCreate(params?: {
  areaId?: string;
  attitude?: Attitude;
  phase?: Phase;
  parentHabitId?: string;
}) {
  // Use provided areaId, or fall back to last used area
  const areaId = params?.areaId || lastUsedAreaId$.peek() || "";

  habitFormState$.set({
    open: true,
    mode: "create",
    name: "",
    areaId,
    emoji: null,
    attitude: params?.attitude ?? null,
    phase: params?.phase ?? null,
    tags: [],
    aliases: [],
    parentHabitId: params?.parentHabitId ?? null,
    durationMin: null,

    rhythm: null,
    editingHabitId: null,
  });
}

/**
 * Helper function to open habit form in edit mode
 */
export function openHabitFormEdit(
  habitId: string,
  habit: {
    name: string;
    areaId: string;
    emoji: string | null;
    attitude: Attitude | null;
    phase: Phase | null;
    tags: string[];
    aliases?: string[];
    parentHabitId?: string;
    durationMin?: number;
    rhythm?: Rhythm | null;
  },
) {
  habitFormState$.set({
    open: true,
    mode: "edit",
    name: habit.name,
    areaId: habit.areaId,
    emoji: habit.emoji || null,
    attitude: habit.attitude,
    phase: habit.phase,
    tags: habit.tags || [],
    aliases: habit.aliases ?? [],
    parentHabitId: habit.parentHabitId ?? null,
    durationMin: habit.durationMin ?? null,
    rhythm: habit.rhythm ?? null,
    editingHabitId: habitId,
  });
}

/**
 * Helper function to close habit form
 */
export function closeHabitForm() {
  habitFormState$.set({
    open: false,
    mode: "create",
    name: "",
    areaId: "",
    emoji: null,
    attitude: null,
    phase: null,
    tags: [],
    aliases: [],
    parentHabitId: null,
    durationMin: null,
    rhythm: null,
    editingHabitId: null,
  });
}

export interface DeleteAreaDialogState {
  open: boolean;
  areaId: string | null;
  areaName: string | null;
}

export const deleteAreaDialogState$ = observable<DeleteAreaDialogState>({
  open: false,
  areaId: null,
  areaName: null,
});

export function openDeleteAreaDialog(areaId: string, areaName: string) {
  deleteAreaDialogState$.set({
    open: true,
    areaId,
    areaName,
  });
}

export function closeDeleteAreaDialog() {
  deleteAreaDialogState$.set({
    open: false,
    areaId: null,
    areaName: null,
  });
}

// ============================================================================
// Person Form State
// ============================================================================

export interface PersonFormState {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  emoji: string | null;
  aliases: string[];
  tags: string[];
  cadence: import("@/domain/value-objects/Cadence").Cadence | null;
  editingPersonId: string | null;
}

export const personFormState$ = observable<PersonFormState>({
  open: false,
  mode: "create",
  name: "",
  emoji: null,
  aliases: [],
  tags: [],
  cadence: null,
  editingPersonId: null,
});

export function openPersonFormCreate(params?: { tag?: string }) {
  personFormState$.set({
    open: true,
    mode: "create",
    name: "",
    emoji: null,
    aliases: [],
    tags: params?.tag ? [params.tag] : [],
    cadence: null,
    editingPersonId: null,
  });
}

export function openPersonFormEdit(
  personId: string,
  person: {
    name: string;
    emoji: string | null;
    aliases?: string[];
    tags: string[];
    cadence: import("@/domain/value-objects/Cadence").Cadence | null;
  },
) {
  personFormState$.set({
    open: true,
    mode: "edit",
    name: person.name,
    emoji: person.emoji,
    aliases: person.aliases ?? [],
    tags: person.tags ?? [],
    cadence: person.cadence,
    editingPersonId: personId,
  });
}

export function closePersonForm() {
  personFormState$.set({
    open: false,
    mode: "create",
    name: "",
    emoji: null,
    aliases: [],
    tags: [],
    cadence: null,
    editingPersonId: null,
  });
}

export interface PlaceFormState {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  emoji: string | null;
  parentKey: string | null;
  lat: string;
  lng: string;
  address: string;
  url: string;
  tags: string[];
  aliases: string[];
  editingPlaceId: string | null;
}

export const placeFormState$ = observable<PlaceFormState>({
  open: false,
  mode: "create",
  name: "",
  emoji: null,
  parentKey: null,
  lat: "",
  lng: "",
  address: "",
  url: "",
  tags: [],
  aliases: [],
  editingPlaceId: null,
});

export function openPlaceFormEdit(
  placeId: string,
  place: {
    name: string;
    emoji: string | null;
    parentKey: string | null;
    coordinates: { lat: number; lng: number } | null;
    address: string | null;
    url: string | null;
    tags: string[];
    aliases?: string[];
  },
) {
  placeFormState$.set({
    open: true,
    mode: "edit",
    name: place.name,
    emoji: place.emoji,
    parentKey: place.parentKey,
    lat: place.coordinates?.lat.toString() ?? "",
    lng: place.coordinates?.lng.toString() ?? "",
    address: place.address ?? "",
    url: place.url ?? "",
    tags: place.tags ?? [],
    aliases: place.aliases ?? [],
    editingPlaceId: placeId,
  });
}

export function closePlaceForm() {
  placeFormState$.set({
    open: false,
    mode: "create",
    name: "",
    emoji: null,
    parentKey: null,
    lat: "",
    lng: "",
    address: "",
    url: "",
    tags: [],
    aliases: [],
    editingPlaceId: null,
  });
}

// ============================================================================
// Gap Timer State
// ============================================================================

export interface GapTimerState {
  active: boolean;
  habitName: string;
  /** Total duration in ms */
  durationMs: number;
  /** Timestamp when started */
  startedAt: number;
}

export const gapTimer$ = observable<GapTimerState>({
  active: false,
  habitName: "",
  durationMs: 0,
  startedAt: 0,
});

let gapTimerTimeout: ReturnType<typeof setTimeout> | null = null;

export function startGapTimer(habitName: string, durationMs: number): void {
  if (gapTimerTimeout) clearTimeout(gapTimerTimeout);
  gapTimer$.set({
    active: true,
    habitName,
    durationMs,
    startedAt: Date.now(),
  });
  gapTimerTimeout = setTimeout(() => {
    clearGapTimer();
  }, durationMs);
}

export function clearGapTimer(): void {
  if (gapTimerTimeout) {
    clearTimeout(gapTimerTimeout);
    gapTimerTimeout = null;
  }
  gapTimer$.set({ active: false, habitName: "", durationMs: 0, startedAt: 0 });
}

/**
 * Settings modal visibility
 * Ephemeral - not persisted
 */
export const isSettingsOpen$ = observable<boolean>(false);

/**
 * Command Palette visibility
 * Ephemeral - not persisted
 */
export const isCommandPaletteOpen$ = observable<boolean>(false);

/**
 * Command Palette page state
 * Tracks the two-level navigation: root search vs entity action submenu
 * Ephemeral - not persisted
 */
export interface CommandPaletteState {
  page: "root" | "entity-actions";
  selectedEntity: {
    type: "area" | "habit" | "moment";
    id: string;
  } | null;
}

export const commandPaletteState$ = observable<CommandPaletteState>({
  page: "root",
  selectedEntity: null,
});

/**
 * Reset command palette state to defaults (called on close)
 */
export function resetCommandPaletteState() {
  commandPaletteState$.set({ page: "root", selectedEntity: null });
}
