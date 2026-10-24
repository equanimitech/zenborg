/**
 * The gate surface — an in-page interstitial.
 *
 * Rendered in a closed shadow root so page CSS cannot restyle it and page JS
 * cannot query it away. It is an overlay rather than a DNR redirect because
 * DNR's `redirect` action requires host permissions, and zenborg ships none —
 * that absence is the structural guarantee it cannot read your browsing
 * (see drogues/blocklist/sync.ts).
 *
 * Media is paused while the gate is up. Without that, an interstitial over a
 * playing video is decorative: the audio continues, the watch continues, and
 * the only thing interrupted is your view of it. Pausing is what makes it a
 * stopping cue rather than a notification.
 */

import type { GateFriction } from "./decide";

const HOST_ID = "kairos-gate-host";

/** One inhale-exhale, in seconds. Six per minute is the resonant-breathing figure the
 * evidence clusters around; the gate is not a breathing app, it just needs the pace to
 * be a real one rather than a number chosen to look small. */
const BREATH_CYCLE_SECONDS = 10;

export interface GateOptions {
  readonly friction: GateFriction;
  readonly dwellMinutes: number;
  readonly proceedLabel: string;
  readonly abortLabel: string;
}

/** What the card says. Pure. */
export function gatePrompt(friction: GateFriction): string {
  switch (friction.type) {
    case "intention":
      return friction.prompt;
    case "confirmation":
      return "Continue?";
    case "delay":
      return "A beat, then it's yours.";
    case "breath":
      return friction.cycles === 1 ? "One breath." : `${friction.cycles} breaths.`;
  }
}

/**
 * How long the PROCEED affordance stays closed. Pure.
 *
 * Only continuing is ever delayed. Leaving is live from the first frame — a delay on
 * the exit is punishment, and punishment both fails on the evidence (Mark 2018) and
 * teaches the person to route around the tool.
 */
export function holdSeconds(friction: GateFriction): number {
  if (friction.type === "delay") {
    return Math.max(0, Math.round(friction.seconds));
  }
  if (friction.type === "breath") {
    return Math.max(0, Math.round(friction.cycles * BREATH_CYCLE_SECONDS));
  }
  return 0;
}

/** Pause every playing media element; returns the ones actually paused. */
function pauseMedia(): readonly HTMLMediaElement[] {
  const paused: HTMLMediaElement[] = [];
  for (const el of document.querySelectorAll("video, audio")) {
    const media = el as HTMLMediaElement;
    if (!media.paused) {
      media.pause();
      paused.push(media);
    }
  }
  return paused;
}

const STYLE = `
:host { all: initial; }
.backdrop {
  --stone-50: oklch(0.985 0.003 60); --stone-100: oklch(0.97 0.004 60);
  --stone-200: oklch(0.923 0.005 60); --stone-300: oklch(0.869 0.006 60);
  --stone-400: oklch(0.709 0.008 60); --stone-600: oklch(0.444 0.010 60);
  --stone-700: oklch(0.374 0.010 60); --stone-800: oklch(0.268 0.007 60);
  --stone-900: oklch(0.216 0.007 60); --stone-950: oklch(0.147 0.005 60);
  --clay: oklch(0.62 0.100 60);
  --ground: var(--stone-50); --ink: var(--stone-900);
  --muted: var(--stone-600); --rule: var(--stone-300);
  --faint: var(--stone-400); --abort-hover: var(--stone-700);
  position: fixed; inset: 0; z-index: 2147483647;
  background: var(--ground); color: var(--ink);
  display: flex; align-items: center; justify-content: center;
  font-family: Inter, system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .backdrop {
    --ground: var(--stone-950); --ink: var(--stone-50);
    --muted: var(--stone-400); --rule: var(--stone-700);
    --faint: var(--stone-600); --abort-hover: var(--stone-200);
  }
}
::selection { background: color-mix(in oklch, var(--clay) 30%, transparent); }
.card { max-width: 30rem; padding: 2.5rem; text-align: center; }
.dwell {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase;
  font-variant-numeric: tabular-nums; color: var(--muted); margin: 0 0 1.618rem;
}
.prompt {
  font-size: 1.618rem; line-height: 1.3; font-weight: 500;
  letter-spacing: -0.012em; text-wrap: balance; max-width: 30ch;
  margin: 0 auto 2.618rem;
}
.actions { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
button {
  font: inherit; font-size: 0.9375rem; font-variant-numeric: tabular-nums;
  padding: 0.75rem 1.25rem; border-radius: 2px; cursor: pointer;
  border: 1px solid transparent;
}
button:focus:not(:focus-visible) { outline: none; }
button:focus-visible { outline: 2px solid var(--clay); outline-offset: 3px; }
.abort { background: var(--ink); border-color: var(--ink); color: var(--ground); }
.abort:hover { background: var(--abort-hover); border-color: var(--abort-hover); }
.proceed { background: transparent; border-color: var(--rule); color: var(--muted); }
.proceed:hover { border-color: var(--ink); color: var(--ink); }
.proceed[disabled], .proceed[disabled]:hover {
  color: var(--faint); border-color: var(--rule); cursor: default;
}
/* Breath only. A delay is a wait; a breath is a pace, and the pace has to be visible
   or the person is just staring at a number. It runs --cycles times, then rests. */
.breath {
  width: 3.5rem; height: 3.5rem; margin: 0 auto 1.618rem; border-radius: 50%;
  background: var(--ink); opacity: 0.16; transform: scale(0.8);
}
@keyframes breathe {
  0%, 100% { transform: scale(0.55); }
  40%, 60% { transform: scale(1); }
}
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: no-preference) {
  .backdrop { animation: fade 220ms cubic-bezier(.4,0,.2,1); }
  button { transition: background-color 150ms cubic-bezier(.4,0,.2,1), border-color 150ms cubic-bezier(.4,0,.2,1), color 150ms cubic-bezier(.4,0,.2,1); }
  .breath {
    animation: breathe 10s ease-in-out forwards;
    animation-iteration-count: var(--cycles, 1);
  }
}
`;

