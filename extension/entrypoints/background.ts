import { browser } from "wxt/browser";
import { startActivityWriter } from "@/modules/activity/writer";
import { syncFenceRules } from "@/modules/fence/project";
import { fenceCache } from "@/modules/fence/store";
import { nextScheduleBoundary } from "@/modules/fence/parse";
import { flushToHost } from "@/modules/relay/client";

const SCHEDULE_ALARM = "zenborg-schedule-edge";

/**
 * Re-project DNR at the next watering-hours window edge.
 *
 * A scheduled fence turns on or off with the clock, not with any storage
 * change, so nothing else would re-run the projection. One one-shot alarm at
 * the soonest edge, re-armed on fire, on startup and whenever the fence cache
 * changes.
 */
async function scheduleWindowEdge(): Promise<void> {
  const next = nextScheduleBoundary(await fenceCache.getValue());
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
  startActivityWriter();

  // The fence cache is the source of truth for what is blocked — the `fences`
  // collection, pushed by the native host. Project it onto DNR dynamic rules on
  // startup and re-project the moment it changes rather than waiting for the
  // next flush: a fence declared in conversation should hold on the next
  // navigation, not five minutes later.
  //
  // There used to be a second watcher here, on the policy mirror's standing
  // list. Migration step 5 retired that store, so one watcher covers it.
  void syncFenceRules();
  void scheduleWindowEdge();
  fenceCache.watch(() => {
    void syncFenceRules();
    void scheduleWindowEdge();
  });

  // Flush buffered events to the native host on cold start and on a periodic
  // alarm (eventual-consistency; no daemon, no open port).
  void flushToHost();
  browser.alarms.create("zenborg-relay-flush", { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "zenborg-relay-flush") {
      void flushToHost();
    }
    if (alarm.name === SCHEDULE_ALARM) {
      void syncFenceRules();
      void scheduleWindowEdge();
    }
  });
});
