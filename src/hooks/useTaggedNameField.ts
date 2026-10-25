/**
 * useTaggedNameField - React hook for name + tag extraction
 *
 * Provides reactive state management for text input with inline #tag extraction.
 * Each form gets its own isolated field state.
 *
 * Domain logic delegated to TagService, this manages reactive UI state.
 */

import { observable } from "@legendapp/state";
import { useObservable, useValue } from "@legendapp/state/react";
import { normalizeMention } from "@/domain/services/MentionService";
import {
  extractTagsFromText,
  normalizeTag,
  TAG_REGEX,
} from "@/domain/services/TagService";

export interface TaggedNameField {
  // Reactive state
  displayValue: string;
  name: string;
  tags: string[];
  isAutocompleteOpen: boolean;
  searchValue: string;

  // Mention state
  isMentionOpen: boolean;
  mentionSearch: string;
  mentionIds: string[];

  // Actions
  setDisplayValue: (value: string, cursorPos: number) => void;
  extractTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  selectMention: (key: string) => void;
  removeMention: (key: string) => void;
  extractRemainingTags: () => { name: string; tags: string[] };
  reset: () => void;
  reinitialize: (name: string, tags: string[], mentionIds?: string[]) => void;
}

/**
 * Hook for creating a tagged name field with automatic tag extraction
 *
 * @param initialName - Initial name value (without tags)
 * @param initialTags - Initial tags array
 * @returns TaggedNameField with reactive state and actions
 */
