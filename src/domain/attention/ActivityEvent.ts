import type { Duration, Instant } from "./ids";

/**
 * Read-side mirror of keel's activity log.
 *
 * zenborg never writes these. keel does, and this app reads them. The interface
 * is copied rather than imported from `keel/packages/domain` on purpose: that
 * package is scheduled for deletion at migration step 6, and a cross-repo import
 * would make the deletion harder rather than easier.
 *
 * Contract: `keel/packages/domain/docs/event-taxonomy.md`.
 */

/**
 * The surface that observed the event. `git` is a spring whose lines are
 * day tallies, never spans: read them as counts.
 */
export type ActivitySurface =
  | "agent"
  | "desktop"
  | "browser"
  | "garmin"
  | "git";

/**
 * Kinds are an open set. They accrete per surface and are never centrally
 * enumerated, which is why this is `string` and not a union.
 */
export type ActivityEventKind = string;

/** A single raw observation. Immutable once written. */
export interface ActivityEvent {
  readonly id: string;
  readonly surface: ActivitySurface;
  readonly kind: ActivityEventKind;
  readonly ts: Instant;
  readonly sessionId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly durationMs?: Duration;
}

/**
 * Who produced the event.
 *
 * The agent surface is the only one carrying more than one, and conflating them
 * produces confident nonsense: one human `prompt` can emit eighty
 * `tool_dispatched`, and agent-actor baselines shift whenever the model or
 * harness changes. Any claim about the person must be built from human kinds.
 */
export type Actor = "human" | "agent" | "joint";

/** Actor assignment for the agent surface. Kinds absent here default to `agent`. */
const AGENT_ACTORS: Readonly<Record<string, Actor>> = {
  prompt: "human",
  permission_request: "human",
  config_change: "human",
  rule_changed: "human",
  intention_switched: "human",
  tool_dispatched: "agent",
  tool_completed: "agent",
  tool_failed: "agent",
  subagent_stop: "agent",
  pre_compact: "agent",
  notification: "agent",
  session_start: "joint",
  session_end: "joint",
  turn_stop: "joint",
  file_changed: "joint",
};

/**
 * Resolve the actor behind an event.
 *
 * Unknown agent-surface kinds resolve to `agent`, never `human`. Guessing in the
 * permissive direction would inflate every magnitude derived from this, which is
 * the same reason shadow mode defaults to off.
 */
export function actorOf(event: ActivityEvent): Actor {
  if (event.surface === "garmin") return "agent";
  if (event.surface !== "agent") return "human";
  return AGENT_ACTORS[event.kind] ?? "agent";
}

/** True when the event reflects the person's own exertion. */
export function isHumanActor(event: ActivityEvent): boolean {
  return actorOf(event) === "human";
}

/**
 * One raw log line, as it sits in `log/<day>.<surface>.jsonl`, made into an
 * event. The app and the MCP server both parse through this, so they cannot
 * disagree about what a line means.
 *
 * - Lines missing `surface` (older files) take it from the filename.
 * - `app_switched` drops `durationMs`. The field describes the span being
 *   closed (the previous app's dwell), not the one being opened. Dwell comes
 *   from consecutive timestamps anyway; keeping it would let `reachOf` in
 *   `SpanDerivation` extend the new app's span by the previous app's dwell.
 */
export function normaliseEvent(
  raw: ActivityEvent,
  surface: ActivitySurface,
): ActivityEvent {
  const event = raw.surface ? raw : { ...raw, surface };
  if (event.kind === "app_switched" && event.durationMs !== undefined) {
    const { durationMs: _, ...rest } = event;
    return rest;
  }
  return event;
}

/** Parse a JSONL file's text. A torn line is one lost observation, never a throw. */
export function parseActivityLines(
  text: string,
  surface: ActivitySurface,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(normaliseEvent(JSON.parse(line) as ActivityEvent, surface));
    } catch {
      // torn line
    }
  }
  return events;
}
