import { dayOf } from "../src/domain/spend/CycleSpend.ts";
import { parisDay } from "../plugin/hooks/spend-line.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { refreshSpend } from "./spend.ts";
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

describe("parisDay", () => {
  it("matches the meter's dayOf, incl. around the 03:00 turnover", () => {
    for (const iso of [
      "2026-10-28T00:30:00Z",
      "2026-10-28T01:59:00Z",
      "2026-10-28T02:01:00Z",
      "2026-03-29T00:30:00Z",
    ])
      expect(parisDay(Date.parse(iso))).toBe(dayOf(Date.parse(iso)));
  });
});

describe("refreshSpend", () => {
  const vault = () => fs.mkdtempSync(path.join(os.tmpdir(), "spend-"));
  const lock = (v: string) => path.join(v, "cache", "cycle-spend.lock");

  it("no cycles: nothing to refresh, lock released", () => {
    const v = vault();
    expect(refreshSpend(v)).toMatch(/no active cycle/);
    expect(fs.existsSync(lock(v))).toBe(false);
  });
  it("yields to a live lock and leaves it", () => {
    const v = vault();
    fs.mkdirSync(path.dirname(lock(v)), { recursive: true });
    fs.writeFileSync(lock(v), "1");
    expect(refreshSpend(v)).toMatch(/another refresh/);
    expect(fs.existsSync(lock(v))).toBe(true);
  });
});
