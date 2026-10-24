import { browser } from "wxt/browser";
import { startActivityWriter } from "@/modules/activity/writer";
import { syncFenceRules } from "@/modules/fence/project";
import { cooldownNextLapse, cooldowns } from "@/modules/friction/cooldown/store";
import { armBreak } from "@/modules/friction/cooldown/arm";
import { fenceCache } from "@/modules/fence/store";
import { nextScheduleBoundary } from "@/modules/fence/parse";
import { writeInspection } from "@/modules/fence/inspect";
import { flushToHost } from "@/modules/relay/client";

const COOLDOWN_ALARM = "zenborg-cooldown-lapse";
const SCHEDULE_ALARM = "zenborg-schedule-edge";

/**
 * Re-project DNR when the soonest cooldown lapses.
 *
 * One-shot alarm at the lapse instant rather than a poll. `chrome.alarms`
 * survives service-worker death, and startup re-arms it regardless, so a
 * missed fire self-heals — it can leave a cooldown holding slightly too long,
 * never lift one early.
 */
async function scheduleCooldownLapse(): Promise<void> {
  const next = await cooldownNextLapse();
  await browser.alarms.clear(COOLDOWN_ALARM);
  if (next !== null) {
    browser.alarms.create(COOLDOWN_ALARM, { when: next });
  }
}

/**
 * Re-project DNR at the next watering-hours window edge.
 *
 * A scheduled fence turns on or off with the clock, not with any storage
 * change, so nothing else would re-run the projection. Same shape as the
 * cooldown lapse: one one-shot alarm at the soonest edge, re-armed on fire,
 * on startup and whenever the fence cache changes.
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
 * - Cooldown: the `cooldown` primitive in flight (primitive-contracts.md
 *   §Contract 3). Self-invoked only — a tide can never arm one, which is
 *   enforced in the type system (`AmbientRule` has no slot for it).
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

  // Any cooldown change re-projects the rules and re-arms the lapse alarm.
  void scheduleCooldownLapse();
  cooldowns.watch(() => {
    void syncFenceRules();
    void scheduleCooldownLapse();
    void writeInspection();
  });

  // Keyboard path to the lock — reachable without opening the popup, because
  // the reach for help must cost less than the reach for the temptation.
  browser.commands?.onCommand.addListener((command) => {
    if (command === "cooldown") {
      void armBreak("keyboard");
    }
  });

  // Flush buffered events to the native host on cold start and on a periodic
  // alarm (eventual-consistency; no daemon, no open port).
  void flushToHost();
  browser.alarms.create("zenborg-relay-flush", { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "zenborg-relay-flush") {
      void flushToHost();
    }
    if (alarm.name === COOLDOWN_ALARM) {
      // Re-projection drops the lapsed rule; the sites come back on their own.
      void syncFenceRules();
      void scheduleCooldownLapse();
    }
    if (alarm.name === SCHEDULE_ALARM) {
      void syncFenceRules();
      void scheduleWindowEdge();
    }
  });
});
