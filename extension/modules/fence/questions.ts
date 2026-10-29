/**
 * The fence's meta-awareness questions, one per host per local day. Pure and
 * deterministic: a string hash of `host|YYYY-MM-DD`, no randomness, no storage,
 * so a reload shows the same question.
 */

import { localDay } from "./ration";

export const ENTRY: readonly string[] = [
  "What value will I gain by going there?",
  "What am I hoping to find?",
  "What would I do if this were closed?",
  "Is this what I meant to tend right now?",
];

export const STAYING: readonly string[] = [
  "worth staying?",
  "still getting value here?",
  "what did I come for?",
  "enough?",
];

export function pickQuestion(pool: readonly string[], host: string, now: number): string {
  let h = 0;
  for (const c of `${host}|${localDay(now)}`) h = (Math.imul(h, 31) + c.codePointAt(0)!) >>> 0;
  return pool[h % pool.length]!;
}
