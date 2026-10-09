import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  footprintParamsError,
  footprintWindow,
  getFootprints,
} from "./attention.js";
import type { Area } from "./vault.js";

const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
};

const empty = {
  areas: {},
  habits: {},
  moments: {},
  phaseConfigs: {},
  cycles: {},
  cyclePlans: {},
};

describe("footprintWindow", () => {
  it("reads the Monday → Sunday week holding the day, or an explicit range", () => {
    expect(footprintWindow({ day: "2026-10-08" })).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
    expect(footprintWindow({ from: "2026-10-01", to: "2026-10-03" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-03",
    });
    // Monday 03:00 is still Sunday's waking day.
    expect(footprintWindow({}, new Date(at("2026-10-12", 3)))).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });
});

describe("getFootprints", () => {
  it("runs on an empty vault: every surface drawn or not drawn, nothing thrown", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-footprints-"));
    const r = getFootprints(vault, empty, { day: "2026-10-08" });
    expect(r.footprints.map((f) => `${f.surface}:${f.status}`)).toEqual([
      "body:drawn",
      "screen:drawn",
      "work:drawn",
      "journal:not drawn",
      "comms:not drawn",
    ]);
  });

  it("reads the log files on disk into the week's screen footprint", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-footprints-"));
    fs.mkdirSync(path.join(vault, "log"));
    const line = (kind: string, ts: number, payload: object) =>
      JSON.stringify({ id: `${kind}-${ts}`, kind, ts, sessionId: "", payload });
    fs.writeFileSync(
      path.join(vault, "log", "2026-10-06.desktop.jsonl"),
      [
        // No `surface` field: older files take it from the filename.
        line("app_switched", at("2026-10-06", 21), { app_name: "Stremio" }),
        line("idle_start", at("2026-10-06", 21, 25), { thresholdMs: 120_000 }),
        "{torn",
      ].join("\n"),
    );
    const areas = {
      ent: {
        id: "ent",
        name: "Entertainment",
        surfaces: { apps: ["Stremio"] },
      },
    } as unknown as Record<string, Area>;
    const r = getFootprints(vault, { ...empty, areas }, { day: "2026-10-06" });
    const screen = r.footprints.find((f) => f.surface === "screen");
    if (screen?.status !== "drawn") throw new Error("screen not drawn");
    expect(screen.thisWeek.byArea).toEqual([
      { areaId: "ent", areaName: "Entertainment", minutes: 25 },
    ]);
    expect(screen.thisWeek.coverage).toEqual({
      seenHours: 0.4, // the 25 minutes Stremio was in front
      idleCreditedMin: 0,
      unmappedMin: 0,
    });
  });
});

describe("footprintParamsError", () => {
  it("refuses `to` without `from`, both forms at once, and ranges over 31 days", () => {
    expect(footprintParamsError({ to: "2026-10-11" })).toMatch(/needs `from`/);
    expect(
      footprintParamsError({ day: "2026-10-08", from: "2026-10-01" }),
    ).toMatch(/not both/);
    expect(
      footprintParamsError({ from: "2026-10-11", to: "2026-10-01" }),
    ).toMatch(/before/);
    expect(
      footprintParamsError({ from: "2026-09-01", to: "2026-10-01" }),
    ).toBeNull(); // 31 days
    expect(
      footprintParamsError({ from: "2026-09-01", to: "2026-10-02" }),
    ).toMatch(/32 days/);
    expect(footprintParamsError({ day: "2026-10-08" })).toBeNull();
    expect(footprintParamsError({})).toBeNull();
  });
});
