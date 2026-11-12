import { describe, expect, it } from "vitest";
import { isAdPlaying, videoKey, type LocationLike } from "./videoKey";

const yt = (pathname: string, search = ""): LocationLike => ({
  href: `https://www.youtube.com${pathname}${search}`,
  hostname: "www.youtube.com",
  pathname,
  search,
});
const video = { currentSrc: "blob:https://www.youtube.com/abc" };

/** The page's asking rule, as `armVideoStartGate` applies it. */
function asks(events: readonly { loc: LocationLike; ad?: boolean }[]): number {
  const asked = new Set<string>();
  let n = 0;
  for (const { loc, ad } of events) {
    if (isAdPlaying({ querySelector: () => (ad ? {} : null) })) continue;
    const key = videoKey(loc, video);
    if (asked.has(key)) continue;
    asked.add(key);
    n += 1;
  }
  return n;
}

describe("videoKey", () => {
  it("names a watch page by its v param", () => {
    expect(videoKey(yt("/watch", "?v=abc&t=5"), video)).toBe("yt:watch:abc");
  });
  it("names a short by its id", () => {
    expect(videoKey(yt("/shorts/xyz123"), video)).toBe("yt:shorts:xyz123");
  });
  it("falls back to currentSrc, then href, off YouTube", () => {
    const loc = { href: "https://a.com/p", hostname: "a.com", pathname: "/p", search: "" };
    expect(videoKey(loc, { currentSrc: "https://a.com/v.mp4" })).toBe("https://a.com/v.mp4");
    expect(videoKey(loc, { currentSrc: "" })).toBe("https://a.com/p");
  });
});

describe("asking per video on one reused element", () => {
  it("two different v params ask twice", () => {
    expect(asks([{ loc: yt("/watch", "?v=a") }, { loc: yt("/watch", "?v=b") }])).toBe(2);
  });
  it("the same v param twice (resume) asks once", () => {
    expect(asks([{ loc: yt("/watch", "?v=a") }, { loc: yt("/watch", "?v=a") }])).toBe(1);
  });
  it("shorts swipes ask per id", () => {
    expect(asks([{ loc: yt("/shorts/1") }, { loc: yt("/shorts/2") }, { loc: yt("/shorts/2") }])).toBe(2);
  });
  it("an ad asks nothing and does not consume the key", () => {
    const loc = yt("/watch", "?v=a");
    expect(asks([{ loc, ad: true }, { loc, ad: true }])).toBe(0);
    expect(asks([{ loc, ad: true }, { loc }])).toBe(1);
  });
});
