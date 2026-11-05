import { describe, expect, it } from "vitest";
import { AWAY_MS, isArrival } from "./arrival";

const MIN = 60_000;
const noon = new Date(2026, 9, 24, 12, 0, 0).getTime();

describe("isArrival", () => {
  it("is the first sighting", () => expect(isArrival(null, noon)).toBe(true));
  it("is not a reload seconds later", () => expect(isArrival(noon, noon + 5_000)).toBe(false));
  it("is not a 5-minute-away return", () => expect(isArrival(noon, noon + 5 * MIN)).toBe(false));
  it("is a 45-minute-away return", () => expect(isArrival(noon, noon + 45 * MIN)).toBe(true));
  it("is exactly at the threshold", () => expect(isArrival(noon, noon + AWAY_MS)).toBe(true));
  it("is not just under the threshold", () => expect(isArrival(noon, noon + AWAY_MS - 1)).toBe(false));
  it("is the first visit of a new local day, however recent", () => {
    const late = new Date(2026, 9, 24, 23, 55).getTime();
    const early = new Date(2026, 9, 25, 0, 5).getTime();
    expect(isArrival(late, early)).toBe(true);
  });
});
