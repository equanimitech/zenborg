/**
 * Season intentions: a few words per area and per person, living on the cycle
 * row (the `placeIds` precedent) and expiring with it. Pure functions; the
 * tools in index.ts do the reading and writing.
 */

export const MAX_INTENTION_WORDS = 12;

export type IntentionMap = Record<string, string>;

const wordCount = (text: string): number =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

/**
 * Validate and normalise one map. Unknown ids and out-of-range word counts
 * are rejected with the offending id named. `allowEmpty` is the roster case:
 * a person with "" is on this season's roster without a sentence.
 */
export function checkIntentions(
  kind: "area" | "person",
  input: IntentionMap,
  known: ReadonlySet<string>,
  allowEmpty: boolean,
): { ok: true; value: IntentionMap } | { ok: false; error: string } {
  const value: IntentionMap = {};
  for (const [id, raw] of Object.entries(input)) {
    if (!known.has(id)) {
      return { ok: false, error: `Unknown ${kind} id: ${id}` };
    }
    const text = raw.trim();
    const n = wordCount(text);
    if (n > MAX_INTENTION_WORDS || (n === 0 && !allowEmpty)) {
      return {
        ok: false,
        error: `${kind} ${id}: intention must be ${allowEmpty ? 0 : 1} to ${MAX_INTENTION_WORDS} words, got ${n}`,
      };
    }
    value[id] = text;
  }
  return { ok: true, value };
}

/**
 * Re-key a people map by person key. A record UUID is mapped to its key; a
 * value matching nothing is left as given so validation can name it.
 */
export function keyPeople(
  input: IntentionMap,
  people: Record<string, { id: string; key: string }>,
): IntentionMap {
  const all = Object.values(people);
  const out: IntentionMap = {};
  for (const [ref, text] of Object.entries(input)) {
    const hit = all.find((p) => p.key === ref) ?? all.find((p) => p.id === ref);
    out[hit ? hit.key : ref] = text;
  }
  return out;
}

/** Attach display names. A deleted entity keeps its id and gets a null name. */
export function resolveIntentions(
  map: IntentionMap | undefined,
  names: Record<string, { name: string } | undefined>,
): Array<{ id: string; name: string | null; text: string }> {
  return Object.entries(map ?? {}).map(([id, text]) => ({
    id,
    name: names[id]?.name ?? null,
    text,
  }));
}