/**
 * Show the gate. Resolves when the user chooses: `true` to proceed, `false` to
 * leave. There is no third outcome — no Escape key, no backdrop click, no
 * timeout. A gate you can dismiss without deciding is one you learn to swat.
 */
export function showGate(options: GateOptions): Promise<boolean> {
  const existing = document.getElementById(HOST_ID);
  if (existing !== null) {
    return Promise.resolve(true); // Already up; never stack.
  }

  const paused = pauseMedia();
  const host = document.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = STYLE;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const card = document.createElement("div");
  card.className = "card";

  const dwell = document.createElement("p");
  dwell.className = "dwell";
  dwell.textContent = `${options.dwellMinutes} minutes here today`;

  if (options.friction.type === "breath") {
    const pacer = document.createElement("div");
    pacer.className = "breath";
    pacer.style.setProperty("--cycles", String(options.friction.cycles));
    card.append(pacer);
  }

  const prompt = document.createElement("p");
  prompt.className = "prompt";
  prompt.textContent = gatePrompt(options.friction);

  const actions = document.createElement("div");
  actions.className = "actions";

  const proceed = document.createElement("button");
  proceed.className = "proceed";
  proceed.textContent = options.proceedLabel;

  const abort = document.createElement("button");
  abort.className = "abort";
  abort.textContent = options.abortLabel;

  actions.append(proceed, abort);
  card.insertBefore(dwell, card.firstChild);
  card.append(prompt, actions);
  backdrop.append(card);
  root.append(style, backdrop);
  document.documentElement.append(host);

  // Hold the proceed affordance closed for `delay` and `breath`. The countdown is
  // rendered into the button's own label rather than a separate timer, so the thing
  // you are waiting for is the thing you are looking at.
  const hold = holdSeconds(options.friction);
  let ticker: ReturnType<typeof setInterval> | undefined;
  if (hold > 0) {
    let left = hold;
    proceed.disabled = true;
    proceed.textContent = `${options.proceedLabel} (${left}s)`;
    ticker = setInterval(() => {
      left -= 1;
      if (left > 0) {
        proceed.textContent = `${options.proceedLabel} (${left}s)`;
        return;
      }
      clearInterval(ticker);
      ticker = undefined;
      proceed.disabled = false;
      proceed.textContent = options.proceedLabel;
    }, 1000);
  }

  // Focus the *abort* affordance: the default action should be the one you'd
  // choose with a clear head, not the one momentum wants. It is also the only
  // affordance that is ever live immediately — leaving is never delayed.
  abort.focus();

  return new Promise<boolean>((resolve) => {
    const close = (proceeded: boolean): void => {
      if (ticker !== undefined) {
        clearInterval(ticker);
      }
      host.remove();
      if (proceeded) {
        for (const media of paused) {
          void media.play().catch(() => {
            // Autoplay policy refused the resume — leave it paused.
          });
        }
      }
      resolve(proceeded);
    };
    proceed.addEventListener("click", () => close(true));
    abort.addEventListener("click", () => close(false));
  });
}
