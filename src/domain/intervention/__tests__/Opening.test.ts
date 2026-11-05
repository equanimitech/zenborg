import { describe, expect, it } from "vitest";
import {
  buildOpening,
  buildPassAllowance,
  isRuleRecord,
  resolveInstant,
} from "../Opening";

// Local wall-clock, so the assertions hold in any time zone.
const now = new Date(2026, 9, 24, 17, 0);

describe("resolveInstant", () => {
  it("reads a clock time as today, local", () => {
    expect(resolveInstant("20:00", now)?.getTime()).toBe(new Date(2026, 9, 24, 20, 0).getTime());
  });

  it("rolls an until at or before from to the next day", () => {
    const from = resolveInstant("20:00", now)!;
    expect(resolveInstant("01:00", now, from)?.getTime()).toBe(new Date(2026, 9, 25, 1, 0).getTime());
  });

  it("refuses what is not a time", () => {
    expect(resolveInstant("25:00", now)).toBeNull();
    expect(resolveInstant("tonight", now)).toBeNull();
  });
});

describe("buildOpening", () => {
  it("builds the record the pitch names", () => {
    const result = buildOpening(
      { hosts: ["www.YouTube.com"], from: "20:00", until: "01:00", reason: "friends over" },
      now,
    );
    if (!("record" in result)) throw new Error(result.problems.join("; "));
    const from = new Date(2026, 9, 24, 20, 0).toISOString();
    expect(result.record).toEqual({
      id: `opening:${from}:youtube-com`,
      kind: "opening",
      hosts: ["youtube.com"],
      from,
      until: new Date(2026, 9, 25, 1, 0).toISOString(),
      reason: "friends over",
    });
    expect(isRuleRecord(result.record)).toBe(false);
  });

  it("refuses a URL, a missing reason and a window already over", () => {
    const result = buildOpening(
      { hosts: ["https://youtube.com/watch"], from: "2026-10-23T18:00:00Z", until: "2026-10-23T20:00:00Z", reason: " " },
      now,
    );
    expect("problems" in result && result.problems).toHaveLength(3);
  });
});

describe("buildPassAllowance", () => {
  it("accepts whole passes and positive hours", () => {
    expect(buildPassAllowance(4, 3)).toEqual({
      record: { id: "pass-allowance", kind: "pass-allowance", perMonth: 4, hours: 3 },
    });
    expect("problems" in buildPassAllowance(2.5, 0)).toBe(true);
  });
});
