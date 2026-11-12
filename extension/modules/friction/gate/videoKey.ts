/**
 * Video identity for the video-start gate: pure.
 *
 * YouTube reuses ONE <video> element across watch navigations, ads and Shorts
 * swipes (checked on the live page), so the element is not a video. A video is
 * what the location names; other hosts fall back to the media source.
 */

/** The part of `Location` the key reads. */
export interface LocationLike {
  readonly href: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly search: string;
}

/** The part of a media element the key reads. */
export interface VideoLike {
  readonly currentSrc: string;
}

/** A stable string for the video playing now; equal keys mean the same video. */
export function videoKey(loc: LocationLike, video: VideoLike): string {
  if (/(^|\.)youtube\.com$/.test(loc.hostname)) {
    const shorts = /^\/shorts\/([^/?#]+)/.exec(loc.pathname);
    if (shorts) return `yt:shorts:${shorts[1]}`;
    const v = new URLSearchParams(loc.search).get("v");
    if (loc.pathname === "/watch" && v) return `yt:watch:${v}`;
  }
  return video.currentSrc || loc.href;
}

/** The part of `Document` the ad check reads. */
export interface DocLike {
  querySelector(selector: string): unknown;
}

/** Is an ad playing right now? Read at event time, never cached: the flag can
 * still be up at the content's first `playing`. */
export function isAdPlaying(doc: DocLike): boolean {
  return doc.querySelector(".html5-video-player.ad-showing") !== null;
}
