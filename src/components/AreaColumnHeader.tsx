/** biome-ignore-all lint/a11y/noAutofocus: inline edit opens from a keyboard action, so focus has to follow it */
"use client";

import { MoreVertical, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AreaSwatch } from "@/components/AreaSwatch";
import { ColorPicker } from "@/components/ColorPicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

interface AreaColumnHeaderProps {
  area: Area;
  habitCount: number;
  onUpdateArea: (areaId: string, updates: Partial<Area>) => void;
  onDeleteArea: (areaId: string) => void;
  onCreateHabit?: () => void;
}

export function AreaColumnHeader({
  area,
  habitCount,
  onUpdateArea,
  onDeleteArea,
  onCreateHabit,
}: AreaColumnHeaderProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(area.name);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleSaveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== area.name) {
      onUpdateArea(area.id, { name: trimmed });
    }
    setIsEditingName(false);
  };

  const handleStartEditing = () => {
    setEditName(area.name);
    setIsEditingName(true);
  };

  const handleEmojiSelect = (selectedEmoji: string) => {
    onUpdateArea(area.id, { emoji: selectedEmoji });
    setEmojiPickerOpen(false);
  };

  const handleColorChange = (newColor: string) => {
    onUpdateArea(area.id, { color: newColor });
  };

  // Enter to save, Escape to cancel
  useHotkeys(
    "enter",
    () => handleSaveName(),
    { enableOnFormTags: true, enabled: isEditingName },
    [editName],
  );

  useHotkeys(
    "escape",
    () => {
      setEditName(area.name);
      setIsEditingName(false);
    },
    { enableOnFormTags: true, enabled: isEditingName },
    [area.name],
  );

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Emoji Picker */}
          <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-xl flex-shrink-0 hover:bg-stone-100 dark:hover:bg-stone-800 rounded w-8 h-8 flex items-center justify-center transition-colors"
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

          {/* Area Name — double-click to edit */}
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => e.stopPropagation()}
              autoFocus
              className="flex-1 min-w-0 px-2 py-1 text-sm font-mono font-semibold bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-600 rounded focus:outline-none focus:border-stone-400 dark:focus:border-stone-500"
            />
          ) : (
            <h3
              className="text-sm font-mono font-medium text-stone-700 dark:text-stone-300 truncate cursor-text"
              onDoubleClick={handleStartEditing}
            >
              {area.name}
            </h3>
          )}

          {/* Habit count */}
          <span className="text-xs font-mono text-stone-400 dark:text-stone-500 flex-shrink-0">
            {habitCount}
          </span>
        </div>

        {/* Add Habit */}
        {onCreateHabit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCreateHabit();
            }}
            className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded transition-colors flex-shrink-0"
            aria-label="Add habit"
          >
            <Plus className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        )}

        {/* Burger Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded transition-colors flex-shrink-0"
              aria-label="Area settings"
            >
              <MoreVertical className="w-4 h-4 text-stone-500 dark:text-stone-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/* Color Picker (inline) */}
            <div className="px-2 py-2">
              <p className="text-xs font-mono text-stone-500 dark:text-stone-400 mb-2">
                Color
              </p>
              <ColorPicker value={area.color} onChange={handleColorChange} />
            </div>

            <DropdownMenuSeparator />

            {/* Archive */}
            <DropdownMenuItem
              onSelect={() => onDeleteArea(area.id)}
              className="text-red-600 dark:text-red-400"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete area
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
