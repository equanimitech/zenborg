/** biome-ignore-all lint/a11y/noAutofocus: inline edit opens from a keyboard action, so focus has to follow it */
"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { AreaSwatch } from "@/components/AreaSwatch";
import { columnWidth } from "@/lib/design-tokens";
import {
  extractLeadingEmoji,
  suggestEmojiForAreaName,
} from "@/lib/emoji-utils";
import { cn } from "@/lib/utils";

const RANDOM_COLORS = [
  "#10b981",
  "#3b82f6",
  "#f97316",
  "#eab308",
  "#6b7280",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#06b6d4",
  "#059669",
  "#f59e0b",
  "#6366f1",
];

function pickRandomColor(): string {
  return RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
}

interface EmptyAreaColumnProps {
  onCreateArea: (name: string, emoji: string, color: string) => void;
  label?: string;
}

export function EmptyAreaColumn({
  onCreateArea,
  label = "New area",
}: EmptyAreaColumnProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState(pickRandomColor);

  const handleCancel = () => {
    setIsCreating(false);
    setName("");
    setEmoji("");
    setColor(pickRandomColor());
  };

  const handleSave = () => {
    if (!name.trim()) {
      handleCancel();
      return;
    }
    onCreateArea(name.trim(), emoji, color);
    handleCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);

    const { emoji: leadingEmoji, remainingText } = extractLeadingEmoji(value);
    if (leadingEmoji && remainingText.length > 0) {
      setEmoji(leadingEmoji);
      setName(remainingText);
      return;
    }

    if (!leadingEmoji && value.trim().length >= 2) {
      const suggested = suggestEmojiForAreaName(value);
      if (suggested) {
        setEmoji(suggested);
      }
    }
  };

  if (isCreating) {
    return (
      <div
        className={cn(
          "flex flex-col snap-start rounded-lg overflow-hidden",
          columnWidth.scrollableClassName,
        )}
      >
        {/* Header — matches AreaColumnHeader layout */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl flex-shrink-0 w-8 h-8 flex items-center justify-center">
              {emoji || <AreaSwatch color={color} />}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
              placeholder="Area name..."
              className="flex-1 min-w-0 bg-transparent text-sm font-mono font-medium text-stone-700 dark:text-stone-300 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Colored Divider */}
        <div className="h-[3px] mx-4" style={{ backgroundColor: color }} />
      </div>
    );
  }

  // Default: clickable empty column
  return (
    <button
      type="button"
      onClick={() => setIsCreating(true)}
      className={cn(
        "group flex flex-col snap-start rounded-lg overflow-hidden text-left",
        "transition-colors duration-200 cursor-pointer",
        columnWidth.scrollableClassName,
      )}
    >
      {/* Header — matches AreaColumnHeader layout */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="text-xl flex-shrink-0 w-8 h-8 flex items-center justify-center rounded group-hover:bg-stone-100 dark:group-hover:bg-stone-800 transition-colors">
            <Plus className="w-5 h-5 text-stone-400 dark:text-stone-500 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors" />
          </div>
          <h3 className="text-sm font-mono font-medium text-stone-400 dark:text-stone-500 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors truncate">
            {label}
          </h3>
        </div>
      </div>

      {/* Divider placeholder */}
      <div className="h-[3px] mx-4 mb-2 bg-stone-200/60 dark:bg-stone-700/40 group-hover:bg-stone-300 dark:group-hover:bg-stone-600 transition-colors" />

      {/* Content */}
      <div className="flex-1 p-4 min-h-[200px]" />
    </button>
  );
}
