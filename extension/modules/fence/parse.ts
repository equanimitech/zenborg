/**
 * The parse boundary for a pushed `Fences` record.
 *
 * ── Why a cache and not a query ─────────────────────────────────────────
 *
 * The app decides what is fenced; the extension decides when it fires. A
 * navigation cannot wait on a native-messaging round trip, and a shield that
 * depends on a live host is a shield that lifts whenever the host is asleep,
 * mid-update, or crashed. So the record is **pushed** and held locally, and
 * actuation reads nothing but local state.
 *
 * `docs/kernel/substrate.md` records why the push exists at all: the browser
 * extension has no filesystem access and never will, so it takes a pusher
 * rather than a loader. Pushing is a read with extra steps, not a second
 * writer — nothing here is authoritative, and nothing here is written back.
 *
 * ── Invariant 6 is enforced at the door ─────────────────────────────────
 *
 * `parseFences` refuses any entry that carries no reachable exit. Sovereignty
 * rests on the exit, not on who was allowed to arm the thing, so a block with
 * no visible way out is a bug rather than a stricter shield — and the cheapest
 * place to hold that line is the boundary the record crosses.
 *
 * Everything in this file is pure: no chrome APIs, no clock, no storage. The
 * chrome.storage mirror and the actuation wiring live elsewhere.
 */

import { normalizeDomain } from "../domains";
import type { DwellGate, GateFriction } from "../friction/gate/decide";
import type {
  Fence,
  FenceEnforcement,
  Fences,
  ParsedFences,
  ProceedAffordance,
  ScheduleWindow,
  Refusal,
} from "./types";

const MAX_ID = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The exit, or null.
 *
 * Null is the invariant-6 refusal and it has three causes, all of them the
 * same failure from the person's side: nothing to read, nothing to press, or
 * an action this surface does not know how to offer.
 */
function readProceed(raw: unknown): ProceedAffordance | null {
  if (!isRecord(raw)) {
    return null;
  }
  const label = text(raw.label);
  if (label === "") {
    return null;
  }
  const action = isRecord(raw.action) ? raw.action : null;
  if (action === null) {
    return null;
  }
  switch (action.type) {
    case "continue":
      return { label, action: { type: "continue" } };
    case "abort":
      return { label, action: { type: "abort" } };
    case "wait":
      return { label, action: { type: "wait" } };
    case "redirect": {
      const to = text(action.to);
      // A redirect with no destination is a `continue` wearing another name.
      return to === "" ? null : { label, action: { type: "redirect", to } };
    }
    case "intention": {
      const prompt = text(action.prompt);
      return prompt === "" ? null : { label, action: { type: "intention", prompt } };
    }
    case "delay": {
      const seconds = Number(action.seconds);
      return Number.isFinite(seconds) && seconds >= 0
        ? { label, action: { type: "delay", seconds: Math.round(seconds) } }
        : null;
    }
    case "out_of_band": {
      const note = text(action.note);
      // The note IS the exit here — a lift with no stated path is unreachable.
      return note === "" ? null : { label, action: { type: "out_of_band", note } };
    }
    default:
      return null;
  }
}

function readFriction(raw: unknown): GateFriction | null {
  if (!isRecord(raw)) {
    return null;
  }
  switch (raw.type) {
    case "confirmation":
      return { type: "confirmation" };
    case "intention": {
      const prompt = text(raw.prompt);
      return prompt === "" ? null : { type: "intention", prompt };
    }
    case "delay": {
      const seconds = Number(raw.seconds);
      return Number.isFinite(seconds) ? { type: "delay", seconds: Math.round(seconds) } : null;
    }
    case "breath": {
      const cycles = Number(raw.cycles);
      return Number.isFinite(cycles) ? { type: "breath", cycles: Math.round(cycles) } : null;
    }
    default:
      return null;
  }
}

