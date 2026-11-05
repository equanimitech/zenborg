/**
 * The ration chip: a fixed corner line showing a rationed pool's minutes.
 *
 * Reads extension storage only. Writes nothing, sends nothing, no timer: the
 * background recounts once a minute and `watch` redraws. Quiet by design, the
 * chip never grows or changes colour as the budget fills. It lives in a closed
 * shadow root (as the gate does) so page CSS cannot restyle it.
 */

import { fenceCache, rationSpent } from "@/modules/fence/store";
import { chipLines } from "@/modules/fence/chip";

const STYLE = `
:host { all: initial; }
.chip {
  --ground: oklch(0.985 0.003 60); --ink: oklch(0.444 0.010 60); --rule: oklch(0.869 0.006 60);
  position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
  pointer-events: none; padding: 4px 8px; border: 1px solid var(--rule); border-radius: 2px;
  background: var(--ground); color: var(--ink);
  font: 12px/1.4 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
  .chip { --ground: oklch(0.147 0.005 60); --ink: oklch(0.709 0.008 60); --rule: oklch(0.374 0.010 60); }
}
`;

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  async main() {
    const host = window.location.hostname;
    const el = document.createElement("div");
    el.style.cssText = "all: initial; position: fixed; z-index: 2147483647; pointer-events: none;";
    const root = el.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const chip = document.createElement("div");
    chip.className = "chip";
    root.append(style, chip);

    const place = () => (document.fullscreenElement ?? document.body)?.appendChild(el);

    const render = (lines: string[]) => {
      if (lines.length === 0) return el.remove();
      chip.replaceChildren(
        ...lines.flatMap((l, i) => [...(i ? [document.createElement("br")] : []), document.createTextNode(l)]),
      );
      if (!el.isConnected) place();
    };

    const refresh = async () => {
      try {
        const [fences, spent] = await Promise.all([fenceCache.getValue(), rationSpent.getValue()]);
        render(chipLines(fences, spent, host, Date.now()));
      } catch {
        el.remove(); // No readable state: show nothing rather than a wrong number.
      }
    };

    document.addEventListener("fullscreenchange", () => el.isConnected && place());
    rationSpent.watch(refresh);
    fenceCache.watch(refresh);
    await refresh();
  },
});
