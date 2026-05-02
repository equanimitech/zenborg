import { observable } from "@legendapp/state";
import type { Moment } from "@/domain/entities/Moment";
import type { Attitude, CustomMetric } from "@/domain/value-objects/Attitude";
import type { Phase } from "@/domain/value-objects/Phase";
import type { Rhythm } from "@/domain/value-objects/Rhythm";

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
  /** Attitudes & Tags (Phase 2 features) */
  emoji: string | null;
  attitude: Attitude | null;
  tags?: string[];
  customMetric?: CustomMetric;
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
  // Use provided areaId, or fall back to last used area
  const areaId = params?.areaId || lastUsedAreaId$.peek() || "";

  // If day and phase are provided, the moment is being created for a specific timeline cell
  const isAllocated = !!(params?.day && params?.phaseStr);

  momentFormState$.set({
    open: true,
    mode: "create",
    name: "",
    areaId,
    phase: params?.phase ?? null,
    isAllocated,
    showCreateMore: true,
    editingMomentId: null,
    prefilledAllocation:
      params?.day && params?.phaseStr
        ? { day: params.day, phase: params.phaseStr }
        : null,
    emoji: null,
    attitude: params?.attitude ?? null,
    tags: [],
    customMetric: undefined,
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
    emoji: moment.emoji || null,
    attitude: null, // Will be inherited from habit/area in the component
    tags: moment.tags || [],
    customMetric: moment.customMetric,
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
  rhythm: Rhythm | null;
  /** For edit mode: the habit ID being edited */
  editingHabitId: string | null;
}

export const habitFormState$ = observable<HabitFormState>({
  open: false,
  mode: "create",
  name: "",
  areaId: "",
  emoji: "⭐",
  attitude: null,
  phase: null,
  tags: [],
  aliases: [],
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
}) {
  // Use provided areaId, or fall back to last used area
  const areaId = params?.areaId || lastUsedAreaId$.peek() || "";

  habitFormState$.set({
    open: true,
    mode: "create",
    name: "",
    areaId,
    emoji: "⭐",
    attitude: params?.attitude ?? null,
    phase: params?.phase ?? null,
    tags: [],
    aliases: [],
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
    rhythm?: Rhythm | null;
  },
) {
  habitFormState$.set({
    open: true,
    mode: "edit",
    name: habit.name,
    areaId: habit.areaId,
    emoji: habit.emoji || "⭐",
    attitude: habit.attitude,
    phase: habit.phase,
    tags: habit.tags || [],
    aliases: habit.aliases ?? [],
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
    emoji: "⭐",
    attitude: null,
    phase: null,
    tags: [],
    aliases: [],
    rhythm: null,
    editingHabitId: null,
  });
}

/**
 * Archive area confirmation dialog state
 * Controls the area archival confirmation modal
 * Ephemeral - not persisted
 *
 * Note: Areas are never truly deleted - they are archived to preserve
 * data integrity for historical moments that reference them.
 */
export interface ArchiveAreaDialogState {
  open: boolean;
  areaId: string | null;
  areaName: string | null;
}

export const archiveAreaDialogState$ = observable<ArchiveAreaDialogState>({
  open: false,
  areaId: null,
  areaName: null,
});

/**
 * Helper function to open archive area dialog
 */
export function openArchiveAreaDialog(areaId: string, areaName: string) {
  archiveAreaDialogState$.set({
    open: true,
    areaId,
    areaName,
  });
}

/**
 * Helper function to close archive area dialog
 */
export function closeArchiveAreaDialog() {
  archiveAreaDialogState$.set({
    open: false,
    areaId: null,
    areaName: null,
  });
}

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
