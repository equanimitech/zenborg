/** biome-ignore-all lint/a11y/useButtonType: these are inside a form and submit is the intended default */
"use client";

import { use$, useSelector } from "@legendapp/state/react";
import { Clock, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AreaSelector } from "@/components/AreaSelector";
import { AreaSwatch } from "@/components/AreaSwatch";
import { PhaseSelector } from "@/components/PhaseSelector";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Habit } from "@/domain/entities/Habit";
import { validateMomentName } from "@/domain/entities/Moment";
import type { CustomMetric } from "@/domain/value-objects/Attitude";
import type { Phase } from "@/domain/value-objects/Phase";
import { PhaseIcon } from "@/domain/value-objects/phaseStyles";
import { snapToGrid } from "@/domain/value-objects/TimeGrid.ts";
import { useTaggedNameField } from "@/hooks/useTaggedNameField";
import {
  activeAreas$,
  areas$,
  habits$,
  phaseConfigs$,
} from "@/infrastructure/state/store";
import {
  closeMomentForm,
  lastUsedAreaId$,
  momentFormState$,
} from "@/infrastructure/state/ui-store";
import {
  extractLeadingEmoji,
  suggestEmojiForAreaName,
} from "@/lib/emoji-utils";
import { cn } from "@/lib/utils";
import { HabitAutocompleteInline } from "./HabitAutocompleteInline";
import { TaggedNameInput } from "./TaggedNameInput";

interface MomentFormDialogProps {
  onSave: (
    name: string,
    areaId: string,
    phase: Phase | null,
    createMore?: boolean,
    emoji?: string | null,
    tags?: string[],
    customMetric?: CustomMetric,
    startTime?: string,
    mentionIds?: string[],
  ) => void;
  /** For edit mode: called when user confirms deletion */
  onDelete?: () => void;
}

/**
 * MomentFormDialog - Dialog component for creating/editing moments
 *
 * Features:
 * - Name input with validation (1-3 words)
 * - Area selection: A (opens selector)
 * - Phase selection: P (opens selector)
 * - Enter to save, Escape to cancel
 * - Optional "Create more" toggle for batch creation
 *
 * Keyboard Navigation:
 * - Tab: Cycle forward through fields (input → area → phase)
 * - Shift+Tab: Cycle backward through fields
 * - Up/Down arrows: Navigate between fields
 * - A: Open area selector
 * - P: Open phase selector
 * - Enter: Save moment
 */
