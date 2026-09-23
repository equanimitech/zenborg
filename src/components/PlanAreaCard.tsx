/** biome-ignore-all lint/a11y/noAutofocus: inline edit opens from a keyboard action, so focus has to follow it */
"use client";

import { Archive, MoreVertical, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AreaSwatch } from "@/components/AreaSwatch";
import { AttitudeChip } from "@/components/AttitudeChip";
import { AttitudeSelector } from "@/components/AttitudeSelector";
import { ColorPicker } from "@/components/ColorPicker";
import { PlanHabitsList } from "@/components/PlanHabitsList";
import { TagBadges } from "@/components/TagBadges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { Area } from "@/domain/entities/Area";
import type { Habit } from "@/domain/entities/Habit";
import type { Attitude } from "@/domain/value-objects/Attitude";
import { useTaggedNameField } from "@/hooks/useTaggedNameField";
import { cn } from "@/lib/utils";
import { TaggedNameInput } from "./TaggedNameInput";

interface PlanAreaCardProps {
  area: Area;
  habits: Habit[];
  onEditHabit: (habitId: string) => void;
  onArchiveHabit: (habitId: string) => void;
  onUpdateArea: (areaId: string, updates: Partial<Area>) => void;
  onArchiveArea: (areaId: string) => void;
  onCreateHabit: () => void;
}

/**
 * PlanAreaCard - Container for habits within an area (Plan page)
 *
 * Features:
 * - Editable area header (emoji, name, color)
 * - List of habits
 * - Prominent "Add habit" button
 * - Empty state with helpful guidance
 */