function readEnforcement(raw: unknown): FenceEnforcement | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.kind === "cooldown") {
    const at = raw.enforcement;
    const enforcement: "browser" | "resolver" | "device" =
      at === "resolver" || at === "device" ? at : "browser";
    return { kind: "block", enforcement, standing: raw.standing === true };
  }
  if (raw.kind === "gate") {
    const friction = readFriction(raw.friction);
    const everyMinutes = Number(raw.everyMinutes);
    if (friction === null || !Number.isFinite(everyMinutes) || everyMinutes <= 0) {
      return null;
    }
    return { kind: "gate", everyMinutes: Math.round(everyMinutes), friction };
  }
  return null;
}

function readDomains(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const host = normalizeDomain(entry);
    if (host !== null) {
      out.add(host);
    }
  }
  return [...out];
}

function domainsFromScope(scope: unknown): readonly string[] {
  if (!isRecord(scope)) return [];
  if (scope.surface !== "browser") return [];
  const d = scope.domain;
  if (typeof d === "string") return readDomains([d]);
  if (Array.isArray(d)) return readDomains(d);
  return [];
}

function enforcementFromPrimitive(p: Record<string, unknown>): FenceEnforcement | null {
  if (p.kind === "cooldown") {
    const at = isRecord(p.enforcement) ? p.enforcement.at : undefined;
    const enforcement: "browser" | "resolver" | "device" =
      at === "resolver" || at === "device" ? at : "browser";
    const standing = p.duration != null && isRecord(p.duration) && p.duration.type === "standing"
      || p.duration != null && isRecord(p.duration) && (p.duration as Record<string, unknown>).standing === true;
    return { kind: "block", enforcement, standing };
  }
  if (p.kind === "gate") {
    const trigger = isRecord(p.trigger) ? p.trigger : null;
    const everyMinutes = trigger?.type === "dwell"
      ? Number(trigger.everyMinutes)
      : 0;
    const frictionType = isRecord(p.frictionType) ? p.frictionType : null;
    const friction = frictionType ? readFriction(frictionType) : null;
    if (friction === null) return null;
    return {
      kind: "gate",
      everyMinutes: Number.isFinite(everyMinutes) && everyMinutes > 0 ? Math.round(everyMinutes) : 1,
      friction,
    };
  }
  return null;
}

function proceedFromPrimitive(p: Record<string, unknown>): ProceedAffordance | null {
  if (p.kind === "cooldown") {
    const unlock = isRecord(p.unlockPath) ? p.unlockPath : null;
    if (!unlock) return null;
    switch (unlock.type) {
      case "wait":
        return { label: "Wait it out", action: { type: "wait" } };
      case "out_of_band": {
        const note = text(unlock.note);
        return note ? { label: note, action: { type: "out_of_band", note } } : null;
      }
      case "unlock_with_intention": {
        const prompt = text(unlock.prompt);
        return prompt ? { label: "Unlock", action: { type: "intention", prompt } } : null;
      }
      case "unlock_with_delay": {
        const seconds = Number(unlock.seconds);
        return Number.isFinite(seconds) ? { label: "Wait", action: { type: "delay", seconds: Math.round(seconds) } } : null;
      }
      default: return null;
    }
  }
  if (p.kind === "gate") {
    const aff = isRecord(p.proceedAffordance) ? p.proceedAffordance : null;
    if (!aff) return null;
    return readProceed(aff);
  }
  return null;
}

function readSchedule(p: Record<string, unknown>): { inner: Record<string, unknown>; schedule: ScheduleWindow } | null {
  if (p.kind !== "schedule") return null;
  const window = isRecord(p.window) ? p.window : null;
  const wraps = isRecord(p.wraps) ? p.wraps : null;
  if (!window || !wraps) return null;
  const fromHour = Number(window.fromHour);
  const toHour = Number(window.toHour);
  if (!Number.isFinite(fromHour) || !Number.isFinite(toHour)) return null;
  const weekdays = Array.isArray(window.weekdays)
    ? (window.weekdays as unknown[]).filter((w): w is string => typeof w === "string")
    : undefined;
  return {
    inner: wraps,
    schedule: {
      fromHour, toHour,
      ...(weekdays && weekdays.length > 0 ? { weekdays } : {}),
      outsideWindow: p.outsideWindow === "passthrough" ? "passthrough" : "inactive",
    },
  };
}

