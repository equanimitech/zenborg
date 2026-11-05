import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CrossingRecord,
  CrossingTallyPort,
  FenceStorePort,
} from "../src/application/ports.ts";
import {
  isOpeningLive,
  isOpeningRecord,
  isRuleRecord,
  PASS_ALLOWANCE_ID,
  type OpeningRecord,
  type PassAllowanceRecord,
} from "../src/domain/intervention/Opening.ts";
import type { RuleSpec } from "../src/domain/intervention/RuleSpec.ts";

/**
 * Vault I/O for the `fences` collection and the plugin's crossing tally.
 *
 * `fences` is a kernel root collection (`{vaultRoot}/fences.json`, records
 * keyed by id) whose writer is zenborg — this server is that writer. It is
 * deliberately NOT in `vault.ts`'s `COLLECTION_NAMES`: that registry mirrors
 * the collections whose record shapes the desktop app owns, while a fence's
 * record shape is the domain's `RuleSpec`, imported here directly so there is
 * no second copy to drift. (The plugin hook, `plugin/hooks/fences.mts`, made
 * the same call for the same reason.) Keeping it out of the registry also
 * keeps it out of export/import, which has never carried it.
 *
 * Reads by this writer THROW on malformed JSON rather than failing soft the
 * way the hook does. The hook is a reader: garbled state must never trap the
 * person mid-session. This file is the writer: failing soft to `{}` and then
 * writing would silently destroy every standing fence, which is worse than an
 * error message.
 */

export const FENCES_FILE = "fences.json";
/** Plugin-owned runtime state — this server only ever reads it. */
export const FENCES_STATE_FILE = path.join("plugin", "fences-state.json");

export function fencesPath(root: string): string {
  return path.join(root, FENCES_FILE);
}

export function fencesStatePath(root: string): string {
  return path.join(root, FENCES_STATE_FILE);
}

/** Every record in `fences.json`, rules and not, exactly as stored. */
export function readFenceRecords(root: string): Record<string, unknown> {
  const file = fencesPath(root);
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Malformed JSON in ${FENCES_FILE} at ${file}: ${(error as Error).message}`,
    );
  }
}

/**
 * The rules. `fences.json` also carries planned openings and the pass
 * allowance, which are not `RuleSpec`s: every rule reader goes through here so
 * none of them meets one, and `writeFencesFile` carries them back untouched.
 */
export function readFencesFile(root: string): Record<string, RuleSpec> {
  const rules: Record<string, RuleSpec> = {};
  for (const [id, value] of Object.entries(readFenceRecords(root))) {
    if (isRuleRecord(value)) rules[id] = value as RuleSpec;
  }
  return rules;
}

/** Atomic write: temp file in the same directory, then rename — same
 * semantics as `writeCollection`, so watchers see one event and readers
 * never catch a half-written collection. */
export function writeFencesFile(
  root: string,
  all: Record<string, RuleSpec>,
): void {
  // Rules are replaced whole; everything else in the file (openings, the
  // allowance, a newer build's records) is preserved.
  const kept: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(readFenceRecords(root))) {
    if (!isRuleRecord(value)) kept[id] = value;
  }
  writeRecords(root, { ...kept, ...all });
}

function writeRecords(root: string, all: Record<string, unknown>): void {
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const file = fencesPath(root);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/** Planned openings that are active or still to come at `now`. */
export function readOpenings(root: string, now: Date): OpeningRecord[] {
  return Object.values(readFenceRecords(root))
    .filter(isOpeningRecord)
    .filter((o) => isOpeningLive(o, now))
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** Write one opening; openings already over are dropped on the way. */
export function writeOpening(
  root: string,
  record: OpeningRecord,
  now: Date,
): void {
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(readFenceRecords(root))) {
    if (isOpeningRecord(value) && !isOpeningLive(value, now)) continue;
    next[id] = value;
  }
  next[record.id] = record;
  writeRecords(root, next);
}

/** Remove one opening by id; null when there is no such opening. */
export function removeOpening(root: string, id: string): OpeningRecord | null {
  const all = readFenceRecords(root);
  const found = all[id];
  if (!isOpeningRecord(found)) return null;
  const { [id]: _, ...rest } = all;
  writeRecords(root, rest);
  return found;
}

export function readPassAllowance(root: string): PassAllowanceRecord | null {
  const found = readFenceRecords(root)[PASS_ALLOWANCE_ID] as
    | PassAllowanceRecord
    | undefined;
  return found?.kind === "pass-allowance" ? found : null;
}

export function writePassAllowance(
  root: string,
  record: PassAllowanceRecord,
): void {
  writeRecords(root, { ...readFenceRecords(root), [record.id]: record });
}

/**
 * The crossing tally, fail-soft: this is a read of someone else's runtime
 * state, and a garbled tally means "no crossings recorded", never an error.
 * Entries that don't carry a numeric `crossings` are dropped rather than
 * coerced into lies.
 */
export function readCrossingTally(
  root: string,
): Record<string, CrossingRecord> {
  try {
    const raw = JSON.parse(
      fs.readFileSync(fencesStatePath(root), "utf8"),
    ) as Record<string, { crossings?: unknown; at?: unknown }>;
    const tally: Record<string, CrossingRecord> = {};
    for (const [id, entry] of Object.entries(raw ?? {})) {
      const crossings = Number(entry?.crossings);
      if (!Number.isFinite(crossings) || crossings < 0) continue;
      const at = Number(entry?.at);
      tally[id] = { crossings, at: Number.isFinite(at) ? at : 0 };
    }
    return tally;
  } catch {
    return {};
  }
}

export function fenceStore(root: string): FenceStorePort {
  return {
    read: async () => readFencesFile(root),
    write: async (all) => writeFencesFile(root, all),
  };
}

export function crossingTally(root: string): CrossingTallyPort {
  return {
    read: async () => readCrossingTally(root),
  };
}

/** `~` is a machine fact the principal speaks in; the rule stores what the
 * enforcing hook can match, which is an absolute path. Expanding it here —
 * in the adapter — keeps the application layer ignorant of whose machine
 * this is. */
export function expandHome(p: string): string {
  return p.replace(/^~(?=\/|$)/, os.homedir());
}
