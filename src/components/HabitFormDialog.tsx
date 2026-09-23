"use client";

import { use$ } from "@legendapp/state/react";
import { AtSign, Clock, Layers, Plus, Timer, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AreaSelector } from "@/components/AreaSelector";
import { AreaSwatch } from "@/components/AreaSwatch";
import { AttitudeSelector } from "@/components/AttitudeSelector";
import { PhaseSelector } from "@/components/PhaseSelector";
import { RelationshipTagger } from "@/components/RelationshipTagger";
import {
  RhythmSelector,
  rhythmIcon,
  rhythmLabel,
} from "@/components/RhythmSelector";
import { TaggedNameInput } from "@/components/TaggedNameInput";
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
import type {
  CreateHabitProps,
  UpdateHabitProps,
} from "@/domain/entities/Habit";
import {
  getAttitudeIcon,
  getAttitudeLabel,
} from "@/domain/value-objects/Attitude";
import { PhaseIcon } from "@/domain/value-objects/phaseStyles";
import { useTaggedNameField } from "@/hooks/useTaggedNameField";
import { areas$, habits$, phaseConfigs$ } from "@/infrastructure/state/store";
import {
  closeHabitForm,
  habitFormState$,
  lastUsedAreaId$,
  openHabitFormCreate,
  openHabitFormEdit,
} from "@/infrastructure/state/ui-store";
import {
  extractLeadingEmoji,
  suggestEmojiForAreaName,
} from "@/lib/emoji-utils";

interface HabitFormDialogProps {
  /** Called when user saves the habit (create or update) */
  onSave: (props: CreateHabitProps | UpdateHabitProps) => void;
  /** For edit mode: called when user confirms deletion */
  onDelete?: () => void;
}

/**
 * HabitFormDialog - Dialog for creating/editing habits
 *
 * Matches MomentFormDialog UX:
 * - Large prominent name input (4xl font)
 * - Inline tag extraction from name (#tag)
 * - Area selection (A key)
 * - Emoji picker with auto-suggestion
 * - Enter to save, Escape to cancel
 */
