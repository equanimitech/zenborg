/**
 * The sensor — ONE content script for every page, type-based.
 *
 * On load it asks the background whether this domain is on the
 * watchlist's observe tier (the arm handshake). If not, it does
 * NOTHING — no observers, no listeners. If observed, it arms the
 * generic senses (video, feed, shopping — they self-select by what the
 * page exhibits) plus the game sense where a site adapter exists.
 *
 * It runs in every frame, because embedded players live in iframes. The
 * background credits a subframe's events to the TAB's domain (the browser
 * attests `sender.tab.url`), never the iframe's host, and reads players in
 * several frames as one (`closeWrites`). Subframes arm the video sense only:
 * the feed, shopping and game senses and the gates read the page itself, so
 * they stay in the top frame, as before.
 *
 * The reply says how far to arm: `observed` arms the video sense, `deep` the
 * rest. A host mapped to an area is observed but not deep.
 *
 * No company names here: domains are user-authored watchlist entries;
 * site-specific probes are data in modules/sensors/adapters.ts.
 */

import { siteAdapterFor } from "@/modules/sensors/adapters";
import { armFeedSense } from "@/modules/sensors/senses/feed";
import { armGameSense } from "@/modules/sensors/senses/game";
import { armShoppingSense } from "@/modules/sensors/senses/shopping";
import { armVideoSense } from "@/modules/sensors/senses/video";
import { armClickGate, armDwellGate, armVideoStartGate } from "@/modules/friction/gate/arm";
import type { ClickGate } from "@/modules/friction/gate/click";

/** The arm reply's click gates, reduced to well-formed entries. */
function readClickGates(raw: unknown): readonly ClickGate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((g: unknown) => {
    const r = (g ?? {}) as Record<string, unknown>;
    const selectors = Array.isArray(r.selectors)
      ? r.selectors.filter((s): s is string => typeof s === "string" && s !== "")
      : [];
    return typeof r.ruleId === "string" && selectors.length > 0
      ? [{ ruleId: r.ruleId, selectors }]
      : [];
  });
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  matchAboutBlank: true,
  async main() {
    const top = window === window.top;
    let observed = false;
    let deep = false;
    let gated = false;
    let clickGates: readonly ClickGate[] = [];
    let videoStartGates: readonly string[] = [];
    try {
      const answer: unknown = await browser.runtime.sendMessage({
        type: "kairos-sensor-arm",
      });
      const reply = (answer ?? {}) as Record<string, unknown>;
      observed = reply.observed === true;
      deep = reply.deep === true;
      gated = reply.gate !== null && reply.gate !== undefined;
      clickGates = readClickGates(reply.clickGates);
      videoStartGates = Array.isArray(reply.videoStartGates)
        ? reply.videoStartGates.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return; // Background unavailable — stay dormant, fail-open.
    }

    // The gate is independent of the observe tier: a domain can be gated
    // without being deep-sensed, and the dwell it reads comes from the coarse
    // writer events every domain produces.
    if (top) {
      if (gated) {
        armDwellGate();
      }
      armClickGate(clickGates);
      armVideoStartGate(videoStartGates);
    }

    if (!observed) {
      return;
    }

    armVideoSense();
    if (!top || !deep) {
      return;
    }
    armFeedSense();
    armShoppingSense();

    const adapter = siteAdapterFor(window.location.hostname.replace(/^www\./, ""));
    if (adapter !== null) {
      armGameSense(adapter);
    }
  },
});
