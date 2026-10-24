// Shared byte-for-byte by extension/modules/domain/ and src/domain/attention/browser/
// (the MCP server cannot import from extension/). The root suite pins the copies
// (src/domain/attention/__tests__/browserVendored.test.ts): change both together.

/**
 * Activity log — the observability substrate.
 *
 * One append-only stream of raw, immutable events per surface. The log is the
 * product: surfaces are writers, analytics/models are read-side consumers.
 * Raw events are never aggregated at write time; 3s-bin / rolling-window
 * features are derived downstream.
 *
 * Provenance contract (the Graphiti episode pattern): every event carries a
 * stable unique `id`. Derived facts (slice E) cite the events they were
 * computed from via `sourceEventIds`, and carry a bi-temporal envelope
 * `{ validFrom, validTo?, learnedAt, invalidatedAt? }` — superseded facts are
 * invalidated, never deleted.
 */

/** The surface that observed the event. `garmin` is a polling writer — it
 * transcribes body state Garmin already measured, rather than observing live. */
export type ActivitySurface = "agent" | "desktop" | "browser" | "garmin";

/**
 * Event kinds are an open set — each surface contributes its own vocabulary
 * (agent: session_start, prompt, tool_dispatched, tool_completed, turn_stop…;
 * desktop: app_switched, idle_start…; browser: tab_activated, navigation…).
 * Kinds accrete; they are not centrally enumerated. They DO conform to one
 * grammar — spans, switches, completions — defined in
 * `docs/event-taxonomy.md` (the writers' contract).
 */
export type ActivityEventKind = string;

/**
 * Read-side alias map for events logged before the 2026-06-12 taxonomy
 * unification. Raw files are never rewritten; consumers normalize through
 * `canonicalKind` instead. Values are always canonical (no chains).
 */
export const LEGACY_KIND_ALIASES: Readonly<Record<string, string>> = {
  browser_idle: "idle_start",
  browser_active: "idle_end",
  window_focus: "focus_start",
  window_blur: "focus_end",
  browser_session_start: "writer_started",
  logger_started: "writer_started",
  logger_paused: "writer_paused",
  logger_resumed: "writer_resumed",
  app_focus: "app_switched",
};

/** Normalize a (possibly pre-taxonomy) event kind to its canonical name. */
export function canonicalKind(kind: string): string {
  return LEGACY_KIND_ALIASES[kind] ?? kind;
}

/** A single raw observation. Immutable once written. */
export interface ActivityEvent {
  /** Stable unique id — the provenance anchor derived facts cite. */
  readonly id: string;
  readonly surface: ActivitySurface;
  readonly kind: ActivityEventKind;
  /** Epoch milliseconds at observation time. */
  readonly ts: number;
  /** Groups events of one session (agent: Claude session_id). Empty when unknown. */
  readonly sessionId: string;
  /** Full captured context, size-capped per field at the writer. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Set when the event closes a measurable interval (e.g. tool_completed). */
  readonly durationMs?: number;
}

/** Construct an ActivityEvent. The caller supplies the id (writers own
 * id generation — the domain stays free of randomness). */
export function createActivityEvent(args: {
  readonly id: string;
  readonly surface: ActivitySurface;
  readonly kind: ActivityEventKind;
  readonly ts: number;
  readonly sessionId?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly durationMs?: number;
}): ActivityEvent {
  const { id, surface, kind, ts, sessionId, payload, durationMs } = args;
  return durationMs === undefined
    ? { id, surface, kind, ts, sessionId: sessionId ?? "", payload: payload ?? {} }
    : { id, surface, kind, ts, sessionId: sessionId ?? "", payload: payload ?? {}, durationMs };
}
