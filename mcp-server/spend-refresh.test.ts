import { describe, expect, it } from "vitest";
import {
  CACHE_MAX_AGE_MS,
  LOCK_STALE_MS,
  shouldRefresh,
} from "../plugin/hooks/spend-refresh.ts";

describe("shouldRefresh", () => {
  it("refreshes when the cache is missing or older than 30 min", () => {
    expect(shouldRefresh(null, null)).toBe(true);
    expect(shouldRefresh(CACHE_MAX_AGE_MS + 1, null)).toBe(true);
  });
  it("leaves a fresh cache alone", () => {
    expect(shouldRefresh(60_000, null)).toBe(false);
  });
  it("yields to a live lock, steals a stale one", () => {
    expect(shouldRefresh(null, 1_000)).toBe(false);
    expect(shouldRefresh(null, LOCK_STALE_MS + 1)).toBe(true);
  });
});
