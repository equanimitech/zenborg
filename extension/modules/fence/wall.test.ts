import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withLifts } from "./lifts";
import { parseFences } from "./parse";
import { shouldWall } from "./wall";

const NOW = new Date(2026, 9, 24, 17).getTime();
const block = (host: string) => ({
  id: `watering:afternoon-only:browser:${host}`,
  scope: { surface: "browser", domain: host },
  primitives: [
    {
      kind: "schedule",
      window: { fromHour: 16, toHour: 13 },
      outsideWindow: "inactive",
      wraps: {
        kind: "cooldown",
        duration: { type: "standing" },
        unlockPath: { type: "out_of_band", note: "Open 13h to 16h." },
        enforcement: { at: "browser", reach: "navigation" },
      },
    },
  ],
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const fences = parseFences({ y: block("youtube.com") }, NOW)!.fences;

describe("shouldWall", () => {
  it("walls a blocked host and its subdomain; not a lifted, unfenced or non-http one", () => {
    expect(shouldWall("https://www.youtube.com/watch?v=1", fences)?.host).toBe("youtube.com");
    expect(shouldWall("https://m.youtube.com/", fences)).not.toBeNull();
    const lifted = withLifts(fences, [{ hosts: ["youtube.com"], from: NOW - 1, until: NOW + 1000 }], NOW);
    expect(shouldWall("https://youtube.com/", lifted)).toBeNull();
    expect(shouldWall("https://example.com/", fences)).toBeNull();
    expect(shouldWall("chrome-extension://abc/block.html?host=youtube.com", fences)).toBeNull();
    expect(shouldWall("chrome-error://chromewebdata/", fences)).toBeNull();
  });
});
