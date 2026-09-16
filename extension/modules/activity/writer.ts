/**
 * Activity writer — chrome.* wiring for the browser surface.
 *
 * Runs in the background SERVICE WORKER only. No event data ever
 * originates from page-context content scripts (hostile-page boundary),
 * and nothing here makes a network call — events are persisted to
 * extension-local IndexedDB (see `log.ts`) until the desktop relay exists.
 *
 * sessionId rotates with the service-worker lifetime: each cold start of
 * the worker generates a fresh uuid and logs "writer_started". That id is
 * a writer epoch — mechanical provenance, not a behavioral session
 * (bouts are derived read-side; see docs/event-taxonomy.md).
 */

import { storage } from "wxt/storage";
import {
  IDLE_DETECTION_SECONDS,
  audibleTransition,
  buildBrowserEvent,
  domainFromUrl,
  excessEventCount,
  focusTransition,
  idleTransition,
  routeChanged,
  routeFor,
  shouldLogNavigation,
  shouldLogRoute,
  shouldLogTabClose,
  tabOpenPayload,
} from "./events";
import { tabUuid, type TabMap } from "./tabs";
import { appendEvent, countEvents, deleteOldestEvents } from "./log";
import {
  isArmQuery,
  isGateQuery,
  sensorAllowed,
  validateSensorMessage,
} from "../sensors/events";
import { derivedObserveDomains } from "../watchlist/store";
import { evaluateGates } from "../friction/gate/decide";
import { evaluateMomentGate } from "../friction/gate/moment";
import { fencesFor, gatesFrom } from "../fence/parse";
import { fenceCache } from "../fence/store";
import type { Fence, Fences } from "../fence/types";
import {
  interventionEvent,
  isSettlement,
  settlementKind,
  type InterventionKind,
} from "../fence/events";
import type { Runtime } from "wxt/browser";

type WriteFn = (
  kind: string,
  payload?: Readonly<Record<string, unknown>>,
  durationMs?: number
) => void;

/**
 * The standing gates on one host, in the shape the dwell interpreter reads.
 *
 * Replaces the retired `armedGatesFor`: same composition (narrow to the host,
 * then project to `DwellGate`), now over the fence cache.
 */
function fenceGatesFor(fences: Fences, host: string) {
  const onHost: Record<string, Fence> = {};
  for (const f of fencesFor(fences, host)) {
    onHost[f.id] = f;
  }
  return gatesFrom(onHost);
}

const tabMapItem = storage.defineItem<TabMap>("session:activity:tabMap", { fallback: {} });
const focusSinceItem = storage.defineItem<number | null>("session:activity:focusSince", { fallback: null });
const routeByTab = storage.defineItem<Record<number, string | null>>("session:activity:routeByTab", { fallback: {} });

/**
 * Register all attention-event listeners. Must be called synchronously
 * from the background entrypoint so MV3 event-driven wakeups re-attach.
 */
