/**
 * Arm the dwell gate in a page.
 *
 * Polls the background rather than counting locally, for two reasons: the page
 * is untrusted (a local counter is a counter the page can reset by reloading),
 * and dwell must come from the same `bouts()` derivation everything else reads,
 * which lives where the log lives.
 *
 * A 30s poll is deliberately coarse. `shouldGate` is written to survive coarse
 * and skipped polls — it compares against the last firing rather than testing a
 * modulo, so a poll that lands late still fires, and one that misses an entire
 * interval still fires once. Cheaper than a push channel, with no correctness
 * cost.
 */

import { clickGateHit, createReplay, type ClickGate } from "./click";
import { safeRedirect, type GateFriction } from "./decide";
import { showGate } from "./overlay";

const POLL_MS = 30_000;

interface GateVerdictMessage {
  readonly fire?: boolean;
  readonly dwellMs?: number;
  /** Which rule fired. Sent back with the settlement so the two join. */
  readonly ruleId?: string;
  readonly friction?: GateFriction;
  readonly proceed?: { label?: string; action?: { type?: string; to?: string } };
  readonly abort?: { label?: string };
  /** @deprecated pre-2026-08-08 background. */
  readonly prompt?: string;
}

/** Start polling. Idempotent per page — a second call is a no-op. */
export function armDwellGate(): void {
  let showing = false;

  const check = async (): Promise<void> => {
    if (showing || document.hidden) {
      return; // Never gate a tab the user is not looking at.
    }
    let verdict: GateVerdictMessage;
    try {
      verdict = ((await browser.runtime.sendMessage({ type: "kairos-gate-check" })) ??
        {}) as GateVerdictMessage;
    } catch {
      return; // Background asleep or reloading — try again next tick.
    }
    if (verdict.fire !== true) {
      return;
    }
    showing = true;
    // Labels and mechanism come from the rule now. The fallbacks are only for a
    // verdict from an older background; they are the same strings the page used to
    // hard-code, which is exactly what made the coercion invisible.
    const proceeded = await showGate({
      friction: verdict.friction ?? {
        type: "intention",
        prompt: verdict.prompt ?? "Is this still what you came for?",
      },
      dwellMinutes: Math.floor((verdict.dwellMs ?? 0) / 60_000),
      proceedLabel: verdict.proceed?.label ?? "Keep watching",
      abortLabel: verdict.abort?.label ?? "Close the tab",
    });
    showing = false;
    // Report how it ended. The background writes the completion — the page is
    // untrusted, so it names the rule and the choice and nothing else; the
    // domain comes from the browser-attested sender tab on the other side.
    //
    // The `intervention_shown` half was already written when the verdict fired,
    // so a page that never gets here leaves a delivery with no settlement,
    // which reads as the abandonment it was rather than as nothing happening.
    if (verdict.ruleId !== undefined) {
      void browser.runtime
        .sendMessage({
          type: "kairos-intervention-settled",
          ruleId: verdict.ruleId,
          proceeded,
        })
        .catch(() => {
          // Background asleep. The shown stands; the settlement is lost, and a
          // settlement invented here would be worse than a missing one.
        });
    }
    // A declared `redirect` now actually reroutes. It used to be parsed, stored, and
    // ignored — every proceed was a `continue`.
    const action = verdict.proceed?.action;
    if (proceeded && action?.type === "redirect" && typeof action.to === "string") {
      // Re-validate at the page even though the host already did. This runs in a
      // content script on every site, so the target reaches `location.assign` with the
      // page in scope — a `javascript:` or `data:` scheme here is script execution, not
      // a reroute. The host check stops a bad rule shipping; this one stops a mirror
      // that was written before the host had the check.
      const target = safeRedirect(action.to);
      if (target !== null) {
        window.location.assign(target);
      }
      return;
    }
    if (proceeded && action?.type === "abort") {
      void browser.runtime.sendMessage({ type: "kairos-gate-leave" }).catch(() => {});
      return;
    }
    if (!proceeded) {
      // The page cannot close a tab it did not open, so ask the background.
      void browser.runtime.sendMessage({ type: "kairos-gate-leave" }).catch(() => {
        // Fall back to leaving the media paused — the gate already did that.
      });
    }
  };

  setInterval(() => void check(), POLL_MS);
  // Also check on return to the tab: a long background stretch accrues no
  // dwell, but coming back is exactly when a stopping cue lands well.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void check();
    }
  });
}

/**
 * Arm the click gates in a page: the gate before a new round starts.
 *
 * One capture-phase listener on `window`, so it runs before any handler the
 * page attached, and it lives as long as the document, which is what makes it
 * survive an SPA's route changes: nothing re-renders `window`. The selectors
 * come from the arm handshake; the background still decides every firing (rung,
 * friction, labels, the delivery draw), exactly as the dwell poll does.
 *
 * On proceed the click is replayed once on the control that was clicked, with a
 * one-shot bypass, so the round starts as the person asked. On abort nothing
 * happens: the click is simply not delivered and the page stays where it was.
 */
export function armClickGate(gates: readonly ClickGate[]): void {
  if (gates.length === 0) return;
  const { bypassing, replay } = createReplay();
  let pending = false;

  const ask = async (ruleId: string, element: Element): Promise<void> => {
    let verdict: GateVerdictMessage;
    try {
      verdict = ((await browser.runtime.sendMessage({ type: "kairos-gate-click", ruleId })) ??
        {}) as GateVerdictMessage;
    } catch {
      // Background asleep or reloading. Fail open: a gate that silently eats the
      // click is a broken button, not a stopping cue.
      verdict = { fire: false };
    }
    let proceeded = true;
    if (verdict.fire === true && verdict.friction !== undefined) {
      proceeded = await showGate({
        friction: verdict.friction,
        dwellMinutes: Math.floor((verdict.dwellMs ?? 0) / 60_000),
        proceedLabel: verdict.proceed?.label ?? "Continue",
        abortLabel: verdict.abort?.label ?? "Not now",
      });
      // Settled exactly as a dwell gate is, so the crossing counts and the ladder climbs.
      if (verdict.ruleId !== undefined) {
        void browser.runtime
          .sendMessage({ type: "kairos-intervention-settled", ruleId: verdict.ruleId, proceeded })
          .catch(() => {});
      }
    }
    if (proceeded && element.isConnected) {
      replay(() =>
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window })
        )
      );
    }
  };

  window.addEventListener(
    "click",
    (event) => {
      if (bypassing()) return;
      const hit = clickGateHit<Element>(event.composedPath(), gates);
      if (hit === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending) return; // A second click while the question is on its way.
      pending = true;
      void ask(hit.ruleId, hit.element).finally(() => {
        pending = false;
      });
    },
    true
  );
}
