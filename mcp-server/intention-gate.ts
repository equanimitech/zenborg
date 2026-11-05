/**
 * The browser's intention gate, through the writer.
 *
 * The extension is a reader of the vault. When its gate starts a planted
 * moment, or the gardener answers the reflection at the end, the native host
 * runs one of these as `zenborg-mcp <command> … --vault <dir>` — the same
 * one-shot CLI shape as `refresh-spend` — so the MCP stays the one writer.
 *
 *   zenborg-mcp switch-moment <momentId> <minutes>
 *   zenborg-mcp reflect <momentId> <text> [--intention <words>]
 *
 * Each prints one JSON line and exits non-zero on refusal.
 */
import {
  staleReason,
  wakingDayKey,
} from "../src/domain/attention/ActiveMoment.ts";
import {
  type ActiveMomentPointer,
  type DayNote,
  readCollection,
  writeActiveMoment,
  writeCollection,
} from "./vault.js";

/** The gate's longest offer; anything longer is not a short deliberate moment. */
export const MAX_SWITCH_MIN = 240;
const MAX_TEXT = 500;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Timed switch to a moment on today's board. */
export function switchMoment(
  root: string,
  momentId: string,
  minutes: number,
  now: Date = new Date(),
): Result<ActiveMomentPointer> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SWITCH_MIN) {
    return { ok: false, error: `minutes must be 1–${MAX_SWITCH_MIN}` };
  }
  const moment = readCollection(root, "moments")[momentId];
  const reason = staleReason(moment, wakingDayKey(now));
  if (reason) return { ok: false, error: reason };
  return {
    ok: true,
    value: writeActiveMoment(root, momentId, now.toISOString(), minutes),
  };
}

/** One markdown line: the moment, the intention named at the gate, what it gave. */
export function reflectionLine(
  name: string,
  intention: string,
  text: string,
): string {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const said = clean(intention);
  const named = said && said !== clean(name) ? ` · ${said}` : "";
  return `- ${clean(name)}${named} — ${clean(text)}`;
}

/**
 * Append `line` to the day's note body. A body needs a titled day to render,
 * so a day without a note gets one titled with its weekday — what the app
 * shows for an untitled day anyway. Pure.
 */
export function withReflection(
  notes: Record<string, DayNote>,
  date: string,
  line: string,
  nowIso: string,
): Record<string, DayNote> {
  const note = notes[date];
  if (note) {
    const body = note.body?.trim() ? `${note.body.trimEnd()}\n${line}` : line;
    return { ...notes, [date]: { ...note, body, updatedAt: nowIso } };
  }
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
  });
  return {
    ...notes,
    [date]: {
      date,
      title: weekday,
      body: line,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

/** Store the reflection on today's day note. */
export function reflect(
  root: string,
  momentId: string,
  text: string,
  intention: string,
  now: Date = new Date(),
): Result<{ date: string; line: string }> {
  if (!text.trim()) return { ok: false, error: "empty reflection" };
  if (text.length > MAX_TEXT || intention.length > MAX_TEXT) {
    return { ok: false, error: "too long" };
  }
  const moment = readCollection(root, "moments")[momentId];
  if (!moment) return { ok: false, error: "moment no longer exists" };
  const date = wakingDayKey(now);
  const line = reflectionLine(moment.name, intention, text);
  writeCollection(
    root,
    "dayNotes",
    withReflection(readCollection(root, "dayNotes"), date, line, now.toISOString()),
  );
  return { ok: true, value: { date, line } };
}

/** `argv` after the binary: run a gate command if it is one, else `null`. */
export function runGateCommand(
  root: string,
  argv: readonly string[],
): Result<unknown> | null {
  const [command, ...rest] = argv;
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? (rest[i + 1] ?? "") : "";
  };
  if (command === "switch-moment") {
    return switchMoment(root, rest[0] ?? "", Number(rest[1]));
  }
  if (command === "reflect") {
    return reflect(root, rest[0] ?? "", rest[1] ?? "", flag("--intention"));
  }
  return null;
}
