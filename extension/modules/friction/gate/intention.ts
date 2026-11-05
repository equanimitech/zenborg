/**
 * Intention gate — the pure half.
 *
 * A gate on a host can offer to START the moment planted for it today: the
 * person names the intention, picks how long, passes a breath, and the active
 * moment switches for that long (through the writer; see relay/client.ts). At
 * the end, a quiet line on the page asks what it gave.
 *
 * Nothing here starts on a visit. The offer rides a gate that already fired,
 * and only when a moment for this host is planted today and is not already
 * the one in force. No planted moment, no offer: the gate is what it was.
 */

import { createDomain } from "../../domain";
import type { TodayMoment } from "../../relay/client";

/** What the gate offers to start. */
export interface StartOffer {
  readonly momentId: string;
  readonly name: string;
  /** Picker choices in minutes; the first is the default. */
  readonly minutes: readonly number[];
}

/** A switch the gate started, kept until its reflection is asked. */
export interface GateSession {
  readonly domain: string;
  readonly momentId: string;
  readonly name: string;
  readonly intention: string;
  readonly until: number;
  /** The reflection has been put to the page; it is asked once. */
  readonly asked?: true;
}

/** The short list when the moment carries no duration of its own. */
export const DEFAULT_MINUTES = [15, 30, 60] as const;
export const MAX_MINUTES = 240;
/** Past this, an end nobody was on the page for is let go unasked. */
export const REFLECT_WINDOW_MS = 30 * 60_000;
const MAX_TEXT = 500;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** `m.youtube.com` → `youtube`: the label a habit would be named after. */
const siteLabel = (host: string) => {
  const parts = createDomain(host).split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
};

/** True when `host` is `ref` or one of its subdomains. */
const onHost = (host: string, ref: string) => {
  const h = createDomain(host);
  const r = createDomain(ref);
  return h === r || h.endsWith(`.${r}`);
};

/**
 * The moment planted today that this host is for, or null.
 *
 * The moment's own `refs` first (the mapping zenborg already has — the same
 * hostnames moment friction reads); else a habit or moment whose name is the
 * site's label ("YouTube" ↔ youtube.com, "Chess" ↔ chess.com). The board is
 * already today's, in order.
 */
export function gateMomentFor(host: string, board: readonly TodayMoment[]): StartOffer | null {
  const open = board.filter((m) => !m.active);
  const label = siteLabel(host);
  const hit =
    open.find((m) => (m.hosts ?? []).some((ref) => onHost(host, ref))) ??
    open.find((m) => [m.habitName, m.name].some((n) => typeof n === "string" && squash(n) === label));
  if (!hit) return null;
  return { momentId: hit.id, name: hit.name, minutes: minuteChoices(hit.durationMin) };
}

/** The moment's own duration first, then the short list. */
export function minuteChoices(durationMin: number | null | undefined): readonly number[] {
  const own =
    typeof durationMin === "number" && Number.isInteger(durationMin) && durationMin > 0 && durationMin <= MAX_MINUTES
      ? [durationMin]
      : [];
  return [...new Set([...own, ...DEFAULT_MINUTES])];
}

/** Is it time to ask what the session gave, on this host? */
export function reflectionDue(session: GateSession | null, domain: string, now: number): boolean {
  return (
    session !== null &&
    session.asked !== true &&
    session.domain === domain &&
    now >= session.until &&
    now - session.until < REFLECT_WINDOW_MS
  );
}

/** A start request from the page, reduced to well-formed scalars, or null. */
export function readStartRequest(
  msg: unknown
): { momentId: string; minutes: number; intention: string } | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== "kairos-gate-start") return null;
  const { momentId, minutes, intention } = m;
  if (typeof momentId !== "string" || momentId === "" || momentId.length > 128) return null;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) return null;
  if (typeof intention !== "string" || intention.trim() === "" || intention.length > MAX_TEXT) return null;
  return { momentId, minutes, intention: intention.trim() };
}

/** The reflection from the page: text, or null for a skip. `undefined` = not this message. */
export function readReflectRequest(msg: unknown): { text: string | null } | undefined {
  if (typeof msg !== "object" || msg === null) return undefined;
  const m = msg as Record<string, unknown>;
  if (m.type !== "kairos-gate-reflect") return undefined;
  const text = typeof m.text === "string" ? m.text.trim().slice(0, MAX_TEXT) : "";
  return { text: text === "" ? null : text };
}