export function HabitFormDialog({ onSave, onDelete }: HabitFormDialogProps) {
  // Read state from UI store - single source of truth
  const formState = use$(habitFormState$);
  const {
    open,
    mode,
    name,
    areaId,
    emoji,
    attitude,
    phase,
    tags,
    aliases,
    parentHabitId,
    durationMin,
    rhythm,
    editingHabitId,
  } = formState;

  // Local UI state only (not form data)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [areaSelectorOpen, setAreaSelectorOpen] = useState(false);
  const [attitudeSelectorOpen, setAttitudeSelectorOpen] = useState(false);
  const [phaseSelectorOpen, setPhaseSelectorOpen] = useState(false);
  const [aliasesSelectorOpen, setAliasesSelectorOpen] = useState(false);
  const [rhythmSelectorOpen, setRhythmSelectorOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [manualEmojiOverride, setManualEmojiOverride] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const areaSelectorRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastProcessedName = useRef<string>("");

  const allAreas = use$(areas$);
  const allPhaseConfigs = use$(phaseConfigs$);
  const selectedArea = areaId ? allAreas[areaId] : null;

  // Get phase config for display
  const selectedPhaseConfig = phase
    ? Object.values(allPhaseConfigs).find((pc) => pc.phase === phase)
    : null;

  // Tagged name field
  const taggedField = useTaggedNameField(name, tags);

  // Sync form state TO tagged field when dialog opens or editing habit changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds form state when the dialog opens; re-running on every dep change would discard edits
  useEffect(() => {
    if (!open) return;

    // Reinitialize field when opening dialog (create or edit mode)
    taggedField.reinitialize(name, tags);
  }, [open, editingHabitId]);

  // Sync typed text FROM tagged field back to form store (for emoji auto-suggestion)
  useEffect(() => {
    if (!open) return;
    habitFormState$.name.set(taggedField.displayValue);
  }, [taggedField.displayValue, open]);

  // Disable form hotkeys when area selector or emoji picker is open
  const formHotkeysEnabled =
    !areaSelectorOpen &&
    !emojiPickerOpen &&
    !taggedField.isAutocompleteOpen &&
    !taggedField.isMentionOpen &&
    !attitudeSelectorOpen &&
    !phaseSelectorOpen &&
    !aliasesSelectorOpen &&
    !rhythmSelectorOpen;

  // Reset local UI state when dialog opens
  useEffect(() => {
    if (open) {
      setValidationError(null);
      setManualEmojiOverride(false);
      lastProcessedName.current = "";
      setAreaSelectorOpen(false);
      setEmojiPickerOpen(false);
      setAttitudeSelectorOpen(false);
      setPhaseSelectorOpen(false);
      setAliasesSelectorOpen(false);
      setRhythmSelectorOpen(false);
    }
  }, [open]);

  // Auto-focus name input when dialog opens
  useEffect(() => {
    if (open && nameInputRef.current) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [open]);

  // Extract leading emoji from name and auto-suggest emoji
  useEffect(() => {
    if (manualEmojiOverride) return;
    if (name === lastProcessedName.current) return;

    lastProcessedName.current = name;

    const { emoji: leadingEmoji, remainingText } = extractLeadingEmoji(name);

    if (leadingEmoji && remainingText.length > 0) {
      habitFormState$.emoji.set(leadingEmoji);
      // Update both form store and tagged field to keep them in sync
      habitFormState$.name.set(remainingText);
      taggedField.reinitialize(remainingText, taggedField.tags);
      return;
    }

    // Auto-suggest emoji for new habits
    if (mode === "create" && !leadingEmoji && name.trim().length >= 2) {
      const suggested = suggestEmojiForAreaName(name);
      if (suggested) {
        habitFormState$.emoji.set(suggested);
      }
    }
  }, [name, mode, manualEmojiOverride, taggedField]);

  // Handlers
  const handleSave = () => {
    // Extract any remaining #tags and get fresh values (not stale React state)
    const { name: cleanName, tags: finalTags } =
      taggedField.extractRemainingTags();

    if (!cleanName) {
      setValidationError("Habit name cannot be empty");
      return;
    }

    if (!areaId) {
      setValidationError("Please select an area");
      return;
    }

    // Persist the selected area ID for future use
    lastUsedAreaId$.set(areaId);

    onSave({
      name: cleanName,
      areaId,
      emoji: emoji || null,
      attitude,
      phase,
      tags: finalTags,
      aliases,
      parentHabitId: parentHabitId ?? undefined,
      durationMin: durationMin ?? undefined,
      rhythm: rhythm ?? undefined,
    });

    closeHabitForm();
  };

  const handleEmojiSelect = (selectedEmoji: string) => {
    habitFormState$.emoji.set(selectedEmoji);
    setEmojiPickerOpen(false);
    setManualEmojiOverride(true);
  };

  const handleSelectArea = (selectedAreaId: string) => {
    habitFormState$.areaId.set(selectedAreaId);
    lastUsedAreaId$.set(selectedAreaId);
  };

  // Prevent closing on escape when inputs have focus or data exists
  const preventCloseOnEscape = (e: KeyboardEvent) => {
    // Check if the target was an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      // Blur the input naturally, but still prevent dialog close
      target.blur();
      // Always prevent dialog from closing
      e.preventDefault();
    } else if (name.trim().length > 0) {
      // If name has content, prevent closing to avoid losing data
      e.preventDefault();
    }
  };

  // Keyboard shortcuts
  useHotkeys(
    "enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    { enableOnFormTags: true, enabled: formHotkeysEnabled && open },
  );

  useHotkeys(
    "a",
    (e) => {
      e.preventDefault();
      setAreaSelectorOpen(true);
    },
    { enabled: formHotkeysEnabled && open },
  );

  useHotkeys(
    "r",
    (e) => {
      e.preventDefault();
      setRhythmSelectorOpen(true);
    },
    { enabled: formHotkeysEnabled && open },
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closeHabitForm()}>
      <DialogContent
        ref={dialogRef}
        className="p-0 gap-0 max-w-2xl"
        onEscapeKeyDown={preventCloseOnEscape}
      >
        {/* Header */}
        <DialogHeader className="border-b border-stone-200 dark:border-stone-700">
          <DialogTitle className="text-sm font-medium text-stone-600 dark:text-stone-400">
            {mode === "create" ? "New habit" : "Edit habit"}
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="px-6 py-6 flex-1 overflow-y-auto">
          {/* Name Input with Emoji - Prominent */}
          <div className="relative mb-6 w-full">
            <div className="flex items-baseline gap-3">
              {/* Emoji Picker */}
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
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
                    onEmojiSelect={({ emoji }) => handleEmojiSelect(emoji)}
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
                placeholder="Habit name..."
                autoFocus={true}
                className="flex-1 text-4xl font-bold"
                collisionBoundary={dialogRef.current}
                maxSuggestions={5}
                showTags={true}
              />
            </div>

            {/* Validation Error */}
            {validationError && (
              <p
                className="text-sm text-red-500 dark:text-red-400 mt-2"
                role="alert"
              >
                {validationError}
              </p>
            )}
          </div>

          {/* Area Selector */}
          {selectedArea && (
            <div className="mb-6">
              <label
                htmlFor="area-selector-trigger"
                className="block text-xs font-mono text-stone-500 dark:text-stone-400 mb-2"
              >
                Area
              </label>
              <AreaSelector
                open={areaSelectorOpen}
                selectedAreaId={areaId}
                onSelectArea={handleSelectArea}
                onClose={() => setAreaSelectorOpen(false)}
                onOpen={() => setAreaSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    ref={areaSelectorRef}
                    id="area-selector-trigger"
                    type="button"
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all text-white hover:opacity-90 w-full"
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
            </div>
          )}

          {/* Selected values shown as full-width buttons */}
          <div className="flex flex-col gap-3">
            {/* Aliases - Show as button if any set */}
            {aliases.length > 0 && (
              <AliasesSelector
                open={aliasesSelectorOpen}
                value={aliases}
                onChange={(next) => habitFormState$.aliases.set(next)}
                onOpen={() => setAliasesSelectorOpen(true)}
                onClose={() => setAliasesSelectorOpen(false)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <AtSign className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {aliases.join(", ")}
                    </span>
                    <kbd className="px-1.5 py-0.5 rounded text-xs font-mono bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 flex-shrink-0">
                      L
                    </kbd>
                  </button>
                }
              />
            )}

            {/* Attitude Selector - Show as button if selected */}
            {attitude && (
              <AttitudeSelector
                open={attitudeSelectorOpen}
                selectedAttitude={attitude}
                onSelectAttitude={(newAttitude) =>
                  habitFormState$.attitude.set(newAttitude)
                }
                onClose={() => setAttitudeSelectorOpen(false)}
                onOpen={() => setAttitudeSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <span className="text-base flex-shrink-0">
                      {getAttitudeIcon(attitude)}
                    </span>
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {getAttitudeLabel(attitude)}
                    </span>
                    <kbd className="px-1.5 py-0.5 rounded text-xs font-mono bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 flex-shrink-0">
                      T
                    </kbd>
                  </button>
                }
              />
            )}

            {/* Phase Selector - Show as button if selected */}
            {phase && (
              <PhaseSelector
                open={phaseSelectorOpen}
                selectedPhase={phase}
                onSelectPhase={(newPhase) =>
                  habitFormState$.phase.set(newPhase)
                }
                onClose={() => setPhaseSelectorOpen(false)}
                onOpen={() => setPhaseSelectorOpen(true)}
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

            {/* Duration - Show as button if set */}
            {durationMin && (
              <div className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 w-full">
                <Timer className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                <input
                  type="number"
                  min="1"
                  max="480"
                  value={durationMin}
                  onChange={(e) => {
                    const v = e.target.value
                      ? Number.parseInt(e.target.value, 10)
                      : null;
                    habitFormState$.durationMin.set(v && v > 0 ? v : null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                    }
                  }}
                  className="w-16 bg-transparent font-mono text-sm outline-none"
                />
                <span className="font-mono text-sm text-stone-400">min</span>
                <button
                  type="button"
                  onClick={() => habitFormState$.durationMin.set(null)}
                  className="ml-auto text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Variants - Show child habits if any exist (edit mode only) */}
            {mode === "edit" && editingHabitId && (
              <ChildHabitsList parentHabitId={editingHabitId} areaId={areaId} />
            )}

            {/* Relationships (edit mode only) */}
            {mode === "edit" && editingHabitId && (
              <RelationshipTagger
                entityType="habit"
                entityId={editingHabitId}
              />
            )}

            {/* Rhythm Selector - Show as button if selected */}
            {rhythm && (
              <RhythmSelector
                open={rhythmSelectorOpen}
                selectedRhythm={rhythm}
                onSelectRhythm={(newRhythm) =>
                  habitFormState$.rhythm.set(newRhythm)
                }
                onClose={() => setRhythmSelectorOpen(false)}
                onOpen={() => setRhythmSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <span className="text-base flex-shrink-0 font-mono text-stone-400 dark:text-stone-500">
                      {rhythmIcon(rhythm)}
                    </span>
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {rhythmLabel(rhythm)}
                    </span>
                    <kbd className="px-1.5 py-0.5 rounded text-xs font-mono bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 flex-shrink-0">
                      R
                    </kbd>
                  </button>
                }
              />
            )}
          </div>

          {/* Subtle wrapped row for empty selectors */}
          <div className="flex flex-wrap gap-3 items-center mt-8 mb-2">
            {/* Aliases - subtle label if none */}
            {aliases.length === 0 && (
              <AliasesSelector
                open={aliasesSelectorOpen}
                value={aliases}
                onChange={(next) => habitFormState$.aliases.set(next)}
                onOpen={() => setAliasesSelectorOpen(true)}
                onClose={() => setAliasesSelectorOpen(false)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <AtSign className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">no aliases</span>
                  </button>
                }
              />
            )}

            {/* Attitude - subtle label if not selected */}
            {!attitude && (
              <AttitudeSelector
                open={attitudeSelectorOpen}
                selectedAttitude={attitude}
                onSelectAttitude={(newAttitude) =>
                  habitFormState$.attitude.set(newAttitude)
                }
                onClose={() => setAttitudeSelectorOpen(false)}
                onOpen={() => setAttitudeSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">no attitude</span>
                  </button>
                }
              />
            )}

            {/* Phase - subtle label if not selected */}
            {!phase && (
              <PhaseSelector
                open={phaseSelectorOpen}
                selectedPhase={phase}
                onSelectPhase={(newPhase) =>
                  habitFormState$.phase.set(newPhase)
                }
                onClose={() => setPhaseSelectorOpen(false)}
                onOpen={() => setPhaseSelectorOpen(true)}
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

            {/* Duration - subtle label if not set */}
            {!durationMin && (
              <button
                type="button"
                onClick={() => habitFormState$.durationMin.set(30)}
                className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
              >
                <Timer className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="text-xs font-mono">no duration</span>
              </button>
            )}

            {/* Add variant - only in edit mode (need a saved habit to parent to) */}
            {mode === "edit" && editingHabitId && (
              <button
                type="button"
                onClick={() => {
                  closeHabitForm();
                  openHabitFormCreate({
                    areaId,
                    parentHabitId: editingHabitId,
                    attitude: attitude ?? undefined,
                    phase: phase ?? undefined,
                  });
                }}
                className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="text-xs font-mono">add variant</span>
              </button>
            )}

            {/* Rhythm - subtle label if not selected */}
            {!rhythm && (
              <RhythmSelector
                open={rhythmSelectorOpen}
                selectedRhythm={rhythm}
                onSelectRhythm={(newRhythm) =>
                  habitFormState$.rhythm.set(newRhythm)
                }
                onClose={() => setRhythmSelectorOpen(false)}
                onOpen={() => setRhythmSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <Timer className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">no rhythm</span>
                  </button>
                }
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="border-t border-stone-200 dark:border-stone-700 px-6 py-4">
          <div className="flex items-center justify-between w-full">
            {/* Delete Button (Edit mode only) */}
            {mode === "edit" && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-2 rounded-md text-xs font-mono text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Archive
              </button>
            )}

            <div className="flex gap-2 ml-auto">
              {/* Cancel Button */}
              <button
                type="button"
                onClick={closeHabitForm}
                className="px-4 py-2 rounded-lg font-mono text-sm bg-stone-200 hover:bg-stone-300 text-stone-900 dark:bg-stone-700 dark:hover:bg-stone-600 dark:text-stone-100 transition-colors"
              >
                Cancel
              </button>

              {/* Save Button */}
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 rounded-lg font-mono text-sm bg-stone-800 hover:bg-stone-900 text-white dark:bg-stone-200 dark:hover:bg-stone-300 dark:text-stone-900 transition-colors"
              >
                {mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AliasesSelectorProps {
  open: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  onOpen: () => void;
  onClose: () => void;
  trigger: React.ReactNode;
  collisionBoundary?: Element | null | Array<Element | null>;
}

function AliasesSelector({
  open,
  value,
  onChange,
  onOpen,
  onClose,
  trigger,
  collisionBoundary,
}: AliasesSelectorProps) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft("");
      return;
    }
    const lower = trimmed.toLowerCase();
    if (value.some((a) => a.toLowerCase() === lower)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          onOpen();
        } else {
          commitDraft();
          onClose();
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95 backdrop-blur-sm"
        collisionBoundary={collisionBoundary}
        side="bottom"
        sideOffset={4}
        onEscapeKeyDown={(e) => {
          // Escape discards the in-progress draft rather than committing it.
          e.preventDefault();
          setDraft("");
          onClose();
        }}
      >
        <div className="flex items-center gap-1.5 mb-2">
          <AtSign className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
          <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium">
            Aliases
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center border border-stone-200 dark:border-stone-700 rounded-md px-2 py-1.5 focus-within:border-stone-400 dark:focus-within:border-stone-500">
          {value.map((alias, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: aliases may repeat while being edited, so position disambiguates
              key={`${alias}-${index}`}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-xs font-mono text-stone-700 dark:text-stone-300"
            >
              {alias}
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                aria-label={`Remove alias ${alias}`}
              >
                <X className="w-3 h-3" strokeWidth={2} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draft}
            autoCapitalize="none"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                e.stopPropagation();
                // Block react-hotkeys-hook's document-level handler from
                // also firing the form-wide Enter-to-save binding.
                e.nativeEvent.stopImmediatePropagation();
                commitDraft();
              } else if (
                e.key === "Backspace" &&
                draft === "" &&
                value.length > 0
              ) {
                e.preventDefault();
                removeAt(value.length - 1);
              }
            }}
            placeholder={value.length === 0 ? "Add alias…" : ""}
            className="flex-1 min-w-[80px] bg-transparent text-xs font-mono text-stone-700 dark:text-stone-300 placeholder:text-stone-400 focus:outline-none"
          />
        </div>

        <p className="mt-2 text-[11px] font-mono text-stone-400 dark:text-stone-500">
          Enter to add. Alternate names that match when searching.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function ChildHabitsList({
  parentHabitId,
  areaId,
}: {
  parentHabitId: string;
  areaId: string;
}) {
  const allHabits = use$(habits$);
  const children = Object.values(allHabits).filter(
    (h) => h.parentHabitId === parentHabitId && !h.isArchived,
  );

  if (children.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium flex items-center gap-1.5">
        <Layers className="w-3 h-3" />
        Variants
      </span>
      {children.map((child) => (
        <button
          key={child.id}
          type="button"
          onClick={() => {
            closeHabitForm();
            openHabitFormEdit(child.id, child);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full text-left"
        >
          <span className="text-base flex-shrink-0">{child.emoji}</span>
          <span className="font-mono text-sm flex-1 min-w-0 truncate">
            {child.name}
          </span>
          {child.durationMin && (
            <span className="text-xs font-mono text-stone-400 flex-shrink-0">
              {child.durationMin}m
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
