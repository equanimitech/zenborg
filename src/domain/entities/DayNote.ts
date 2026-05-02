/**
 * DayNote - per-day metadata keyed by ISO date.
 *
 * Today the only field is `title` (a 1-3 word label shown in the Timeline
 * day header). The entity exists rather than a flat `Record<string, string>`
 * so future fields (intention, mood, recap) can be added without renaming
 * the collection or migrating shape.
 *
 * Primary key is `date` (YYYY-MM-DD) — there is at most one note per day.
 */

import { momentConstraints } from "@/lib/design-tokens";

export interface DayNote {
  date: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDayNoteProps {
  date: string;
  title: string;
}

export interface UpdateDayNoteProps {
  title: string;
}

export type DayNoteResult = DayNote | { error: string };

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a day-note title.
 * Same 1-3 word rule as moments and habits — declared inline so the entity
 * is self-contained and doesn't reach into the design-tokens helper, which
 * is moment-specific by name.
 */
export function validateDayNoteTitle(title: string): {
  isValid: boolean;
  error?: string;
} {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: "Day title cannot be empty" };
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length > momentConstraints.maxWordsInName) {
    return {
      isValid: false,
      error: `Maximum ${momentConstraints.maxWordsInName} words allowed`,
    };
  }
  return { isValid: true };
}

export function createDayNote(props: CreateDayNoteProps): DayNoteResult {
  if (!ISO_DATE_REGEX.test(props.date)) {
    return { error: `Invalid ISO date: ${props.date}` };
  }
  const validation = validateDayNoteTitle(props.title);
  if (!validation.isValid) {
    return { error: validation.error ?? "Invalid title" };
  }
  const now = new Date().toISOString();
  return {
    date: props.date,
    title: props.title.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

export function updateDayNote(
  existing: DayNote,
  updates: UpdateDayNoteProps,
): DayNoteResult {
  const validation = validateDayNoteTitle(updates.title);
  if (!validation.isValid) {
    return { error: validation.error ?? "Invalid title" };
  }
  return {
    ...existing,
    title: updates.title.trim(),
    updatedAt: new Date().toISOString(),
  };
}
