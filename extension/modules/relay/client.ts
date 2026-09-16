/**
 * Relay client — the extension's channel to the zenborg store.
 *
 * ── One store, queried ──────────────────────────────────────────────────
 *
 * `~/.zenborg/keel/log/` is the store. The tray writes to it, the agent writes to it,
 * and this extension writes to it through the native host. Nobody keeps a
 * second copy.
 *
 * That means the extension's IndexedDB is an **outbox**, not a history: events
 * land there, get shipped, and are deleted on ack. When a surface needs to know
 * what happened, it *asks* (`queryEvents`) rather than remembering.
 *
 * This is ActivityWatch's shape — one server owning storage, clients querying —
 * arrived at after briefly building the alternative. A watermark plus a
 * duplicated local history was added and removed on 2026-08-06: both were
 * workarounds for the absence of a read path, and the read path is three
 * messages.
 *
 * Deliberately native messaging rather than aw-server's localhost HTTP: an
 * extension calling `http://localhost` needs a host permission, and shipping
 * zero `host_permissions` is zenborg's structural guarantee that it cannot read
 * your browsing. Same architecture, none of the exposure.
 *
 * Fail-open throughout. Pure helpers (chunkEvents/unacked) are unit-tested; the
 * connectNative wiring is integration.
 */
import type { ActivityEvent } from "../domain";
import { readAllEvents, deleteEventsByIds } from "../activity/log";
import { replaceObserveDomains } from "../watchlist/store";
import { replacePolicy, areaMap } from "../friction/policy/store";
import { replaceFences } from "../fence/store";
import { chunkEvents } from "./batch";

export { chunkEvents, unacked } from "./batch";

const HOST_NAME = "tech.equanimi.kairos";
const MAX_BATCH = 1000;
/** A query streams in frames; give the host room to finish before hanging up. */
const QUERY_TIMEOUT_MS = 15_000;

/**
 * Assign a domain to an area (empty `areaId` un-assigns).
 *
 * A separate short-lived connection rather than riding the flush: assignment is
 * interactive and must land now, while the flush runs on a 5-minute alarm. The
 * host replies `area_set`, which triggers a re-pull so every surface agrees.
 */
export async function setArea(domain: string, areaId: string): Promise<boolean> {
  const map = await areaMap.getValue();
  const next = { ...map };
  if (areaId === "") {
    delete next[domain];
  } else {
    next[domain] = areaId;
  }
  await areaMap.setValue(next);

  let port: ReturnType<typeof browser.runtime.connectNative>;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch {
    return false;
  }
  try {
    port.postMessage({ type: "set_area", domain, areaId });
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => port.disconnect(), 1000);
  }
}

/**
 * Ask the store what happened since `since`.
 *
 * Returns raw events; the caller runs `bouts()` over them. The host streams
 * rather than computing because the domain module is TypeScript and the agent
 * surface is plain JS — so the one dwell implementation stays in one place,
 * and the cost is a few MB over a channel that is already local.
 *
 * Nothing is persisted. The page computes, renders, and discards.
 */
