/**
 * The phase pane's pure logic: what a (day, phase) holds, what each hotkey
 * does, and Haiku's reply read strictly into ops. No I/O, so it runs under
 * `node --test` and inside the Claude Code mod alike.
 */
import type { BoardOp, BoardProposal, BoardView } from "../types";
import { labelOf, type Moment, type Vault } from "./garden.ts";

export const PHASES = ["MORNING", "AFTERNOON", "EVENING", "NIGHT"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const dateOf = (day: string) => {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const keyOf = (t: Date) =>
  `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;

export const addDays = (day: string, n: number) => {
  const t = dateOf(day);
  t.setDate(t.getDate() + n);
  return keyOf(t);
};

/** The (day, phase) `delta` phases away; past NIGHT is the next day's MORNING. */
export const stepView = (view: BoardView, delta: number): BoardView => {
  const i = PHASES.indexOf(view.phase as (typeof PHASES)[number]) + delta;
  const n = PHASES.length;
  return { day: addDays(view.day, Math.floor(i / n)), phase: PHASES[((i % n) + n) % n] ?? "MORNING" };
};

export const phaseLabel = (v: Vault, phase: string) =>
  Object.values(v.phases).find((p) => p.phase === phase)?.label ?? phase.charAt(0) + phase.slice(1).toLowerCase();

/** "Thu morning". */
export const whereLabel = (v: Vault, day: string, phase: string) =>
  `${WEEKDAYS[dateOf(day).getDay()]} ${phaseLabel(v, phase).toLowerCase()}`;

/** "Tue 27 Oct". */
export const dayLabel = (day: string) => {
  const t = dateOf(day);
  return `${WEEKDAYS[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]}`;
};

export interface Row {
  id: string;
  label: string;
  area: string;
}

const byOrder = (a: Moment, b: Moment) => (a.order ?? 0) - (b.order ?? 0);

/** The shown (day, phase)'s moments, then the drawing board's, in board order. */
export function boardOf(v: Vault, view: BoardView): { rows: Row[]; drawing: Row[] } {
  const label = labelOf(v.areas);
  const row = (m: Moment): Row => ({ id: m.id, label: label(m), area: (m.areaId && v.areas[m.areaId]?.name) || "" });
  const all = Object.values(v.moments);
  return {
    rows: all.filter((m) => m.day === view.day && m.phase === view.phase).sort(byOrder).map(row),
    drawing: all.filter((m) => !m.day).sort(byOrder).map(row),
  };
}

export interface Action {
  key: string;
  hotkey: string;
  label: string;
  op: BoardOp;
}

/** The focused row's hotkeys. A planted moment steps a phase, goes to tomorrow, back to the board, or becomes active (today only); a board moment is planted into the shown phase. */
export function actionsFor(v: Vault, m: Moment, view: BoardView, today: string): Action[] {
  if (!m.day || !m.phase) {
    return [{ key: "here", hotkey: "i", label: `into ${phaseLabel(v, view.phase).toLowerCase()}`, op: { op: "move", id: m.id, ...view } }];
  }
  const at = { day: m.day, phase: m.phase };
  const prev = stepView(at, -1);
  const next = stepView(at, 1);
  const acts: Action[] = [
    { key: "prev", hotkey: "p", label: `◂ ${phaseLabel(v, prev.phase).toLowerCase()}`, op: { op: "move", id: m.id, ...prev } },
    { key: "next", hotkey: "n", label: `${phaseLabel(v, next.phase).toLowerCase()} ▸`, op: { op: "move", id: m.id, ...next } },
    { key: "tomorrow", hotkey: "t", label: "tomorrow", op: { op: "move", id: m.id, day: addDays(m.day, 1), phase: m.phase } },
    { key: "board", hotkey: "b", label: "board", op: { op: "unallocate", id: m.id } },
  ];
  return m.day === today ? [...acts, { key: "active", hotkey: "a", label: "active", op: { op: "active", id: m.id } }] : acts;
}

/** The MCP tool and input an op writes through. A plan-linked moment leaves the day by unallocate_moment (its deck card reappears); a spontaneous one by `day: null`. */
export function opCall(v: Vault, op: BoardOp): { name: string; input: Record<string, unknown> } {
  switch (op.op) {
    case "move":
      return { name: "update_moment", input: { id: op.id, day: op.day, phase: op.phase } };
    case "unallocate":
      return v.moments[op.id]?.cyclePlanId
        ? { name: "unallocate_moment", input: { id: op.id } }
        : { name: "update_moment", input: { id: op.id, day: null } };
    case "active":
      return { name: "set_active_moment", input: { momentIdOrName: op.id } };
    case "delete":
      return { name: "delete_moment", input: { id: op.id } };
    case "add": {
      const { op: _, ...input } = op;
      return { name: "add_moment", input };
    }
  }
}

/** The op as a human line: "♟️ strategy → Thu morning". */
export function describe(v: Vault, op: BoardOp): string {
  const label = labelOf(v.areas);
  const name = (id: string) => {
    const m = v.moments[id];
    return m ? label(m) : id;
  };
  switch (op.op) {
    case "move":
      return `${name(op.id)} → ${whereLabel(v, op.day, op.phase)}`;
    case "unallocate":
      return `${name(op.id)} → board`;
    case "active":
      return `≋ ${name(op.id)} as active`;
    case "delete":
      return `✕ delete ${name(op.id)}`;
    case "add": {
      const h = op.habitId ? v.habits[op.habitId] : undefined;
      const what = h ? label(h) : (op.name ?? "");
      return `+ ${what} → ${op.day && op.phase ? whereLabel(v, op.day, op.phase) : "board"}`;
    }
  }
}

const isPhase = (x: unknown): x is string => typeof x === "string" && (PHASES as readonly string[]).includes(x);
const isDay = (x: unknown): x is string => typeof x === "string" && DAY.test(x);
const isWords = (x: unknown): x is string => typeof x === "string" && /^\S+(\s+\S+){0,2}$/.test(x.trim());

/** One item of Haiku's list as an op, or why it was dropped. Only whitelisted fields survive. */
function validate(v: Vault, x: unknown, mayDelete: boolean): BoardOp | string {
  if (typeof x !== "object" || x === null) return "not an op";
  const o = x as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const known = id in v.moments;
  const unknownId = `unknown moment "${id}"`;
  switch (o.op) {
    case "move":
      if (!known) return unknownId;
      return isDay(o.day) && isPhase(o.phase) ? { op: "move", id, day: o.day, phase: o.phase } : `bad day or phase for "${id}"`;
    case "unallocate":
    case "active":
      return known ? { op: o.op, id } : unknownId;
    case "delete":
      if (!known) return unknownId;
      return mayDelete ? { op: "delete", id } : `delete of "${v.moments[id]?.name}" not asked for`;
    case "add": {
      const when = o.day === undefined && o.phase === undefined ? {} : isDay(o.day) && isPhase(o.phase) ? { day: o.day, phase: o.phase } : null;
      if (when === null) return "add needs both day and phase, or neither";
      if (typeof o.habitId === "string") {
        const h = v.habits[o.habitId];
        return h && !h.isArchived ? { op: "add", habitId: o.habitId, ...when } : `unknown habit "${o.habitId}"`;
      }
      if (!isWords(o.name)) return "add needs a habitId or a 1-3 word name";
      if (typeof o.areaId !== "string" || !(o.areaId in v.areas)) return `unknown area "${String(o.areaId)}"`;
      return { op: "add", name: o.name.trim(), areaId: o.areaId, ...when };
    }
    default:
      return `unknown op "${String(o.op)}"`;
  }
}

/** Haiku's reply read strictly: the first JSON list in it, each item validated against the vault. Delete passes only when the instruction says delete or remove. */
export function parseProposal(v: Vault, reply: string, instruction: string): BoardProposal {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  let items: unknown;
  try {
    items = start >= 0 && end > start ? JSON.parse(reply.slice(start, end + 1)) : undefined;
  } catch {
    items = undefined;
  }
  if (!Array.isArray(items)) return { ops: [], lines: [], dropped: ["no list of changes in the reply"] };
  const mayDelete = /\b(delete|remove)\b/i.test(instruction);
  const ops: BoardOp[] = [];
  const dropped: string[] = [];
  for (const item of items) {
    const r = validate(v, item, mayDelete);
    if (typeof r === "string") dropped.push(r);
    else ops.push(r);
  }
  return { ops, lines: ops.map((op) => describe(v, op)), dropped };
}

export const SYSTEM = `You turn a gardener's instruction into changes to their Zenborg board. Reply with only a JSON array, no prose. Each item is one of:
{"op":"move","id":"<moment id>","day":"YYYY-MM-DD","phase":"MORNING|AFTERNOON|EVENING|NIGHT"}  (plant or move a moment to a day and phase)
{"op":"unallocate","id":"<moment id>"}  (back to the drawing board)
{"op":"add","habitId":"<habit id>","day":"YYYY-MM-DD","phase":"..."}  (plant a habit; omit day and phase for the drawing board)
{"op":"add","name":"<1-3 words>","areaId":"<area id>","day":"YYYY-MM-DD","phase":"..."}  (a moment with no habit)
{"op":"active","id":"<moment id>"}  (make it the current intention)
{"op":"delete","id":"<moment id>"}  (only when the instruction explicitly says delete or remove)
Use only ids from the garden JSON. Prefer a habit over a new name. "Tonight" is EVENING or NIGHT of today; days are the gardener's waking days. If nothing fits, reply [].`;

/** The garden Haiku reads: today, the shown (day, phase), moments around them and the board, habits and areas for adds. */
export function gardenPrompt(v: Vault, view: BoardView, today: string, instruction: string): string {
  const days = new Set([today, addDays(today, 1), view.day, addDays(view.day, 1)]);
  const moments = Object.values(v.moments)
    .filter((m) => !m.day || days.has(m.day))
    .map((m) => ({ id: m.id, name: m.name, day: m.day ?? null, phase: m.day ? (m.phase ?? null) : null }));
  const habits = Object.values(v.habits)
    .filter((h) => !h.isArchived)
    .map((h) => ({ id: h.id, name: h.name, areaId: h.areaId ?? null }));
  const areas = Object.values(v.areas).map((a) => ({ id: a.id, name: a.name }));
  const garden = { today, weekday: WEEKDAYS[dateOf(today).getDay()], shown: view, moments, habits, areas };
  return `Garden:\n${JSON.stringify(garden)}\n\nInstruction: ${instruction}`;
}