export function PlanAreaCard({
  area,
  habits,
  onEditHabit,
  onArchiveHabit,
  onUpdateArea,
  onArchiveArea,
  onCreateHabit,
}: PlanAreaCardProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [attitudeSelectorOpen, setAttitudeSelectorOpen] = useState(false);
  const _nameInputRef = useRef<HTMLInputElement>(null);

  // Tagged name field for area name editing
  const taggedField = useTaggedNameField(area.name, area.tags || []);

  // Sync area changes to tagged field (when tags are updated externally)
  // Only sync when NOT actively editing to avoid interfering with user input
  useEffect(() => {
    if (isEditingName) return;

    const areaName = area.name;
    const areaTags = area.tags || [];

    // Compare actual tag contents, not just length
    const tagsChanged =
      areaTags.length !== taggedField.tags.length ||
      areaTags.some((tag, i) => tag !== taggedField.tags[i]);

    if (areaName !== taggedField.name || tagsChanged) {
      taggedField.reinitialize(areaName, areaTags);
    }
  }, [area.name, area.tags, taggedField, isEditingName]);

  const handleSaveName = () => {
    // Extract any remaining tags and get fresh values (not stale React state)
    const { name: cleanName, tags: finalTags } =
      taggedField.extractRemainingTags();

    // Save if name OR tags changed (previously only saved on name change, losing tag edits)
    const nameChanged = cleanName && cleanName !== area.name;
    const existingTags = area.tags || [];
    const tagsChanged =
      finalTags.length !== existingTags.length ||
      finalTags.some((t, i) => t !== existingTags[i]);

    if (nameChanged || tagsChanged) {
      onUpdateArea(area.id, {
        name: cleanName || area.name,
        tags: finalTags,
      });
    }
    setIsEditingName(false);
  };

  // Enter to save name when editing (but not when autocomplete is open)
  useHotkeys(
    "enter",
    () => {
      handleSaveName();
    },
    {
      enableOnFormTags: true,
      enabled: isEditingName && !taggedField.isAutocompleteOpen,
    },
    [
      taggedField.displayValue,
      taggedField.tags,
      taggedField.isAutocompleteOpen,
    ],
  );

  // Escape to cancel name editing
  useHotkeys(
    "escape",
    () => {
      taggedField.reset();
      setIsEditingName(false);
    },
    { enableOnFormTags: true, enabled: isEditingName },
    [area.name, taggedField],
  );

  const handleEmojiSelect = (selectedEmoji: string) => {
    onUpdateArea(area.id, { emoji: selectedEmoji });
    setEmojiPickerOpen(false);
  };

  const handleColorChange = (newColor: string) => {
    onUpdateArea(area.id, { color: newColor });
  };

  const handleAttitudeChange = (attitude: Attitude | null) => {
    onUpdateArea(area.id, { attitude });
    setAttitudeSelectorOpen(false);
  };

  return (
    <div
      className="flex flex-col border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow min-w-[300px] max-w-[340px]"
      style={{
        backgroundColor: `${area.color}08`, // 5% opacity background
      }}
    >
      {/* Area Header - Consolidated with all controls */}
      <div className="group relative px-4 py-3 border-b border-stone-200 dark:border-stone-700 bg-white/50 dark:bg-stone-900/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Left: Emoji + Name */}
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            {/* Emoji + Name Row */}
            <div className="flex items-center gap-2">
              {/* Emoji Picker */}
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="text-2xl flex-shrink-0 hover:bg-stone-100 dark:hover:bg-stone-800 rounded w-10 h-10 flex items-center justify-center transition-colors"
                    aria-label="Change emoji"
                  >
                    {area.emoji || <AreaSwatch color={area.color} />}
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

              {/* Area Name - Editable with tag extraction */}
              <div className="flex-1 min-w-0">
                {isEditingName ? (
                  <TaggedNameInput
                    field={taggedField}
                    placeholder="Area name..."
                    autoFocus={true}
                    className="w-full px-2 py-1 text-lg font-mono font-semibold bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-600 rounded focus:outline-none focus:border-stone-400 dark:focus:border-stone-500"
                    maxSuggestions={5}
                    showTags={false}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingName(true)}
                    className="w-full text-left px-2 py-1 text-lg font-mono font-semibold text-stone-900 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 rounded transition-colors truncate"
                  >
                    {area.name}
                  </button>
                )}
              </div>

              {/* Right: Color Picker + Settings Dropdown */}
              <div className="flex-shrink-0 flex h-full items-center gap-2">
                {/* Color Picker (inline) */}
                <ColorPicker value={area.color} onChange={handleColorChange} />

                {/* Settings Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded transition-colors"
                      aria-label="Area settings"
                    >
                      <MoreVertical className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => onArchiveArea(area.id)}
                      className="text-red-600 dark:text-red-400"
                    >
                      <Archive className="w-4 h-4 mr-2" />
                      Archive Area
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Tags + Attitude Row */}
            {((area.tags && area.tags.length > 0) || area.attitude) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Attitude Selector */}
                {area.attitude && (
                  <AttitudeSelector
                    open={attitudeSelectorOpen}
                    selectedAttitude={area.attitude}
                    onSelectAttitude={handleAttitudeChange}
                    onClose={() => setAttitudeSelectorOpen(false)}
                    onOpen={() => setAttitudeSelectorOpen(true)}
                    trigger={
                      <AttitudeChip
                        attitude={area.attitude}
                        onClick={() => setAttitudeSelectorOpen(true)}
                      />
                    }
                  />
                )}

                {/* Tag Badges */}
                {area.tags && area.tags.length > 0 && (
                  <TagBadges
                    tags={area.tags}
                    onRemoveTag={(tag) => {
                      const updatedTags = (area.tags || []).filter(
                        (t) => t !== tag,
                      );
                      onUpdateArea(area.id, { tags: updatedTags });
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Habits List - Fixed height for consistent drop zone */}
      <div className="p-4 overflow-y-auto h-[280px]">
        {habits.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-3 opacity-20">{area.emoji}</div>
            <p className="text-sm text-stone-500 dark:text-stone-400 font-mono">
              No habits yet
            </p>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
              Click "Add habit" below
            </p>
          </div>
        ) : (
          <PlanHabitsList
            habits={habits}
            areaId={area.id}
            areaColor={area.color}
            onEditHabit={onEditHabit}
            onArchiveHabit={onArchiveHabit}
          />
        )}
      </div>

      {/* Add Habit Button - Prominent and discoverable */}
      <div className="px-4 pb-4 pt-2 border-t border-stone-200 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-900/50">
        <button
          type="button"
          onClick={onCreateHabit}
          className={cn(
            "w-full px-4 py-2.5 rounded-md",
            "flex items-center justify-center gap-2",
            "text-sm font-mono font-medium",
            "bg-white dark:bg-stone-900",
            "border-2 border-stone-300 dark:border-stone-600",
            "hover:border-stone-400 dark:hover:border-stone-500",
            "hover:shadow-sm",
            "text-stone-700 dark:text-stone-300",
            "transition-all duration-150",
            "group/button",
          )}
          style={{
            borderColor: `${area.color}40`, // 25% opacity
          }}
        >
          <Plus className="w-4 h-4 group-hover/button:scale-110 transition-transform" />
          <span>Add habit</span>
        </button>
      </div>
    </div>
  );
}
