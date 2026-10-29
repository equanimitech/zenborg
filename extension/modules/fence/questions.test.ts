import { describe, expect, it } from "vitest";
import { ENTRY, pickQuestion, STAYING } from "./questions";

const DAY = new Date(2026, 9, 24, 14, 0).getTime();
const DAY_MS = 86_400_000;

describe("pickQuestion", () => {
  it("is stable for the same host and day", () => {
    const at = (h: number) => new Date(2026, 9, 24, h).getTime();
    expect(pickQuestion(ENTRY, "youtube.com", at(8))).toBe(pickQuestion(ENTRY, "youtube.com", at(22)));
  });
  it("always returns a member of the pool", () => {
    for (let d = 0; d < 40; d++) {
      for (const pool of [ENTRY, STAYING]) {
        expect(pool).toContain(pickQuestion(pool, "x.com", DAY + d * DAY_MS));
      }
    }
  });
  it("varies across days and hosts", () => {
    const days = new Set(Array.from({ length: 20 }, (_, d) => pickQuestion(STAYING, "youtube.com", DAY + d * DAY_MS)));
    expect(days.size).toBeGreaterThan(1);
    const hosts = new Set(
      ["youtube.com", "x.com", "reddit.com", "news.ycombinator.com", "instagram.com"].map((h) =>
        pickQuestion(STAYING, h, DAY),
      ),
    );
    expect(hosts.size).toBeGreaterThan(1);
  });
});
