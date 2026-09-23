import { browser } from "wxt/browser";
import { startActivityWriter } from "@/modules/activity/writer";
import { syncFenceRules } from "@/modules/fence/project";
import { cooldownNextLapse, cooldowns } from "@/modules/friction/cooldown/store";
import { armBreak } from "@/modules/friction/cooldown/arm";
import { fenceCache } from "@/modules/fence/store";
import { writeInspection } from "@/modules/fence/inspect";
import { flushToHost } from "@/modules/relay/client";

const COOLDOWN_ALARM = "zenborg-cooldown-lapse";

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
  fenceCache.watch(() => void syncFenceRules());

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
  });
});
