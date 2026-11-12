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
  PLAYBACK_PROBE,
  probeWithTimeout,
  clickGateQuery,
  videoStartGateQuery,
  closeWrites,
  isArmQuery,
  isGateQuery,
  isVideoClose,
  senderDomain,
  sensorAllowed,
  sensorPermitted,
  validateSensorMessage,
} from "../sensors/events";
import { derivedObserveDomains, observeTiers } from "../watchlist/store";
import {
  evaluateClickGate,
  evaluateVideoStartGate,
  evaluateGates,
  recordProceed,
  type GateVerdict,
} from "../friction/gate/decide";
import { clickGatesOf, videoStartGatesOf } from "../friction/gate/click";
import { evaluateMomentGate } from "../friction/gate/moment";
import {
  gateMomentFor,
  readReflectRequest,
  readStartRequest,
  reflectionDue,
  type GateSession,
  type StartOffer,
} from "../friction/gate/intention";
import { queryTodayMoments, reflectOnMoment, switchMoment } from "../relay/client";
import { fencesFor, gatesFrom } from "../fence/parse";
import { liveFences } from "../fence/store";
import { blockInfo, usePass } from "../fence/pass";
import { readBlockInfoRequest, readPassRequest } from "../fence/lifts";
import type { Fence, Fences } from "../fence/types";
import {
  decisionPointEvent,
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

/** The switch an intention gate started, until its reflection is asked. */
const gateSession = storage.defineItem<GateSession | null>("local:friction:gateSession", { fallback: null });

/**
 * A firing gate carries the start offer when a moment for this host is planted
 * today. Asked only on a firing, so a quiet poll makes no host round trip.
 */
async function withStartOffer<V extends { readonly fire?: boolean }>(
  verdict: V,
  domain: string
): Promise<V & { start?: StartOffer }> {
  if (verdict.fire !== true) return verdict;
  const offer = gateMomentFor(domain, (await queryTodayMoments()).moments);
  return offer === null ? verdict : { ...verdict, start: offer };
}

const tabMapItem = storage.defineItem<TabMap>("session:activity:tabMap", { fallback: {} });
const focusSinceItem = storage.defineItem<number | null>("session:activity:focusSince", { fallback: null });
const routeByTab = storage.defineItem<Record<number, string | null>>("session:activity:routeByTab", { fallback: {} });

/**
 * Register all attention-event listeners. Must be called synchronously
 * from the background entrypoint so MV3 event-driven wakeups re-attach.
 */
export function startActivityWriter(): WriteFn {
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

  /** Every decision point the verdict reached, delivered or withheld. Written before
   * `intervention_shown`, so the draw precedes what it caused. */
  const writePoints = (verdict: GateVerdict, domain: string): void => {
    for (const point of verdict.points ?? []) {
      void appendEvent(
        decisionPointEvent({ point, domain, id: crypto.randomUUID(), ts: Date.now(), sessionId })
      );
    }
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
    // The tab's domain, never the frame's: an embedded player is credited to
    // the site it is embedded in.
    const domain = senderDomain(sender);

    // Arm handshake: a content script asks whether to observe at all.
    if (isArmQuery(message)) {
      return observeTiers()
        .then(async (tiers) => {
          // The fence cache is consulted here as well as in the poll, or a
          // fence would never gate its page in the first place. One store since
          // migration step 5: the policy mirror's gate list came from
          // `~/.zenborg/keel/rules/*.json`, which is retired.
          const gates = domain === null ? [] : fenceGatesFor(await liveFences(), domain);
          return {
            observed: sensorAllowed(domain, tiers.video),
            deep: sensorAllowed(domain, tiers.deep),
            gate: gates[0] ?? null,
            // Selectors only: the page learns which controls to hold, never a verdict.
            clickGates: clickGatesOf(gates),
            videoStartGates: videoStartGatesOf(gates),
          };
        })
        .catch(() => ({ observed: false, deep: false, gate: null, clickGates: [] }));
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
      // The end of an intention gate's switch, while on its host: this poll
      // asks what it gave instead of gating. Asked once.
      return gateSession
        .getValue()
        .then(async (session) => {
          if (session !== null && reflectionDue(session, domain, Date.now())) {
            await gateSession.setValue({ ...session, asked: true });
            return { fire: false, dwellMs: 0, reflect: { name: session.name } };
          }
          // Every gate on the domain, not the first — see `evaluateGates`. A second
          // rule used to be dropped on the floor here.
          //
          // One list, from one store. Slice E unioned the fence cache with the
          // policy mirror because the two carried different rules from different
          // files; step 5 retired the second file, so the union has nothing left
          // to add. The read is local, so the hot path makes no round trip.
          const verdict =
            (await evaluateMomentGate(domain)) ??
            (await evaluateGates(fenceGatesFor(await liveFences(), domain)));
          // The delivery, recorded here rather than in the page for the same
          // reason the firing is: a content script that could decline to report
          // would earn a free pass by refreshing. `intervention_shown` is a
          // completion in `logs` — there is no second collection.
          writePoints(verdict, domain);
          if (verdict.fire && verdict.ruleId !== undefined) {
            writeDelivery("intervention_shown", {
              domain,
              ruleId: verdict.ruleId,
              primitive: "gate",
              ..."rung" in verdict && verdict.rung !== undefined ? { rung: verdict.rung } : {},
            });
          }
          return withStartOffer(verdict, domain);
        })
        .catch(() => ({ fire: false }));
    }

    // The intention gate's start. The page names a moment and a duration; the
    // background starts it only if it is the one this attested host is offered,
    // and the switch goes through the writer, never a vault write from here.
    const start = readStartRequest(message);
    if (start !== null) {
      if (domain === null) {
        return Promise.resolve({ ok: false });
      }
      return queryTodayMoments()
        .then(async (board) => {
          const offer = gateMomentFor(domain, board.moments);
          if (offer?.momentId !== start.momentId) return { ok: false };
          const ok = await switchMoment(start.momentId, start.minutes);
          if (ok) {
            await gateSession.setValue({
              domain,
              momentId: offer.momentId,
              name: offer.name,
              intention: start.intention,
              until: Date.now() + start.minutes * 60_000,
            });
          }
          return { ok };
        })
        .catch(() => ({ ok: false }));
    }

    // The reflection at the end, or its skip. Only the session asked on this
    // host is answered; a skip stores nothing.
    const reflection = readReflectRequest(message);
    if (reflection !== undefined) {
      void gateSession
        .getValue()
        .then(async (session) => {
          if (session === null || session.asked !== true || session.domain !== domain) return;
          await gateSession.setValue(null);
          if (reflection.text !== null) {
            await reflectOnMoment(session.momentId, reflection.text, session.intention);
          }
        })
        .catch(() => {});
      return;
    }

    // A click on a gated control. Decided and recorded here for the same reason
    // the dwell poll is; the page names a rule, the domain is the attested one,
    // and a rule not in force on that domain answers "no".
    // A video starting is the same shape of question with a different evaluator.
    const clickRule = clickGateQuery(message);
    const videoRule = videoStartGateQuery(message);
    const gateRule = clickRule ?? videoRule;
    const evaluate = clickRule !== null ? evaluateClickGate : evaluateVideoStartGate;
    if (gateRule !== null) {
      if (domain === null) {
        return Promise.resolve({ fire: false });
      }
      return liveFences()
        .then((fences): Promise<GateVerdict> | GateVerdict => {
          const gate = fenceGatesFor(fences, domain).find((g) => g.ruleId === gateRule);
          return gate ? evaluate(gate) : { fire: false, dwellMs: 0 };
        })
        .then((verdict) => {
          writePoints(verdict, domain);
          if (verdict.fire && verdict.ruleId !== undefined) {
            writeDelivery("intervention_shown", {
              domain,
              ruleId: verdict.ruleId,
              primitive: "gate",
              ...(verdict.rung !== undefined ? { rung: verdict.rung } : {}),
            });
          }
          return withStartOffer(verdict, domain);
        })
        .catch(() => ({ fire: false }));
    }

    // How the delivery ended. The page reports which rule and whether the
    // person proceeded; the domain still comes from the browser-attested
    // sender tab, exactly as the sensor channel does.
    if (isSettlement(message)) {
      if (domain !== null) {
        // A crossing is the person proceeding, counted here because the page is
        // untrusted. Only a rule that actually gates this host counts: the page
        // may lie about the id, but not into inflating one that is not in force.
        if (message.proceeded) {
          void liveFences()
            .then((fences) => {
              if (fenceGatesFor(fences, domain).some((g) => g.ruleId === message.ruleId)) {
                return recordProceed(message.ruleId);
              }
            })
            .catch(() => {});
        }
        writeDelivery(settlementKind(message.proceeded), {
          domain,
          ruleId: message.ruleId,
          primitive: "gate",
        });
      }
      return;
    }

    // The block page: what holds on a host, and spending a pass. Only our own
    // block page may ask; the checks and the writes are all on this side.
    const pass = readPassRequest(message);
    const infoHost = readBlockInfoRequest(message);
    if (pass !== null || infoHost !== null) {
      if (!sender.url?.startsWith(browser.runtime.getURL("/block.html"))) return;
      return pass !== null ? usePass(pass.host, pass.reason, write) : blockInfo(infoHost as string);
    }

    const validated = validateSensorMessage(message);
    if (validated === null) {
      return;
    }
    void observeTiers()
      .then(async (tiers) => {
        if (sensorPermitted(validated.kind, domain, tiers)) {
          // The tab uuid lets the read side tell two playing tabs on one domain
          // apart. Browser-attested fields go last so the page cannot override them.
          const tabId = sender.tab?.id;
          const tab = tabId === undefined ? undefined : (await tabMapItem.getValue())[tabId];
          // A close speaks for the tab only if nothing else in it still plays,
          // so ask the frames rather than remember them: a frame that died
          // cannot answer, and so cannot hold the tab.
          const reply: unknown =
            tabId !== undefined && isVideoClose(validated.kind)
              ? await probeWithTimeout(browser.tabs.sendMessage(tabId, PLAYBACK_PROBE))
              : null;
          for (const { kind, payload } of closeWrites(validated, validateSensorMessage(reply))) {
            write(kind, { ...payload, domain, ...(tab ? { tab } : {}) });
          }
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

  return write;
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