function readProbability(raw: unknown): number {
  const p = Number(raw);
  if (raw === undefined || raw === null || !Number.isFinite(p)) {
    return 1;
  }
  return Math.min(1, Math.max(0, p));
}

/**
 * Read a pushed fences record.
 *
 * Returns `null` when the push is not a record collection at all. That is the
 * difference that keeps the shields up: **malformed means keep what you have,
 * empty means lift.** An older host, a truncated frame or a garbled reply must
 * never read as "nothing is fenced" — but an explicitly empty record is the
 * person taking a fence down, and it has to land.
 */
export function parseFences(raw: unknown): ParsedFences | null {
  if (!isRecord(raw)) {
    return null;
  }

  const fences: Record<string, Fence> = {};
  const refused: Refusal[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }
    const id = (text(value.id) || key).slice(0, MAX_ID);
    if (id === "") {
      continue;
    }

    // Vault entries carry `defaultEnabled`; false means the gardener turned it
    // off. Enforcing a disabled fence is the exact error the flag exists to
    // prevent, so skip it before any further parsing.
    if (value.defaultEnabled === false) {
      continue;
    }

    // Try the flat format first (test fixtures, legacy), then the vault format.
    let enforcement = readEnforcement(value.enforcement);
    let proceed = readProceed(value.proceed);
    let domains = readDomains(value.domains);
    let schedule: ScheduleWindow | undefined;
    let abortLabel = isRecord(value.abort) ? text(value.abort.label) : "";

    if (enforcement === null && Array.isArray(value.primitives)) {
      // Vault format: read from primitives[] + scope.
      domains = domains.length > 0 ? domains : [...domainsFromScope(value.scope)];
      const primitives = value.primitives as unknown[];
      const first = primitives[0];
      if (isRecord(first)) {
        let inner = first;
        const sched = readSchedule(first);
        if (sched) {
          inner = sched.inner;
          schedule = sched.schedule;
        }
        enforcement = enforcementFromPrimitive(inner);
        proceed = proceed ?? proceedFromPrimitive(inner);
        if (inner.kind === "gate" && isRecord(inner.abortAffordance)) {
          abortLabel = abortLabel || text(inner.abortAffordance.label);
        }
      }
    }

    if (enforcement === null) {
      refused.push({ id, reason: "unactuatable" });
      continue;
    }
    if (proceed === null) {
      refused.push({ id, reason: "no_exit" });
      continue;
    }
    if (domains.length === 0) {
      refused.push({ id, reason: "no_domains" });
      continue;
    }

    fences[id] = {
      id,
      label: text(value.label) || text(value.name) || id,
      domains,
      enforcement,
      proceed,
      ...(abortLabel === "" ? {} : { abort: { label: abortLabel } }),
      ...(schedule ? { schedule } : {}),
      deliveryProbability: readProbability(value.deliveryProbability),
    };
  }

  return { fences, refused };
}

/** Does `host` fall under `domain`? Exact match or a true subdomain, which is
 * what DNR's `requestDomains` already does — the two must not disagree. */