export function startActivityWriter(): void {
  const sessionId = crypto.randomUUID();

  /**
   * Record one delivery event.
   *
   * Goes through `interventionEvent` rather than `write` so the payload shape
   * has exactly one home — the same reason the sensor channel validates in one
   * place. Fail-open like every other write: a dropped event must never break
   * the browsing session, and a gate that fired still fired.
   */
  const writeDelivery = (
    kind: InterventionKind,
    fields: { readonly domain: string; readonly ruleId: string; readonly primitive: "gate" | "cooldown" }
  ): void => {
    void appendEvent(
      interventionEvent({
        kind,
        ruleId: fields.ruleId,
        domain: fields.domain,
        primitive: fields.primitive,
        id: crypto.randomUUID(),
        ts: Date.now(),
        sessionId,
      })
    );
  };

  const write: WriteFn = (kind, payload, durationMs) => {
    // Fail-open: appendEvent swallows storage errors; a dropped event
    // must never break the browsing session.
    void appendEvent(
      buildBrowserEvent({
        id: crypto.randomUUID(),
        kind,
        ts: Date.now(),
        sessionId,
        payload,
        durationMs,
      })
    );
  };

  // New service-worker lifetime → new writer epoch (sessionId groups it).
  // Mechanical, not behavioral — bouts are derived read-side.
  write("writer_started");

  // Retention guard: cap the store at MAX_LOG_EVENTS on startup.
  void runRetentionGuard(write);

  // ── Tab lifecycle (open / activate / close) ───────────────────
  const lastDomainByTab = new Map<number, string>();

  // A new tab is the open bracket of a tab's lifecycle. onCreated fires
  // before any navigation, so a web URL is usually absent (chrome://newtab
  // or a pending nav); the tab uuid alone makes tab concurrency computable.
  browser.tabs.onCreated.addListener(async (tab) => {
    if (tab.id === undefined) {
      return; // No id — nothing to track this tab by.
    }
    try {
      const url = tab.url ?? tab.pendingUrl;
      const domain = url === undefined ? null : domainFromUrl(url);
      const map = await tabMapItem.getValue();
      const { uuid, map: next } = tabUuid(map, tab.id, () => crypto.randomUUID());
      if (next !== map) await tabMapItem.setValue(next);
      write("tab_opened", tabOpenPayload(uuid, domain));
      if (domain !== null) {
        lastDomainByTab.set(tab.id, domain);
      }
    } catch {
      // storage/tab vanished — fail-open
    }
  });

  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await browser.tabs.get(tabId);
      const domain = tab.url === undefined ? null : domainFromUrl(tab.url);
      if (domain === null) return;
      const map = await tabMapItem.getValue();
      const { uuid, map: next } = tabUuid(map, tabId, () => crypto.randomUUID());
      if (next !== map) await tabMapItem.setValue(next);
      write("tab_activated", { domain, tab: uuid });
      lastDomainByTab.set(tabId, domain);
    } catch {
      // tab vanished — fail-open
    }
  });

  // ── Audible span (tab producing audio — calls, media) ─────────
  const audibleSince = new Map<number, number>();

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.audible !== undefined) {
      try {
        const tab = await browser.tabs.get(tabId);
        const domain = tab.url === undefined ? null : domainFromUrl(tab.url);
        if (domain === null) return;
        const map = await tabMapItem.getValue();
        const { uuid, map: next } = tabUuid(map, tabId, () => crypto.randomUUID());
        if (next !== map) await tabMapItem.setValue(next);
        const now = Date.now();
        const t = audibleTransition(audibleSince.get(tabId) ?? null, changeInfo.audible, now);
        if (t.spanStart !== null) {
          audibleSince.set(tabId, t.spanStart);
        } else {
          audibleSince.delete(tabId);
        }
        if (t.kind !== null) {
          write(t.kind, { domain, tab: uuid }, t.durationMs);
        }
      } catch {
        // tab vanished — fail-open
      }
    }
  });

  // ── Navigation (domain changes only, never per-SPA-path) ──────
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url === undefined) return;
    const { domain: nextDomain, route: nextRoute } = routeFor(changeInfo.url);
    const previousDomain = lastDomainByTab.get(tabId) ?? null;

    const map = await tabMapItem.getValue();
    const minted = tabUuid(map, tabId, () => crypto.randomUUID());
    if (minted.map !== map) await tabMapItem.setValue(minted.map);
    const tab = minted.uuid;

    const observe = await derivedObserveDomains();
    const logDetail = true; // C1: logDetail dial defaults on; config gate is a later task

    if (shouldLogNavigation(previousDomain, nextDomain)) {
      const payload: Record<string, unknown> = { domain: nextDomain, tab };
      if (shouldLogRoute(nextDomain, observe, logDetail) && nextRoute !== null) {
        payload.route = nextRoute;
      }
      write("navigation_committed", payload);
    } else if (shouldLogRoute(nextDomain, observe, logDetail)) {
      const routes = await routeByTab.getValue();
      if (routeChanged(routes[tabId] ?? null, nextRoute)) {
        write("route_changed", { domain: nextDomain, route: nextRoute, tab });
      }
    }

    if (nextDomain === null) {
      lastDomainByTab.delete(tabId);
    } else {
      lastDomainByTab.set(tabId, nextDomain);
      const routes = await routeByTab.getValue();
      await routeByTab.setValue({ ...routes, [tabId]: nextRoute });
    }
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
    // A closed tab is a dismissal — a stronger "done with this" signal than a
    // focus switch, and (unlike focus_end) it brackets a BACKGROUND tab the
    // focus span never saw. Log it only when we tracked a web domain for it.
    const domain = lastDomainByTab.get(tabId) ?? null;
    if (shouldLogTabClose(domain)) {
      const map = await tabMapItem.getValue();
      const { uuid, map: next } = tabUuid(map, tabId, () => crypto.randomUUID());
      if (next !== map) await tabMapItem.setValue(next);
      write("tab_closed", { domain, tab: uuid });
    }
    lastDomainByTab.delete(tabId);
    audibleSince.delete(tabId);
  });

  // ── Focus span (browser holds OS focus) ───────────────────────
  // focusSinceItem persists across MV3 SW recycling within the same browser
  // session. The fallback is null — the first onFocusChanged call that finds
  // isFocused=true opens the span (focus_start). This matches the original
  // "conservative" intent: we never inflate a span across an unknown gap.
  browser.windows.onFocusChanged.addListener(async (windowId) => {
    const isFocused = windowId !== browser.windows.WINDOW_ID_NONE;
    const focusSince = await focusSinceItem.getValue();
    const t = focusTransition(focusSince, isFocused, Date.now());
    await focusSinceItem.setValue(t.spanStart);
    if (t.kind !== null) write(t.kind, undefined, t.durationMs);
  });

  // ── Sensor channel (key-action completions, observe tier) ─────
  // The hostile-page boundary: kind allowlisted, payload reduced to
  // capped scalars, domain taken from the browser-attested sender tab,
  // and nothing persists unless the domain is on the observe tier.
  browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
    const url = sender.tab?.url;
    const domain = url === undefined ? null : domainFromUrl(url);

    // Arm handshake: a content script asks whether to observe at all.
    if (isArmQuery(message)) {
      return derivedObserveDomains()
        .then(async (observe) => ({
          observed: sensorAllowed(domain, observe),
          // The fence cache is consulted here as well as in the poll, or a
          // fence would never gate its page in the first place. One store since
          // migration step 5: the policy mirror's gate list came from
          // `~/.zenborg/keel/rules/*.json`, which is retired.
          gate:
            domain === null
              ? null
              : (fenceGatesFor(await fenceCache.getValue(), domain)[0] ?? null),
        }))
        .catch(() => ({ observed: false, gate: null }));
    }

    // "Close the tab" from a gate. The page cannot close a tab it did not
    // open, so the background does it.
    if (
      typeof message === "object" &&
      message !== null &&
      (message as Record<string, unknown>).type === "kairos-gate-leave"
    ) {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        void browser.tabs.remove(tabId);
      }
      return;
    }

    // Gate poll. The decision — including recording that the gate fired — is
    // made here rather than in the page, because a content script can be
    // reloaded at will and one that could decline to report a firing would
    // earn a free pass by refreshing.
    if (isGateQuery(message)) {
      if (domain === null) {
        return Promise.resolve({ fire: false });
      }
      // The running moment gets asked first, and only ever *adds* a gate: it
      // fires when this host is outside what the moment is about, and returns
      // null otherwise. Null falls through to the area's own dwell gates —
      // which is also what a moment with nothing declared does, so the area
      // policy remains the floor rather than being replaced by one.
      return evaluateMomentGate(domain)
        .then(async (moment) => {
          if (moment !== null) {
            return moment;
          }
          // Every gate on the domain, not the first — see `evaluateGates`. A second
          // rule used to be dropped on the floor here.
          //
          // One list, from one store. Slice E unioned the fence cache with the
          // policy mirror because the two carried different rules from different
          // files; step 5 retired the second file, so the union has nothing left
          // to add. The read is local, so the hot path makes no round trip.
          return evaluateGates(fenceGatesFor(await fenceCache.getValue(), domain));
        })
        .then((verdict) => {
          // The delivery, recorded here rather than in the page for the same
          // reason the firing is: a content script that could decline to report
          // would earn a free pass by refreshing. `intervention_shown` is a
          // completion in `logs` — there is no second collection.
          if (verdict.fire && verdict.ruleId !== undefined) {
            writeDelivery("intervention_shown", {
              domain,
              ruleId: verdict.ruleId,
              primitive: "gate",
            });
          }
          return verdict;
        })
        .catch(() => ({ fire: false }));
    }

    // How the delivery ended. The page reports which rule and whether the
    // person proceeded; the domain still comes from the browser-attested
    // sender tab, exactly as the sensor channel does.
    if (isSettlement(message)) {
      if (domain !== null) {
        writeDelivery(settlementKind(message.proceeded), {
          domain,
          ruleId: message.ruleId,
          primitive: "gate",
        });
      }
      return;
    }

    const validated = validateSensorMessage(message);
    if (validated === null) {
      return;
    }
    void derivedObserveDomains()
      .then((observe) => {
        if (sensorAllowed(domain, observe)) {
          write(validated.kind, { domain, ...validated.payload });
          flashSensorBadge(sender.tab?.id);
        }
      })
      .catch(() => {
        // Storage unavailable — drop, fail-open.
      });
  });

  // ── Idle span (AFK bracketing) ─────────────────────────────────
  let idleSince: number | null = null;

  browser.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  browser.idle.onStateChanged.addListener((state) => {
    const t = idleTransition(idleSince, state, Date.now());
    idleSince = t.spanStart;
    if (t.kind === "idle_start") {
      write(t.kind, { state, thresholdMs: IDLE_DETECTION_SECONDS * 1000 });
    } else if (t.kind !== null) {
      write(t.kind, undefined, t.durationMs);
    }
  });
}

/**
 * Flash the toolbar icon for ~2s when a sensor event lands, so the human
 * can SEE a key-action completion register without tailing logs. Purely
 * cosmetic and best-effort: scoped to the firing tab, and never throws
 * into the write path (a missing `action`, denied permission, or vanished
 * tab is swallowed). `tabId` undefined falls back to the global badge.
 */
const SENSOR_BADGE_MS = 2000;

function flashSensorBadge(tabId: number | undefined): void {
  try {
    void browser.action.setBadgeText({ text: "●", tabId }).catch(() => {});
    void browser.action
      .setBadgeBackgroundColor({ color: "#3b82f6", tabId })
      .catch(() => {});
    setTimeout(() => {
      void browser.action.setBadgeText({ text: "", tabId }).catch(() => {});
    }, SENSOR_BADGE_MS);
  } catch {
    // action API unavailable (or tab gone) — indicator is non-essential.
  }
}

async function runRetentionGuard(write: WriteFn): Promise<void> {
  const total = await countEvents();
  const excess = excessEventCount(total);
  if (excess > 0) {
    const deleted = await deleteOldestEvents(excess);
    if (deleted > 0) {
      write("log_pruned", { count: deleted });
    }
  }
}
