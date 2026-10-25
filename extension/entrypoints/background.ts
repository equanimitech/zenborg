import { browser } from "wxt/browser";
import { startActivityWriter } from "@/modules/activity/writer";
import { syncFenceRules } from "@/modules/fence/project";
import { allLifts, fenceCache, liveFences, openingsCache, passLifts, rationSpent } from "@/modules/fence/store";
import { hasOpenRation, localDay, poolMinutes } from "@/modules/fence/ration";
import { mergeById } from "@/modules/fence/deliveries";
import { readEventsSince } from "@/modules/activity/log";
import { nextScheduleBoundary } from "@/modules/fence/parse";
import { BLOCK_HIT_KIND, blockHitPayload, nextLiftEdge } from "@/modules/fence/lifts";
import { blockingFences, settleLifts } from "@/modules/fence/pass";
import { domainFromUrl, startOfLocalDay } from "@/modules/activity/events";
import { flushToHost, queryEvents } from "@/modules/relay/client";

const SCHEDULE_ALARM = "zenborg-schedule-edge";
const RATION_ALARM = "zenborg-ration";

/**
 * Recount rationed pools once a minute while any rationed window is open.
 * Today's events are the host's copy merged with the outbox, since the relay
 * deletes what the host has acked (the same merge `fence/pass.ts` does).
 */
async function recountRations(): Promise<void> {
  const fences = await fenceCache.getValue();
  const now = Date.now();
  if (!hasOpenRation(fences, new Date(now))) {
    await browser.alarms.clear(RATION_ALARM);
    return;
  }
  if (!(await browser.alarms.get(RATION_ALARM))) {
    browser.alarms.create(RATION_ALARM, { periodInMinutes: 1 });
  }
  try {
    const since = startOfLocalDay(now);
    // ponytail: re-reads the whole day from the host every minute; cache the host slice if it shows up in profiles
    const [host, outbox] = await Promise.all([queryEvents(since), readEventsSince(since)]);
    const minutes = poolMinutes(mergeById(host, outbox), fences, now);
    const prev = await rationSpent.getValue();
    const next = { day: localDay(now), minutes };
    if (JSON.stringify(prev) !== JSON.stringify(next)) await rationSpent.setValue(next);
  } catch (err) {
    // Fail open: the last count stands (or none), so nothing new walls on a failed read.
    console.error("[zenborg ration] recount failed:", err);
  }
}

/**
 * Re-project DNR at the next watering-hours window edge.
 *
 * A scheduled fence turns on or off with the clock, not with any storage
 * change, so nothing else would re-run the projection. One one-shot alarm at
 * the soonest edge, re-armed on fire, on startup and whenever the fence cache
 * changes.
 */
async function scheduleWindowEdge(): Promise<void> {
  // Lift edges ride the same alarm: a pass or an opening starting or ending
  // is the same event for DNR as a window edge.
  const now = Date.now();
  const edges = [nextScheduleBoundary(await fenceCache.getValue()), nextLiftEdge(await allLifts(), now)];
  const due = edges.filter((t): t is number => t !== null);
  const next = due.length === 0 ? null : Math.min(...due);
  await browser.alarms.clear(SCHEDULE_ALARM);
  if (next !== null) {
    browser.alarms.create(SCHEDULE_ALARM, { when: next });
  }
}

/**
 * Background service worker — the activity writer plus the friction interpreter.
 *
 * - Activity writer: coarse events for every domain (tab switches,
 *   navigations, focus/idle spans) + deep sensor events for watchlist
 *   observe-tier domains. See docs/event-taxonomy.md.
 * - Blocklist drogue: explicitly-consented precommitment (DNR rules).
 */
export default defineBackground(() => {
  // Registered synchronously so MV3 event wakeups re-attach listeners.
  const write = startActivityWriter();

  // The fence cache is the source of truth for what is blocked — the `fences`
  // collection, pushed by the native host. Project it onto DNR dynamic rules on
  // startup and re-project the moment it changes rather than waiting for the
  // next flush: a fence declared in conversation should hold on the next
  // navigation, not five minutes later.
  //
  // There used to be a second watcher here, on the policy mirror's standing
  // list. Migration step 5 retired that store, so one watcher covers it.
  const resync = (): void => {
    void syncFenceRules();
    void scheduleWindowEdge();
    void settleLifts(write);
    void recountRations();
  };
  resync();
  fenceCache.watch(resync);
  openingsCache.watch(resync);
  passLifts.watch(resync);
  rationSpent.watch(() => {
    void syncFenceRules();
  });

  // A DNR `block` leaves the browser's own error page, where nothing of ours can
  // run. A blocked top-level load is sent to the block page instead, which shows
  // the unlock note and, on a time block, the pass. Domains only on the way: the
  // URL stays in the tab's own address so a pass can return to it.
  browser.webNavigation.onErrorOccurred.addListener((nav) => {
    // Chrome carries `error`; the shim's types (Firefox-shaped) do not declare it.
    const error = (nav as { error?: string }).error ?? "";
    if (nav.frameId !== 0 || !error.includes("ERR_BLOCKED_BY_CLIENT")) return;
    const host = domainFromUrl(nav.url);
    if (host === null) return;
    void liveFences().then((fences) => {
      const blocking = blockingFences(fences, host);
      if (blocking.length === 0) return;
      write(BLOCK_HIT_KIND, blockHitPayload(host, blocking));
      const page = browser.runtime.getURL("/block.html");
      const query = new URLSearchParams({ host, u: nav.url });
      return browser.tabs.update(nav.tabId, { url: `${page}?${query}` });
    });
  });

  // Flush buffered events to the native host on cold start and on a periodic
  // alarm (eventual-consistency; no daemon, no open port).
  void flushToHost();
  browser.alarms.create("zenborg-relay-flush", { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "zenborg-relay-flush") {
      void flushToHost();
    }
    if (alarm.name === SCHEDULE_ALARM) resync();
    if (alarm.name === RATION_ALARM) void recountRations();
  });
});
