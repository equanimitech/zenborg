"use client";

import { use$ } from "@legendapp/state/react";
import { useEffect, useRef, useState } from "react";
import { DayNoteService } from "@/application/services/DayNoteService";
import { dayNotes$ } from "@/infrastructure/state/store";
import {
  closeDayNoteEdit,
  dayNoteEditState$,
  openDayNoteEdit,
} from "@/infrastructure/state/ui-store";
import { momentConstraints } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface DayHeaderTitleProps {
  day: string;
  fallbackLabel: string;
  isActiveDay: boolean;
}

const dayNoteService = new DayNoteService();

function countWords(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function DayHeaderTitle({
  day,
  fallbackLabel,
  isActiveDay,
}: DayHeaderTitleProps) {
  const note = use$(dayNotes$[day]);
  const editState = use$(dayNoteEditState$);
  const isEditing = editState.editingDay === day;
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const headingClasses = cn(
    "font-mono font-bold text-2xl md:text-3xl bg-transparent outline-none",
    isActiveDay
      ? "text-stone-900 dark:text-stone-100"
      : "text-stone-700 dark:text-stone-300",
  );

  const startEdit = () => {
    setError(null);
    openDayNoteEdit(day, note?.title ?? "");
  };

  const commit = () => {
    const draft = dayNoteEditState$.draft.peek();
    const trimmed = draft.trim();

    if (trimmed.length === 0) {
      // Empty = clear the note (only if one exists)
      if (note) {
        dayNoteService.clearTitle(day);
      }
      closeDayNoteEdit();
      setError(null);
      return;
    }

    const result = dayNoteService.setTitle(day, trimmed);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    closeDayNoteEdit();
    setError(null);
  };

  const cancel = () => {
    closeDayNoteEdit();
    setError(null);
  };

  if (isEditing) {
    return (
      <div className="flex flex-col">
        <input
          ref={inputRef}
          type="text"
          value={editState.draft}
          onChange={(e) => dayNoteEditState$.draft.set(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder={fallbackLabel}
          className={cn(
            headingClasses,
            "min-w-0 w-full max-w-xs border-b border-stone-300 dark:border-stone-600",
          )}
          aria-label={`Title for ${fallbackLabel}`}
        />
        {error && <span className="text-xs text-red-500 mt-0.5">{error}</span>}
      </div>
    );
  }

  const displayed = note?.title ?? fallbackLabel;
  const tooManyWords = note
    ? countWords(note.title) > momentConstraints.maxWordsInName
    : false;

  return (
    <button
      type="button"
      onClick={startEdit}
      className={cn(
        headingClasses,
        "text-left cursor-text hover:text-stone-950 dark:hover:text-stone-50 transition-colors",
        tooManyWords && "underline decoration-red-400",
      )}
      aria-label={`Edit title for ${fallbackLabel}`}
    >
      {displayed}
    </button>
  );
}
