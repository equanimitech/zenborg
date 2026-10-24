import { describe, expect, it } from "vitest";
import { clickGateHit, clickGatesOf, createReplay, type ClickGate } from "./click";
import type { DwellGate } from "./decide";

/** A stand-in element: matches exactly the selectors it is given. */
const el = (name: string, ...selectors: string[]) => ({
  name,
  matches: (s: string) => {
    if (s === "::bad") throw new SyntaxError("invalid selector");
    return selectors.includes(s);
  },
});

const gates: readonly ClickGate[] = [
  {
    ruleId: "chess-ladder",
    selectors: ["button.bot-selection-cta-button-button", ".quick-analysis-wrapper-splitRow button"],
  },
];

describe("clickGateHit — does this element path match an active click gate?", () => {
  it("matches the target itself", () => {
    const play = el("play", "button.bot-selection-cta-button-button");
    expect(clickGateHit([play, el("body"), {}], gates)).toEqual({ ruleId: "chess-ladder", element: play });
  });

  it("matches an ancestor of the target, and returns the ancestor to replay on", () => {
    const rematch = el("rematch", ".quick-analysis-wrapper-splitRow button");
    const span = el("label span");
    expect(clickGateHit([span, rematch, el("row")], gates)?.element).toBe(rematch);
  });

  it("leaves a board move, resign and navigation alone", () => {
    const piece = el("piece");
    const board = el("wc-chess-board");
    const resign = el("resign", 'button[aria-label="Resign"]');
    const link = el("nav link");
    expect(clickGateHit([piece, board, el("main")], gates)).toBeNull();
    expect(clickGateHit([resign], gates)).toBeNull();
    expect(clickGateHit([link], gates)).toBeNull();
  });

  it("skips non-elements in a composed path (window, document fragments)", () => {
    expect(clickGateHit([null, undefined, 3, {}, { matches: "no" }], gates)).toBeNull();
  });

  it("an invalid selector never throws into the page's click", () => {
    const bad: readonly ClickGate[] = [{ ruleId: "r", selectors: ["::bad", ".ok"] }];
    expect(clickGateHit([el("x", ".ok")], bad)?.ruleId).toBe("r");
    expect(clickGateHit([el("y")], bad)).toBeNull();
  });

  it("no gates, no hit", () => {
    expect(clickGateHit([el("play", "button.bot-selection-cta-button-button")], [])).toBeNull();
  });
});

describe("clickGatesOf", () => {
  const base: DwellGate = {
    ruleId: "g",
    domains: ["chess.com"],
    everyMinutes: 1,
    friction: { type: "confirmation" },
    proceed: { label: "Go", action: { type: "continue" } },
    abort: { label: "Stop" },
  };

  it("unions the selectors of every rung, and skips dwell gates", () => {
    const rung = (click?: readonly string[]) => ({
      everyMinutes: 1,
      friction: { type: "confirmation" } as const,
      click,
      proceed: base.proceed,
      abort: base.abort,
    });
    const out = clickGatesOf([
      { ...base, click: [".a"], rungs: [rung([".a"]), rung([".b", ".a"])] },
      { ...base, ruleId: "dwell" },
    ]);
    expect(out).toEqual([{ ruleId: "g", selectors: [".a", ".b"] }]);
  });
});

describe("createReplay — the bypass is one-shot", () => {
  it("lets exactly the replayed dispatch through, then gates again", () => {
    const { bypassing, replay } = createReplay();
    const seen: boolean[] = [];
    const listener = () => seen.push(bypassing());
    listener(); // the person's click: gated
    replay(listener); // the replay: through
    listener(); // the next click, even on the same control: gated again
    expect(seen).toEqual([false, true, false]);
  });

  it("drops the bypass even when the replayed handler throws", () => {
    const { bypassing, replay } = createReplay();
    expect(() =>
      replay(() => {
        throw new Error("page handler");
      })
    ).toThrow();
    expect(bypassing()).toBe(false);
  });
});
