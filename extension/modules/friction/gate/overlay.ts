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
import type { StartOffer } from "./intention";

const HOST_ID = "kairos-gate-host";
const REFLECT_HOST_ID = "kairos-reflect-host";

/** The friction on starting a moment from the gate: one paced breath. */
export const START_FRICTION: GateFriction = { type: "breath", cycles: 1 };

/** What the gardener chose when starting from the gate. */
export interface StartChoice {
  readonly minutes: number;
  readonly intention: string;
}

/** One inhale-exhale, in seconds. Six per minute is the resonant-breathing figure the
 * evidence clusters around; the gate is not a breathing app, it just needs the pace to
 * be a real one rather than a number chosen to look small. */
const BREATH_CYCLE_SECONDS = 10;

export interface GateOptions {
  readonly friction: GateFriction;
  readonly dwellMinutes: number;
  readonly proceedLabel: string;
  readonly abortLabel: string;
  /** A moment planted today for this host: offer to start it, timed. */
  readonly start?: StartOffer & { readonly onStart: (choice: StartChoice) => void };
}

/** Keys typed into our fields must not reach the page's shortcuts (`f`, `k`, space). */
function keepKeys(el: HTMLElement): void {
  for (const type of ["keydown", "keyup", "keypress"]) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}

/**
 * Hold `button` closed for `seconds`, the countdown in its own label. Returns a
 * cancel. Only ever used on a way forward — leaving is never delayed.
 */
function holdButton(button: HTMLButtonElement, label: string, seconds: number): () => void {
  if (seconds <= 0) {
    return () => {};
  }
  let left = seconds;
  button.disabled = true;
  button.textContent = `${label} (${left}s)`;
  const ticker = setInterval(() => {
    left -= 1;
    if (left > 0) {
      button.textContent = `${label} (${left}s)`;
      return;
    }
    clearInterval(ticker);
    button.disabled = false;
    button.textContent = label;
  }, 1000);
  return () => clearInterval(ticker);
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
/* Start: the planted moment, named, timed, one breath away. */
.start { margin-top: 2.618rem; padding-top: 1.618rem; border-top: 1px solid var(--rule); }
.start-lead { font-size: 0.9375rem; color: var(--muted); margin: 0 0 1rem; }
.start .breath { width: 2rem; height: 2rem; margin-bottom: 1rem; }
input {
  font: inherit; font-size: 0.9375rem; width: 100%; box-sizing: border-box;
  padding: 0.625rem 0.75rem; margin: 0 0 1rem; text-align: center;
  background: transparent; color: var(--ink); border: 1px solid var(--rule); border-radius: 2px;
}
input:focus-visible { outline: 2px solid var(--clay); outline-offset: 2px; }
.minutes { display: flex; gap: 0.5rem; justify-content: center; margin: 0 0 1rem; }
.minute { padding: 0.5rem 0.75rem; }
.minute[aria-pressed="true"] { border-color: var(--ink); color: var(--ink); }
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

  // The start offer: name the intention, pick how long, take one breath. More
  // than a click-through on purpose — starting is the deliberate act.
  const offer = options.start;
  let begin: HTMLButtonElement | null = null;
  let intention: HTMLInputElement | null = null;
  let minutes = offer?.minutes[0] ?? 0;
  if (offer !== undefined) {
    const section = document.createElement("div");
    section.className = "start";
    const lead = document.createElement("p");
    lead.className = "start-lead";
    lead.textContent = `${offer.name} is planted for today. Start it?`;
    const pacer = document.createElement("div");
    pacer.className = "breath";
    pacer.style.setProperty("--cycles", "1");
    intention = document.createElement("input");
    intention.type = "text";
    intention.value = offer.name;
    intention.maxLength = 120;
    intention.setAttribute("aria-label", "What is this for?");
    keepKeys(intention);
    const picker = document.createElement("div");
    picker.className = "minutes";
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "How long");
    const choices: HTMLButtonElement[] = [];
    for (const m of offer.minutes) {
      const b = document.createElement("button");
      b.className = "proceed minute";
      b.textContent = `${m} min`;
      b.setAttribute("aria-pressed", String(m === minutes));
      b.addEventListener("click", () => {
        minutes = m;
        for (const c of choices) c.setAttribute("aria-pressed", String(c === b));
      });
      choices.push(b);
    }
    picker.append(...choices);
    begin = document.createElement("button");
    begin.className = "proceed";
    section.append(lead, pacer, intention, picker, begin);
    card.append(section);
  }

  backdrop.append(card);
  root.append(style, backdrop);
  document.documentElement.append(host);

  // Hold the proceed affordance closed for `delay` and `breath`. The countdown is
  // rendered into the button's own label rather than a separate timer, so the thing
  // you are waiting for is the thing you are looking at.
  const holds = [holdButton(proceed, options.proceedLabel, holdSeconds(options.friction))];
  if (offer !== undefined && begin !== null) {
    const label = `Start ${offer.name}`;
    begin.textContent = label;
    holds.push(holdButton(begin, label, holdSeconds(START_FRICTION)));
  }

  // Focus the *abort* affordance: the default action should be the one you'd
  // choose with a clear head, not the one momentum wants. It is also the only
  // affordance that is ever live immediately — leaving is never delayed.
  abort.focus();

  return new Promise<boolean>((resolve) => {
    const close = (proceeded: boolean): void => {
      for (const cancel of holds) cancel();
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
    begin?.addEventListener("click", () => {
      const said = intention?.value.trim() ?? "";
      if (offer === undefined || said === "") {
        intention?.focus(); // Naming it is the point; an empty intention starts nothing.
        return;
      }
      offer.onStart({ minutes, intention: said });
      close(true);
    });
  });
}

