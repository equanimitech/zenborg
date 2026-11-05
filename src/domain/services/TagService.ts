/**
 * TagService - Domain service for tag validation and normalization
 *
 * Centralizes tag logic used by both Moment and Habit entities.
 * Follows DDD pattern: shared behavior in domain services.
 */

/** Unicode-aware inline tag pattern (global). Shared by all tag parsers. */
export const TAG_REGEX = /#([\p{L}\p{N}-]+)/gu;

/**
 * Normalizes a tag to the correct format
 * Converts to lowercase, replaces spaces with hyphens
 *
 * @param tag - Tag to normalize
 * @returns Normalized tag or null if invalid
 */

export function normalizeTag(tag: string): string | null {
  if (!tag || typeof tag !== "string") return null;

  const normalized = tag
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/[^\p{L}\p{N}-]/gu, "") // Remove invalid characters
    .substring(0, 20); // Limit to 20 characters

  return validateTag(normalized) ? normalized : null;
}

/**
 * Validates a tag format
 * Rules: lowercase, no spaces, Unicode letters/digits + hyphen, 1-20 characters
 *
 * @param tag - Tag to validate
 * @returns True if valid
 */
export function validateTag(tag: string): boolean {
  if (!tag || typeof tag !== "string") return false;
  return /^[\p{L}\p{N}-]{1,20}$/u.test(tag);
}

/**
 * Normalizes multiple tags and filters out invalid ones
 *
 * @param tags - Array of tags to normalize
 * @returns Array of valid normalized tags (deduplicated)
 */
export function normalizeTags(tags: string[]): string[] {
  const normalized = tags
    .map(normalizeTag)
    .filter((t): t is string => t !== null);

  return Array.from(new Set(normalized)); // Deduplicate
}

/**
 * Extracts tags from arbitrary text
 * Finds all #tag patterns, normalizes and deduplicates them
 *
 * @param text - Input text to extract tags from
 * @returns Array of valid normalized tags
 */
export function extractTagsFromText(text: string): string[] {
  if (!text || typeof text !== "string") return [];

  const tagSet = new Set<string>();

  // Use matchAll to avoid regex state issues with global flag
  const matches = text.matchAll(TAG_REGEX);
  for (const match of matches) {
    const normalized = normalizeTag(match[0]);
    if (normalized) {
      tagSet.add(normalized);
    }
  }

  return Array.from(tagSet);
}
