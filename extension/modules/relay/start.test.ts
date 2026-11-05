import { describe, it, expect } from "vitest";
import { canStart, switchMinutes } from "./start";

describe("starting a moment", () => {
  it("uses the moment's duration, else 120, capped at 240", () => {
    expect(switchMinutes(45)).toBe(45);
    expect(switchMinutes(null)).toBe(120);
    expect(switchMinutes(0)).toBe(120);
    expect(switchMinutes(-5)).toBe(120);
    expect(switchMinutes(600)).toBe(240);
  });
  it("is not startable when active or done", () => {
    expect(canStart({ active: false, status: "PLANNED" })).toBe(true);
    expect(canStart({ active: true, status: "PLANNED" })).toBe(false);
    expect(canStart({ active: false, status: "DONE" })).toBe(false);
  });
});