function covers(domain: string, host: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Whether a scheduled fence is currently active (outside the watering window). */
export function isScheduleActive(schedule: ScheduleWindow, now: Date = new Date()): boolean {
  if (schedule.weekdays && schedule.weekdays.length > 0) {
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const today = dayNames[now.getDay()];
    if (!schedule.weekdays.includes(today)) return false;
  }
  const hour = now.getHours();
  const { fromHour, toHour } = schedule;
  const inWindow = fromHour <= toHour
    ? hour >= fromHour && hour < toHour
    : hour >= fromHour || hour < toHour;
  return schedule.outsideWindow === "inactive" ? !inWindow : true;
}

/** Whether a fence is currently active, considering its schedule. */
function isFenceActive(fence: Fence): boolean {
  if (!fence.schedule) return true;
  return isScheduleActive(fence.schedule);
}

/** Every active fence on `host`. The hot-path read: pure, local, no round trip. */
export function fencesFor(fences: Fences, host: string): readonly Fence[] {
  const needle = normalizeDomain(host);
  if (needle === null) {
    return [];
  }
  const out: Fence[] = [];
  for (const entry of Object.values(fences)) {
    if (entry.domains.some((d) => covers(d, needle)) && isFenceActive(entry)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Hosts under a standing block this surface enforces.
 *
 * Resolver- and device-enforced blocks are deliberately absent: they hold
 * somewhere the extension is not, and projecting them here would double-block
 * on this machine while reporting a firing that another surface actually made.
 */
export function standingBlockHosts(fences: Fences): readonly string[] {
  const out = new Set<string>();
  for (const entry of Object.values(fences)) {
    const e = entry.enforcement;
    if (e.kind !== "block" || !e.standing || e.enforcement !== "browser") {
      continue;
    }
    if (!isFenceActive(entry)) continue;
    for (const domain of entry.domains) {
      out.add(domain);
    }
  }
  return [...out];
}

/**
 * Hosts a *timed* browser block may cover once set.
 *
 * The candidate set, not the held set: a timed block is set by a gesture —
 * the popup, the keyboard, the tray — and the cooldown state decides what
 * actually holds. This says which hosts a rule has made available to that gesture.
 */
export function fenceableHosts(fences: Fences): readonly string[] {
  const out = new Set<string>();
  for (const entry of Object.values(fences)) {
    const e = entry.enforcement;
    if (e.kind !== "block" || e.standing || e.enforcement !== "browser") {
      continue;
    }
    if (!isFenceActive(entry)) continue;
    for (const domain of entry.domains) {
      out.add(domain);
    }
  }
  return [...out];
}

/**
 * A gate's exit, narrowed to the three actions an interstitial can offer.
 *
 * `wait`, `delay`, `intention` and `out_of_band` are block vocabulary — a
 * lockout's way out, not a gate's — so a gate carrying one degrades to
 * `continue` rather than being dropped. The label survives either way, which is
 * what the person actually reads.
 */
function gateAction(proceed: ProceedAffordance): DwellGate["proceed"]["action"] {
  const { action } = proceed;
  if (action.type === "redirect") {
    return { type: "redirect", to: action.to };
  }
  if (action.type === "abort") {
    return { type: "abort" };
  }
  return { type: "continue" };
}

/**
 * The standing gates, in the shape the dwell interpreter already speaks.
 *
 * Reusing `DwellGate` rather than inventing a parallel gate type is what keeps
 * one interstitial in the codebase: a fenced gate and a policy gate are the
 * same primitive arriving down two transports, and they must not diverge into
 * two overlays with two behaviours.
 */
export function gatesFrom(fences: Fences): readonly DwellGate[] {
  const out: DwellGate[] = [];
  for (const entry of Object.values(fences)) {
    if (entry.enforcement.kind !== "gate") {
      continue;
    }
    out.push({
      ruleId: entry.id,
      domains: entry.domains,
      everyMinutes: entry.enforcement.everyMinutes,
      friction: entry.enforcement.friction,
      proceed: { label: entry.proceed.label, action: gateAction(entry.proceed) },
      abort: entry.abort ?? { label: "Close the tab" },
    });
  }
  return out;
}

/**
 * The exit as one readable line.
 *
 * This is what makes invariant 6 visible rather than merely true. A standing
 * block replaces the page with the browser's own error page, where no
 * extension UI can run, so the way out has to be legible on a surface that is
 * always reachable — see the popup.
 */
export function exitLine(fence: Fence): string {
  const { label, action } = fence.proceed;
  switch (action.type) {
    case "out_of_band":
      return `${label} — ${action.note}`;
    case "intention":
      return `${label} — ${action.prompt}`;
    case "delay":
      return `${label} — after ${action.seconds}s`;
    case "redirect":
      return `${label} — goes to ${action.to}`;
    default:
      return label;
  }
}