export function useTaggedNameField(
  initialName = "",
  initialTags: string[] = [],
  initialMentionIds: string[] = [],
): TaggedNameField {
  const state$ = useObservable(() =>
    observable({
      name: initialName,
      tags: initialTags,
      mentionIds: initialMentionIds,
      displayValue: initialName,
      autocomplete: {
        isOpen: false,
        searchValue: "",
        cursorPosition: 0,
      },
      mention: {
        isOpen: false,
        searchValue: "",
      },
    }),
  );

  // Reactive values - useValue automatically tracks and re-renders
  const displayValue = useValue(state$.displayValue);
  const name = useValue(state$.name);
  const tags = useValue(state$.tags);
  const isAutocompleteOpen = useValue(state$.autocomplete.isOpen);
  const searchValue = useValue(state$.autocomplete.searchValue);
  const isMentionOpen = useValue(state$.mention.isOpen);
  const mentionSearch = useValue(state$.mention.searchValue);
  const mentionIds = useValue(state$.mentionIds);

  // Helper: Extract current tag being typed (if any)
  const extractCurrentTag = (
    text: string,
    cursorPos: number,
  ): string | null => {
    const beforeCursor = text.slice(0, cursorPos);
    const lastHashIndex = beforeCursor.lastIndexOf("#");

    if (lastHashIndex === -1) return null;

    const afterHash = beforeCursor.slice(lastHashIndex + 1);
    if (afterHash.includes(" ")) return null;

    return afterHash;
  };

  // Helper: Extract current @mention being typed (if any)
  const extractCurrentMention = (
    text: string,
    cursorPos: number,
  ): string | null => {
    const beforeCursor = text.slice(0, cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf("@");

    if (lastAtIndex === -1) return null;

    const afterAt = beforeCursor.slice(lastAtIndex + 1);
    if (afterAt.includes(" ")) return null;

    return afterAt;
  };

  // Helper: Remove @mention from text at cursor position
  const removeMentionFromText = (
    text: string,
    cursorPos: number,
  ): { cleanedText: string; newCursorPos: number } => {
    const beforeCursor = text.slice(0, cursorPos);
    const afterCursor = text.slice(cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf("@");

    if (lastAtIndex === -1) {
      return { cleanedText: text, newCursorPos: cursorPos };
    }

    const beforeMention = beforeCursor.slice(0, lastAtIndex);
    const cleanedText = (beforeMention + afterCursor)
      .replace(/\s+/g, " ")
      .trim();
    const newCursorPos = beforeMention.length;

    return { cleanedText, newCursorPos };
  };

  // Helper: Check if user just completed a tag (space/comma after #tag)
  const checkForCompletedTag = (
    text: string,
    cursorPos: number,
  ): string | null => {
    const beforeCursor = text.slice(0, cursorPos);
    const lastChar = beforeCursor[beforeCursor.length - 1];

    if (lastChar !== " " && lastChar !== ",") return null;

    const tagMatch = beforeCursor.match(
      new RegExp(`${TAG_REGEX.source}\\s*$`, "u"),
    );
    return tagMatch ? tagMatch[1] : null;
  };

  // Helper: Remove #tag from text at cursor position
  const removeTagFromText = (
    text: string,
    cursorPos: number,
  ): { cleanedText: string; newCursorPos: number } => {
    const beforeCursor = text.slice(0, cursorPos);
    const afterCursor = text.slice(cursorPos);
    const lastHashIndex = beforeCursor.lastIndexOf("#");

    if (lastHashIndex === -1) {
      return { cleanedText: text, newCursorPos: cursorPos };
    }

    const beforeTag = beforeCursor.slice(0, lastHashIndex);
    const cleanedText = (beforeTag + afterCursor).replace(/\s+/g, " ").trim();
    const newCursorPos = beforeTag.length;

    return { cleanedText, newCursorPos };
  };

  const actions = {
    setDisplayValue: (value: string, cursorPos: number) => {
      const previousValue = state$.displayValue.peek();
      state$.displayValue.set(value);
      state$.autocomplete.cursorPosition.set(cursorPos);

      // Check if user completed a tag (typed space/comma after #tag)
      if (value.length > previousValue.length) {
        const completedTag = checkForCompletedTag(value, cursorPos);
        if (completedTag) {
          actions.extractTag(completedTag);
          return;
        }
      }

      // Check for active @mention being typed
      const currentMention = extractCurrentMention(value, cursorPos);

      if (currentMention !== null && currentMention.length > 0) {
        state$.mention.searchValue.set(currentMention);
        state$.mention.isOpen.set(true);
        state$.autocomplete.isOpen.set(false);
        state$.autocomplete.searchValue.set("");
        return;
      }

      state$.mention.isOpen.set(false);
      state$.mention.searchValue.set("");

      // Check for active tag being typed (for autocomplete)
      const currentTag = extractCurrentTag(value, cursorPos);

      if (currentTag !== null && currentTag.length > 0) {
        state$.autocomplete.searchValue.set(currentTag);
        state$.autocomplete.isOpen.set(true);
      } else {
        state$.autocomplete.isOpen.set(false);
        state$.autocomplete.searchValue.set("");
      }
    },

    extractTag: (tag: string) => {
      const normalized = normalizeTag(tag);
      const currentTags = state$.tags.peek();

      if (!normalized || currentTags.includes(normalized)) {
        state$.autocomplete.isOpen.set(false);
        return;
      }

      // Add to tags array
      state$.tags.set([...currentTags, normalized]);

      // Remove #tag from display value
      const currentValue = state$.displayValue.peek();
      const cursorPos = state$.autocomplete.cursorPosition.peek();
      const { cleanedText } = removeTagFromText(currentValue, cursorPos);
      state$.displayValue.set(cleanedText);

      // Close autocomplete
      state$.autocomplete.isOpen.set(false);
      state$.autocomplete.searchValue.set("");
    },

    removeTag: (tag: string) => {
      const normalized = normalizeTag(tag);
      if (!normalized) return;

      const currentTags = state$.tags.peek();
      state$.tags.set(currentTags.filter((t) => t !== normalized));
    },

    selectMention: (key: string) => {
      const normalized = normalizeMention(key);
      const currentIds = state$.mentionIds.peek();

      if (!normalized || currentIds.includes(normalized)) {
        state$.mention.isOpen.set(false);
        return;
      }

      state$.mentionIds.set([...currentIds, normalized]);

      // Remove @mention from display value
      const currentValue = state$.displayValue.peek();
      const cursorPos = state$.autocomplete.cursorPosition.peek();
      const { cleanedText } = removeMentionFromText(currentValue, cursorPos);
      state$.displayValue.set(cleanedText);

      state$.mention.isOpen.set(false);
      state$.mention.searchValue.set("");
    },

    removeMention: (key: string) => {
      const currentIds = state$.mentionIds.peek();
      state$.mentionIds.set(currentIds.filter((id) => id !== key));
    },

    extractRemainingTags: () => {
      const currentValue = state$.displayValue.peek();
      const currentTags = state$.tags.peek();

      // Extract any #tags still in the display value
      const extractedTags = extractTagsFromText(currentValue);
      const newTags = extractedTags.filter((t) => !currentTags.includes(t));

      let finalName: string;
      let finalTags: string[];

      if (newTags.length > 0) {
        // Add new tags
        finalTags = [...currentTags, ...newTags];
        state$.tags.set(finalTags);

        // Clean display value
        const cleanedValue = currentValue
          .replace(TAG_REGEX, "")
          .replace(/@[a-z0-9-]*/g, "")
          .replace(/\s+/g, " ")
          .trim();
        state$.displayValue.set(cleanedValue);
        state$.name.set(cleanedValue);
        finalName = cleanedValue;
      } else {
        // Just sync name with display value — also strip stale @mention fragments
        finalName = currentValue
          .replace(/@[a-z0-9-]*/g, "")
          .replace(/\s+/g, " ")
          .trim();
        finalTags = currentTags;
        state$.displayValue.set(finalName);
        state$.name.set(finalName);
      }

      // Close autocomplete
      state$.autocomplete.isOpen.set(false);

      return { name: finalName, tags: finalTags };
    },

    reset: () => {
      state$.name.set("");
      state$.tags.set([]);
      state$.mentionIds.set([]);
      state$.displayValue.set("");
      state$.autocomplete.isOpen.set(false);
      state$.autocomplete.searchValue.set("");
      state$.autocomplete.cursorPosition.set(0);
      state$.mention.isOpen.set(false);
      state$.mention.searchValue.set("");
    },

    reinitialize: (
      newName: string,
      newTags: string[],
      newMentionIds?: string[],
    ) => {
      state$.name.set(newName);
      state$.tags.set(newTags);
      if (newMentionIds !== undefined) {
        state$.mentionIds.set(newMentionIds);
      }
      state$.displayValue.set(newName);
      state$.autocomplete.isOpen.set(false);
      state$.autocomplete.searchValue.set("");
      state$.autocomplete.cursorPosition.set(newName.length);
      state$.mention.isOpen.set(false);
      state$.mention.searchValue.set("");
    },
  };

  return {
    displayValue,
    name,
    tags,
    isAutocompleteOpen,
    searchValue,
    isMentionOpen,
    mentionSearch,
    mentionIds,
    setDisplayValue: actions.setDisplayValue,
    extractTag: actions.extractTag,
    removeTag: actions.removeTag,
    selectMention: actions.selectMention,
    removeMention: actions.removeMention,
    extractRemainingTags: actions.extractRemainingTags,
    reset: actions.reset,
    reinitialize: actions.reinitialize,
  };
}
