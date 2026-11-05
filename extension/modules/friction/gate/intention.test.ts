import { describe, expect, it } from "vitest";
import type { TodayMoment } from "../../relay/client";
import {
  gateMomentFor,
  minuteChoices,
  readReflectRequest,
  readStartRequest,
  reflectionDue,
  REFLECT_WINDOW_MS,
} from "./intention";

const moment = (over: Partial<TodayMoment> = {}): TodayMoment => ({
  id: "yt",
  name: "YouTube",
  phase: "EVENING",
  areaName: "Leisure",
  areaEmoji: "",
  areaColor: "",
  active: false,
  startTime: null,
  durationMin: null,
  status: "accepted",
  ...over,
});

describe("gateMomentFor", () => {
  it("offers nothing when no moment for the host is planted today", () => {
    expect(gateMomentFor("youtube.com", [])).toBeNull();
    expect(gateMomentFor("youtube.com", [moment({ id: "r", name: "Run" })])).toBeNull();
  });

  it("matches a moment's refs, subdomains included", () => {
    const board = [moment({ id: "m", name: "Lecture", hosts: ["www.youtube.com"] })];
    expect(gateMomentFor("m.youtube.com", board)?.momentId).toBe("m");
  });

  it("falls back to a habit or moment named after the site", () => {
    expect(gateMomentFor("chess.com", [moment({ id: "c", name: "Blitz", habitName: "Chess" })])?.momentId).toBe("c");
    expect(gateMomentFor("youtube.com", [moment()])?.momentId).toBe("yt");
  });

  it("does not offer the moment already in force", () => {
    expect(gateMomentFor("youtube.com", [moment({ active: true })])).toBeNull();
  });

  it("prefers a refs match over a name match", () => {
    const board = [moment({ id: "byName" }), moment({ id: "byRef", name: "Talk", hosts: ["youtube.com"] })];
    expect(gateMomentFor("youtube.com", board)?.momentId).toBe("byRef");
  });

  it("does not match a different site sharing a suffix", () => {
    expect(gateMomentFor("notyoutube.com", [moment({ name: "Talk", hosts: ["youtube.com"] })])).toBeNull();
  });
});

describe("minuteChoices", () => {
  it("defaults to the moment's own duration", () => {
    expect(minuteChoices(45)).toEqual([45, 15, 30, 60]);
    expect(minuteChoices(30)).toEqual([30, 15, 60]);
  });
  it("else the short list", () => {
    expect(minuteChoices(null)).toEqual([15, 30, 60]);
    expect(minuteChoices(9999)).toEqual([15, 30, 60]);
  });
});

describe("reflectionDue", () => {
  const s = { domain: "youtube.com", momentId: "yt", name: "YouTube", intention: "one talk", until: 1_000 };
  it("asks on the host once the switch has ended", () => {
    expect(reflectionDue(s, "youtube.com", 999)).toBe(false);
    expect(reflectionDue(s, "youtube.com", 1_000)).toBe(true);
    expect(reflectionDue(s, "chess.com", 1_000)).toBe(false);
    expect(reflectionDue(null, "youtube.com", 1_000)).toBe(false);
  });
  it("asks once", () => {
    expect(reflectionDue({ ...s, asked: true }, "youtube.com", 1_000)).toBe(false);
  });
  it("lets an old end go unasked", () => {
    expect(reflectionDue(s, "youtube.com", 1_000 + REFLECT_WINDOW_MS)).toBe(false);
  });
});

describe("page requests", () => {
  it("accepts a well-formed start and refuses the rest", () => {
    const ok = { type: "kairos-gate-start", momentId: "yt", minutes: 15, intention: " one talk " };
    expect(readStartRequest(ok)).toEqual({ momentId: "yt", minutes: 15, intention: "one talk" });
    expect(readStartRequest({ ...ok, minutes: 0 })).toBeNull();
    expect(readStartRequest({ ...ok, minutes: 1.5 })).toBeNull();
    expect(readStartRequest({ ...ok, intention: "  " })).toBeNull();
    expect(readStartRequest({ ...ok, type: "other" })).toBeNull();
  });
  it("reads a reflection, a skip, and ignores other messages", () => {
    expect(readReflectRequest({ type: "kairos-gate-reflect", text: " a good talk " })).toEqual({ text: "a good talk" });
    expect(readReflectRequest({ type: "kairos-gate-reflect", text: null })).toEqual({ text: null });
    expect(readReflectRequest({ type: "kairos-gate-check" })).toBeUndefined();
  });
});