const REFLECT_STYLE = `
:host { all: initial; }
.note {
  --ground: oklch(0.985 0.003 60); --ink: oklch(0.216 0.007 60);
  --muted: oklch(0.444 0.010 60); --rule: oklch(0.869 0.006 60); --clay: oklch(0.62 0.100 60);
  position: fixed; right: 1rem; bottom: 1rem; z-index: 2147483647; width: min(22rem, calc(100vw - 2rem));
  box-sizing: border-box; padding: 1rem; background: var(--ground); color: var(--ink);
  border: 1px solid var(--rule); border-radius: 2px;
  font-family: Inter, system-ui, -apple-system, sans-serif; font-size: 0.9375rem;
}
@media (prefers-color-scheme: dark) {
  .note { --ground: oklch(0.147 0.005 60); --ink: oklch(0.985 0.003 60);
    --muted: oklch(0.709 0.008 60); --rule: oklch(0.374 0.010 60); }
}
p { margin: 0 0 0.75rem; }
input {
  font: inherit; width: 100%; box-sizing: border-box; padding: 0.5rem 0.625rem; margin: 0 0 0.75rem;
  background: transparent; color: var(--ink); border: 1px solid var(--rule); border-radius: 2px;
}
.row { display: flex; gap: 0.5rem; justify-content: flex-end; }
button {
  font: inherit; font-size: 0.875rem; padding: 0.375rem 0.75rem; border-radius: 2px; cursor: pointer;
  background: transparent; color: var(--muted); border: 1px solid var(--rule);
}
button:hover { color: var(--ink); border-color: var(--ink); }
input:focus-visible, button:focus-visible { outline: 2px solid var(--clay); outline-offset: 2px; }
`;

/**
 * The end of a gate's timed switch: one quiet line in the corner of the page,
 * not a notification and not a wall. Resolves with what was written, or `null`
 * for a skip. Nothing is paused and nothing is in the way.
 */
export function showReflection(name: string): Promise<string | null> {
  if (document.getElementById(REFLECT_HOST_ID) !== null) {
    return Promise.resolve(null);
  }
  const host = document.createElement("div");
  host.id = REFLECT_HOST_ID;
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = REFLECT_STYLE;
  const note = document.createElement("div");
  note.className = "note";
  note.setAttribute("role", "region");
  note.setAttribute("aria-label", "Reflection");
  const line = document.createElement("p");
  line.textContent = `${name} is done. What did it give you?`;
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 500;
  input.setAttribute("aria-label", `What did ${name} give you?`);
  keepKeys(input);
  const row = document.createElement("div");
  row.className = "row";
  const skip = document.createElement("button");
  skip.textContent = "Skip";
  const keep = document.createElement("button");
  keep.textContent = "Keep";
  row.append(skip, keep);
  note.append(line, input, row);
  root.append(style, note);
  document.documentElement.append(host);

  return new Promise((resolve) => {
    const close = (text: string | null): void => {
      host.remove();
      resolve(text);
    };
    keep.addEventListener("click", () => close(input.value.trim() || null));
    skip.addEventListener("click", () => close(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value.trim() || null);
      if (e.key === "Escape") close(null);
    });
  });
}