export async function queryEvents(since: number): Promise<readonly ActivityEvent[]> {
  let port: ReturnType<typeof browser.runtime.connectNative>;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch (e) {
    console.warn("[zenborg relay] connectNative threw:", e);
    return [];
  }

  return new Promise((resolve) => {
    const collected: ActivityEvent[] = [];
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        port.disconnect();
      } catch {
        // already gone
      }
      resolve(collected);
    };

    // A host that dies mid-stream yields what arrived, never a hung page.
    const timer = setTimeout(finish, QUERY_TIMEOUT_MS);

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      finish();
    });
    port.onMessage.addListener((raw: unknown) => {
      const msg = raw as { type?: string; events?: ActivityEvent[]; done?: boolean };
      if (msg.type !== "events_slice") {
        return;
      }
      if (Array.isArray(msg.events)) {
        collected.push(...msg.events);
      }
      if (msg.done === true) {
        clearTimeout(timer);
        finish();
      }
    });

    try {
      port.postMessage({ type: "request_events", since });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

/**
 * The active moment — the running intention — from the vault.
 *
 * A short-lived connection: the new tab asks once at render, not on a cycle.
 * Null when nothing is active or the host is unreachable — the page shows
 * that honestly rather than guessing.
 */
export interface ActiveMoment {
  readonly id: string;
  readonly name: string;
  readonly area: string;
  readonly emoji: string;
}

export async function queryActiveMoment(): Promise<ActiveMoment | null> {
  let port: ReturnType<typeof browser.runtime.connectNative>;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ActiveMoment | null): void => {
      if (settled) { return; }
      settled = true;
      try { port.disconnect(); } catch { /* already gone */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), 5_000);

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      finish(null);
    });
    port.onMessage.addListener((raw: unknown) => {
      const msg = raw as { type?: string; moment?: ActiveMoment | null };
      if (msg.type === "active_moment") {
        clearTimeout(timer);
        finish(msg.moment ?? null);
      }
    });

    try {
      port.postMessage({ type: "request_active_moment" });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Today's moment board — what is planted for the current waking day, by phase.
 *
 * Same pattern as `queryActiveMoment`: one-shot, short-lived connection.
 */
export interface TodayMoment {
  readonly id: string;
  readonly name: string;
  readonly phase: string;
  readonly areaName: string;
  readonly areaEmoji: string;
  readonly areaColor: string;
  readonly active: boolean;
  readonly startTime: string | null;
  readonly durationMin: number | null;
  readonly status: string;
}

export interface TodayBoard {
  readonly moments: readonly TodayMoment[];
  readonly currentPhase: string;
}

export async function queryTodayMoments(): Promise<TodayBoard> {
  const empty: TodayBoard = { moments: [], currentPhase: "" };
  let port: ReturnType<typeof browser.runtime.connectNative>;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch {
    return empty;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TodayBoard): void => {
      if (settled) { return; }
      settled = true;
      try { port.disconnect(); } catch { /* already gone */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish(empty), 5_000);

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      finish(empty);
    });
    port.onMessage.addListener((raw: unknown) => {
      const msg = raw as { type?: string; moments?: TodayMoment[]; currentPhase?: string };
      if (msg.type === "today_moments") {
        clearTimeout(timer);
        finish({
          moments: Array.isArray(msg.moments) ? msg.moments : [],
          currentPhase: typeof msg.currentPhase === "string" ? msg.currentPhase : "",
        });
      }
    });

    try {
      port.postMessage({ type: "request_today_moments" });
    } catch {
      clearTimeout(timer);
      finish(empty);
    }
  });
}

// ── Persistent port ─────────────────────────────────────────────────────
//
// The native host watches fences.json and pushes changes immediately. For
// that push to arrive, the port must stay open. The connection is created
// on first flush and kept alive; if the host dies or the service worker
// restarts, the next flushToHost() reconnects.

let persistentPort: ReturnType<typeof browser.runtime.connectNative> | null = null;

function handleHostMessage(raw: unknown): void {
  const msg = raw as {
    type?: string;
    ids?: string[];
    domains?: string[];
    standing?: string[];
    armable?: string[];
    momentFriction?: { allow: string[]; deny: string[] } | null;
    fences?: unknown;
  };
  if (msg.type === "ack" && msg.ids) void deleteEventsByIds(msg.ids);
  else if (msg.type === "observe" && msg.domains) void replaceObserveDomains(msg.domains);
  else if (msg.type === "policy") void replacePolicy(msg);
  else if (msg.type === "fences") {
    void replaceFences(msg.fences).then((result) => {
      if (!result.applied) {
        console.warn("[zenborg fence] malformed push — keeping the previous cache");
        return;
      }
      for (const refusal of result.refused) {
        console.error(
          `[zenborg fence] refused "${refusal.id}": ${refusal.reason}` +
            (refusal.reason === "no_exit"
              ? " — invariant 6: a block with no visible exit is a bug, not a stricter shield"
              : "")
        );
      }
    });
  } else if (msg.type === "area_set") void flushToHost();
}

function ensurePort(): ReturnType<typeof browser.runtime.connectNative> | null {
  if (persistentPort) return persistentPort;
  try {
    const port = browser.runtime.connectNative(HOST_NAME);
    port.onDisconnect.addListener(() => {
      const err = browser.runtime.lastError;
      if (err) console.warn("[zenborg relay] native host disconnected:", err.message);
      persistentPort = null;
    });
    port.onMessage.addListener(handleHostMessage);
    persistentPort = port;
    return port;
  } catch (e) {
    console.warn("[zenborg relay] connectNative threw:", e);
    return null;
  }
}

/** Ship the outbox (ack-prune), pull observe + policy + fences. */
export async function flushToHost(): Promise<void> {
  const port = ensurePort();
  if (!port) return;
  try {
    const events = await readAllEvents();
    console.debug("[zenborg relay] flushing", events.length, "buffered events to", HOST_NAME);
    for (const batch of chunkEvents(events, MAX_BATCH)) {
      port.postMessage({ type: "events", events: batch });
    }
    port.postMessage({ type: "request_observe" });
    port.postMessage({ type: "request_policy" });
    port.postMessage({ type: "request_fences" });
  } catch {
    // host crashed mid-flush — buffered events stay in IndexedDB for the next flush
    persistentPort = null;
  }
}