export function MomentFormDialog({ onSave, onDelete }: MomentFormDialogProps) {
  // Read state from UI store - now using the store as single source of truth
  const formState = use$(momentFormState$);
  const {
    open,
    mode,
    name,
    areaId: selectedAreaId,
    phase,
    showCreateMore,
    startTime,
    emoji,
    tags: formTags,
    customMetric,
    editingMomentId,
    mentionIds: formMentionIds,
    habitId,
  } = formState;

  const tags = useMemo(() => formTags || [], [formTags]);
  const mentionIds = useMemo(() => formMentionIds || [], [formMentionIds]);

  // Use activeAreas$ which filters out archived areas and sorts by order
  const areasList = useSelector(() => activeAreas$.get());

  const allPhaseConfigs = use$(phaseConfigs$);

  // Local UI state (not form data)
  const [isAreaSelectorOpen, setIsAreaSelectorOpen] = useState(false);
  const [isPhaseSelectorOpen, setIsPhaseSelectorOpen] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [manualEmojiOverride, setManualEmojiOverride] = useState(false);

  // Habit autocomplete state (create mode only)
  const [showHabitAutocomplete, setShowHabitAutocomplete] = useState(false);

  // Tag autocomplete state
  const lastProcessedName = useRef<string>("");

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const areaSelectorRef = useRef<HTMLButtonElement>(null);
  const phaseSelectorRef = useRef<HTMLButtonElement>(null);

  // Tagged name field
  const taggedField = useTaggedNameField(name, tags, mentionIds);

  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds form state when the dialog opens; re-running on every dep change would discard edits
  useEffect(() => {
    if (!open) return;

    // Reinitialize field when opening dialog (create or edit mode)
    taggedField.reinitialize(name, tags, mentionIds);
  }, [open, editingMomentId]);

  // Sync typed text FROM tagged field back to form store (for emoji auto-suggestion)
  useEffect(() => {
    if (!open) return;
    momentFormState$.name.set(taggedField.displayValue);
  }, [taggedField.displayValue, open]);

  // Reset local UI state when dialog opens
  useEffect(() => {
    if (!open) return;

    setCreateMore(false);
    setShowDeleteConfirm(false);
    setIsAreaSelectorOpen(false);
    setIsPhaseSelectorOpen(false);
  }, [open]);

  // Auto-focus and select input
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      if (mode === "edit") {
        inputRef.current.select();
      }
    }
  }, [mode, open]);

  // Extract leading emoji from name and auto-suggest emoji
  useEffect(() => {
    if (manualEmojiOverride) return;
    if (name === lastProcessedName.current) return;

    lastProcessedName.current = name;

    const { emoji: leadingEmoji, remainingText } = extractLeadingEmoji(name);

    if (leadingEmoji && remainingText.length > 0) {
      momentFormState$.emoji.set(leadingEmoji);
      // Update both form store and tagged field to keep them in sync
      momentFormState$.name.set(remainingText);
      taggedField.reinitialize(remainingText, taggedField.tags);
      return;
    }

    // Auto-suggest emoji for new moments
    if (mode === "create" && !leadingEmoji && name.trim().length >= 2) {
      const suggested = suggestEmojiForAreaName(name);
      if (suggested) {
        momentFormState$.emoji.set(suggested);
      }
    }
  }, [name, mode, manualEmojiOverride, taggedField]);

  // Reset habit autocomplete when dialog opens/closes
  useEffect(() => {
    if (!open) setShowHabitAutocomplete(false);
  }, [open]);

  // Handle habit selection from autocomplete
  const handleSelectHabit = (habit: Habit) => {
    momentFormState$.name.set(habit.name);
    momentFormState$.areaId.set(habit.areaId);
    momentFormState$.emoji.set(habit.emoji);
    momentFormState$.habitId.set(habit.id);
    if (habit.tags?.length) {
      momentFormState$.tags.set(habit.tags);
    }
    taggedField.reinitialize(habit.name, habit.tags || []);
    setShowHabitAutocomplete(false);
    setManualEmojiOverride(true);
    lastUsedAreaId$.set(habit.areaId);
  };

  // Disable form hotkeys when any selector is open to avoid conflicts
  const formHotkeysEnabled =
    !isAreaSelectorOpen &&
    !isPhaseSelectorOpen &&
    !taggedField.isAutocompleteOpen &&
    !taggedField.isMentionOpen &&
    !emojiPickerOpen &&
    !showHabitAutocomplete;

  // A - open area selector
  useHotkeys(
    "a",
    (e) => {
      e.preventDefault();
      setIsAreaSelectorOpen(true);
    },
    { enabled: formHotkeysEnabled && open },
  );

  // P - open phase selector
  useHotkeys(
    "p",
    (e) => {
      e.preventDefault();
      setIsPhaseSelectorOpen(true);
    },
    { enabled: formHotkeysEnabled && open },
  );

  // Get focusable elements in order
  const getFocusableElements = (): HTMLElement[] => {
    const elements: HTMLElement[] = [];
    if (inputRef.current) elements.push(inputRef.current);
    if (areaSelectorRef.current) elements.push(areaSelectorRef.current);
    if (phaseSelectorRef.current) elements.push(phaseSelectorRef.current);
    return elements;
  };

  // Tab to cycle through form fields (input → area → phase)
  useHotkeys(
    "tab",
    (e) => {
      e.preventDefault();
      const focusable = getFocusableElements();
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const nextIndex = (currentIndex + 1) % focusable.length;
      focusable[nextIndex]?.focus();
    },
    { enabled: formHotkeysEnabled && open, enableOnFormTags: true },
  );

  // Shift+Tab to cycle backwards
  useHotkeys(
    "shift+tab",
    (e) => {
      e.preventDefault();
      const focusable = getFocusableElements();
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const prevIndex =
        currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
      focusable[prevIndex]?.focus();
    },
    { enabled: formHotkeysEnabled && open, enableOnFormTags: true },
  );

  // Down arrow to move to next field
  useHotkeys(
    "down",
    (e) => {
      e.preventDefault();
      const focusable = getFocusableElements();
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const nextIndex = (currentIndex + 1) % focusable.length;
      focusable[nextIndex]?.focus();
    },
    { enabled: formHotkeysEnabled && open, enableOnFormTags: true },
  );

  // Up arrow to move to previous field
  useHotkeys(
    "up",
    (e) => {
      e.preventDefault();
      const focusable = getFocusableElements();
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const prevIndex =
        currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
      focusable[prevIndex]?.focus();
    },
    { enabled: formHotkeysEnabled && open, enableOnFormTags: true },
  );

  // Enter to save
  useHotkeys(
    "enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    { enableOnFormTags: true, enabled: formHotkeysEnabled && open },
  );

  const handleSave = () => {
    // Extract any remaining tags and get fresh values (not stale React state)
    const { name: cleanName, tags: finalTags } =
      taggedField.extractRemainingTags();

    const validation = validateMomentName(cleanName);
    const selectedArea =
      areasList.find((area) => area.id === selectedAreaId) || areasList[0];

    // Area is required - cannot save without an area
    if (!selectedArea) {
      return;
    }

    if (validation.valid) {
      // Persist the selected area ID for future use
      lastUsedAreaId$.set(selectedArea.id);

      // If "Create more" is enabled, pass it to parent
      const shouldCreateMore = mode === "create" && createMore;

      onSave(
        cleanName,
        selectedArea.id,
        phase,
        shouldCreateMore,
        emoji,
        finalTags,
        customMetric,
        startTime,
        taggedField.mentionIds,
      );

      // If "Create more" is enabled, reset form immediately
      // Parent will keep modal open, but preserve area and phase selection
      if (shouldCreateMore) {
        taggedField.reset();
        momentFormState$.habitId.set(null);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      }
    }
  };

  const handleDelete = () => {
    if (showDeleteConfirm && onDelete) {
      onDelete();
    } else {
      setShowDeleteConfirm(true);
      // Reset confirmation after 3 seconds
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  // Use useSelector to reactively get the selected area
  const selectedArea = useSelector(() =>
    selectedAreaId ? areas$[selectedAreaId].get() : undefined,
  );

  // Resolve linked habit name for display
  const linkedHabit = useSelector(() =>
    habitId ? habits$[habitId].get() : undefined,
  );

  // Validate name (remove tags for validation)
  const cleanNameForValidation = taggedField.displayValue
    .replace(/#([a-z0-9-]+)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const validation = validateMomentName(cleanNameForValidation);
  const hasArea = selectedArea !== undefined;
  const canSave = validation.valid && hasArea;

  // Get phase config for display
  const selectedPhaseConfig = phase
    ? Object.values(allPhaseConfigs).find((pc) => pc.phase === phase)
    : null;

  const preventCloseOnEscape = (e: KeyboardEvent) => {
    // Check if the target was an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      // Blur the input naturally, but still prevent dialog close
      target.blur();
      // Always prevent dialog from closing
      e.preventDefault();
    } else if (name.trim().length > 0) {
      // If name is empty, prevent closing to avoid losing data
      e.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closeMomentForm()}>
      <DialogContent
        ref={dialogRef}
        className="p-0 gap-0 max-w-2xl"
        onEscapeKeyDown={preventCloseOnEscape}
      >
        {/* Header */}
        <DialogHeader className="border-b border-stone-200 dark:border-stone-700">
          <DialogTitle className="text-sm font-medium text-stone-600 dark:text-stone-400">
            {mode === "create" ? "New moment" : "Edit moment"}
          </DialogTitle>
        </DialogHeader>

        {/* Habit provenance — barely-there top-left marker */}
        {habitId && linkedHabit ? (
          <div className="px-6 pt-3 flex items-center gap-1.5 text-stone-400 dark:text-stone-500">
            <span className="text-[11px] font-mono leading-none">↻</span>
            {linkedHabit.name !== name.trim() && (
              <span className="text-[11px] font-mono leading-none">
                {linkedHabit.name}
              </span>
            )}
            <button
              type="button"
              onClick={() => momentFormState$.habitId.set(null)}
              className="p-0.5 rounded opacity-0 hover:opacity-100 focus:opacity-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-opacity"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ) : !habitId && mode === "edit" ? (
          <button
            type="button"
            onClick={() => setShowHabitAutocomplete(true)}
            className="px-6 pt-3 flex items-center gap-1 text-stone-300 dark:text-stone-600 hover:text-stone-400 dark:hover:text-stone-500 transition-colors"
          >
            <span className="text-[11px] font-mono leading-none">↻</span>
            <span className="text-[11px] font-mono leading-none">
              link habit
            </span>
          </button>
        ) : null}

        {/* Content */}
        <div className="px-6 py-6 flex-1 overflow-y-auto">
          {/* Name Input with Emoji - Prominent */}
          <div className="relative mb-6 w-full">
            <HabitAutocompleteInline
              open={showHabitAutocomplete}
              searchValue={taggedField.displayValue}
              onSelectHabit={handleSelectHabit}
              onClose={() => setShowHabitAutocomplete(false)}
              collisionBoundary={dialogRef.current}
              maxSuggestions={5}
              trigger={
                <div className="flex items-baseline gap-3">
                  {/* Emoji Picker */}
                  <Popover
                    open={emojiPickerOpen}
                    onOpenChange={setEmojiPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="text-4xl flex-shrink-0 hover:bg-stone-100 dark:hover:bg-stone-800 rounded w-14 h-14 flex items-center justify-center transition-colors mt-1"
                        aria-label="Change emoji"
                      >
                        {emoji ||
                          (selectedArea?.emoji ? (
                            <span className="opacity-30">
                              {selectedArea?.emoji}
                            </span>
                          ) : (
                            selectedArea && (
                              <AreaSwatch color={selectedArea.color} />
                            )
                          ))}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-fit p-0" align="start">
                      <EmojiPicker
                        className="h-[342px]"
                        onEmojiSelect={({ emoji: selectedEmoji }) => {
                          momentFormState$.emoji.set(selectedEmoji);
                          setEmojiPickerOpen(false);
                          setManualEmojiOverride(true);
                        }}
                      >
                        <EmojiPickerSearch />
                        <EmojiPickerContent />
                        <EmojiPickerFooter />
                      </EmojiPicker>
                    </PopoverContent>
                  </Popover>

                  {/* Name Input with Tags */}
                  <TaggedNameInput
                    field={taggedField}
                    placeholder="Moment..."
                    autoFocus={true}
                    className="flex-1 text-4xl font-bold"
                    collisionBoundary={dialogRef.current}
                    maxSuggestions={5}
                    showTags={true}
                    onUserInput={(value) => {
                      if (mode === "create" && value.trim().length > 0) {
                        setShowHabitAutocomplete(true);
                      } else {
                        setShowHabitAutocomplete(false);
                      }
                    }}
                  />
                </div>
              }
            />

            {/* Validation */}
            {!validation.valid &&
              validation.error &&
              taggedField.displayValue.trim().length > 0 && (
                <p
                  className="text-sm text-red-500 dark:text-red-400 mt-2"
                  role="alert"
                >
                  {validation.error}
                </p>
              )}
          </div>

          {/* Selectors Row - Only show when area is selected */}
          {hasArea && selectedArea ? (
            <div className="flex flex-col gap-3">
              {/* Area Selector - Colored */}
              <AreaSelector
                open={isAreaSelectorOpen}
                selectedAreaId={selectedArea.id}
                onSelectArea={(areaId) => {
                  // Set the area ID immediately - it might be newly created
                  momentFormState$.areaId.set(areaId);
                  lastUsedAreaId$.set(areaId);
                }}
                onClose={() => setIsAreaSelectorOpen(false)}
                onOpen={() => setIsAreaSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    ref={areaSelectorRef}
                    type="button"
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all text-white hover:opacity-90"
                    style={{
                      backgroundColor: selectedArea.color,
                      borderColor: selectedArea.color,
                    }}
                  >
                    <span className="text-xl">{selectedArea.emoji}</span>
                    <span className="font-semibold flex-1 text-left">
                      {selectedArea.name}
                    </span>
                    <kbd className="px-1.5 py-0.5 rounded text-xs font-mono bg-white/20 text-white">
                      A
                    </kbd>
                  </button>
                }
              />

              {/* Selected values shown as full-width buttons */}
              <div className="flex flex-col gap-3">
                {/* Phase Selector - Show as button if selected */}
                {phase && (
                  <PhaseSelector
                    open={isPhaseSelectorOpen}
                    selectedPhase={phase}
                    onSelectPhase={(newPhase) => {
                      momentFormState$.phase.set(newPhase);
                    }}
                    onClose={() => setIsPhaseSelectorOpen(false)}
                    onOpen={() => setIsPhaseSelectorOpen(true)}
                    collisionBoundary={dialogRef.current}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                      >
                        <PhaseIcon
                          phase={phase}
                          className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0"
                        />
                        <span className="font-mono text-sm flex-1 text-left truncate">
                          {selectedPhaseConfig?.label}
                        </span>
                        <kbd className="px-1.5 py-0.5 rounded text-xs font-mono bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 flex-shrink-0">
                          P
                        </kbd>
                      </button>
                    }
                  />
                )}

                {/* Time selector - visible only when a phase is selected */}
                {phase && startTime && (
                  <div className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 w-full">
                    <Clock className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                    <input
                      type="time"
                      value={startTime}
                      step={900}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          const snapped = snapToGrid(val, 60);
                          momentFormState$.startTime.set(snapped.startTime);
                        }
                      }}
                      className="flex-1 bg-transparent text-sm font-mono focus:outline-none text-stone-600 dark:text-stone-400"
                    />
                    <button
                      type="button"
                      onClick={() => momentFormState$.startTime.set("")}
                      className="p-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 dark:text-stone-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Subtle wrapped row for empty selectors */}
              <div className="flex flex-wrap gap-3 items-center mt-8 mb-2">
                {/* Add time - subtle label if phase is set but no time */}
                {phase && !startTime && (
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      const h = String(now.getHours()).padStart(2, "0");
                      const snapped = snapToGrid(`${h}:00`, 60);
                      momentFormState$.startTime.set(snapped.startTime);
                    }}
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">add time</span>
                  </button>
                )}

                {/* Phase - subtle label if not selected */}
                {!phase && (
                  <PhaseSelector
                    open={isPhaseSelectorOpen}
                    selectedPhase={phase}
                    onSelectPhase={(newPhase) => {
                      momentFormState$.phase.set(newPhase);
                    }}
                    onClose={() => setIsPhaseSelectorOpen(false)}
                    onOpen={() => setIsPhaseSelectorOpen(true)}
                    collisionBoundary={dialogRef.current}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                      >
                        <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
                        <span className="text-xs font-mono">no phase</span>
                      </button>
                    }
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <AreaSelector
                open={isAreaSelectorOpen}
                selectedAreaId=""
                onSelectArea={(areaId) => {
                  // Set the area ID immediately - it might be newly created
                  momentFormState$.areaId.set(areaId);
                  lastUsedAreaId$.set(areaId);
                }}
                onClose={() => setIsAreaSelectorOpen(false)}
                onOpen={() => setIsAreaSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    ref={areaSelectorRef}
                    type="button"
                    className="w-full px-4 py-3 rounded-lg border-2 border-stone-300 dark:border-stone-600 transition-all text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-400 dark:hover:border-stone-500 flex items-center justify-center gap-2"
                  >
                    <span className="font-medium">Add area</span>
                    <kbd className="px-1.5 py-0.5 rounded text-xs font-mono bg-stone-100 dark:bg-stone-800">
                      A
                    </kbd>
                  </button>
                }
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex flex-row items-center justify-end gap-2">
          {/* Left side: Create more checkbox OR Delete button */}
          {showCreateMore && mode === "create" ? (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={createMore}
                onChange={(e) => setCreateMore(e.target.checked)}
                className="w-4 h-4 rounded border-stone-300 dark:border-stone-600 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:ring-2 focus:ring-stone-400 dark:focus:ring-stone-500 focus:ring-offset-0"
              />
              <span className="text-sm text-stone-600 dark:text-stone-400">
                Create more
              </span>
            </label>
          ) : mode === "edit" && onDelete ? (
            <button
              onClick={handleDelete}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
                showDeleteConfirm
                  ? "bg-red-500 dark:bg-red-600 text-white hover:bg-red-600 dark:hover:bg-red-700"
                  : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800",
              )}
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-sm">
                {showDeleteConfirm ? "Confirm delete?" : "Delete"}
              </span>
            </button>
          ) : (
            <div />
          )}

          {/* Right side: Save button */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "px-5 py-2 rounded-lg font-medium transition-all text-white",
              canSave
                ? "hover:opacity-90 active:scale-95"
                : "bg-stone-300 dark:bg-stone-700 text-stone-500 dark:text-stone-400 cursor-not-allowed",
            )}
            style={
              canSave && selectedArea
                ? {
                    backgroundColor: selectedArea.color,
                  }
                : undefined
            }
          >
            {mode === "create" ? "Create" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
