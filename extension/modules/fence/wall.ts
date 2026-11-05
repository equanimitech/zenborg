import { domainFromUrl } from "../activity/events";
import { blockingFences } from "./parse";
import type { Fence, Fences } from "./types";

/**
 * The commit backstop's decision. A DNR block never fires when a service worker
 * serves the navigation (youtube.com), so a committed top-level load is checked
 * against the same live fences DNR is projected from. `fences` must already have
 * lifts and rations applied (`liveFences`). Null when nothing holds the page.
 */
export function shouldWall(url: string, fences: Fences): { host: string; blocking: Fence[] } | null {
  const host = domainFromUrl(url); // null for extension pages and non-http(s)
  if (host === null) return null;
  const blocking = blockingFences(fences, host);
  return blocking.length === 0 ? null : { host, blocking };
}
