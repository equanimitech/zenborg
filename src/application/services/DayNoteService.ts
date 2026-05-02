import {
  createDayNote,
  type DayNote,
  type DayNoteResult,
  updateDayNote,
} from "@/domain/entities/DayNote";
import { dayNotes$ } from "@/infrastructure/state/store";

/**
 * Application Service for Day Notes
 *
 * Per-day metadata keyed by ISO date (YYYY-MM-DD). The note collection is
 * sparse — most days have no entry. Setting a title creates the note;
 * clearing it removes the entry entirely.
 */
export class DayNoteService {
  /**
   * Set the title for a day. Creates the note if absent, updates if present.
   */
  setTitle(date: string, title: string): DayNoteResult {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return { error: "Day title cannot be empty" };
    }

    const existing = dayNotes$[date].get();

    const result = existing
      ? updateDayNote(existing, { title: trimmed })
      : createDayNote({ date, title: trimmed });

    if ("error" in result) {
      return result;
    }

    dayNotes$[date].set(result);
    return result;
  }

  /**
   * Remove the day's note entirely.
   */
  clearTitle(date: string): void {
    dayNotes$[date].delete();
  }

  /**
   * Read a day's note (null if absent).
   */
  getNote(date: string): DayNote | null {
    return dayNotes$[date].get() || null;
  }

  /**
   * Read a day's title (null if absent).
   */
  getTitle(date: string): string | null {
    return dayNotes$[date].title.get() || null;
  }
}
