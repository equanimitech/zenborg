// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import type { Footprint, WeekReadback } from "@/domain/readback/WeekReadback";
import { areaRows, formatMinutes, WeekReadbackView } from "../WeekReadbackView";

globalThis.React = React;

const fp = (byArea: Footprint["byArea"], unmappedMin = 0): Footprint => ({
  byArea,
  unmapped: unmappedMin ? [{ locator: "cmux", minutes: unmappedMin }] : [],
  coverage: { seenHours: 40, idleCreditedMin: 0, unmappedMin },
});

const READBACK: WeekReadback = {
  window: { from: "2026-10-05", to: "2026-10-11" },
  lastWindow: { from: "2026-09-28", to: "2026-10-04" },
  board: [
    {
      day: "2026-10-06",
      phases: [
        {
          phase: "MORNING",
          moments: [
            { id: "m1", name: "review", areaId: "themia", traceable: true },
            { id: "m2", name: "sit", areaId: "wellness", traceable: false },
          ],
        },
      ],
    },
  ],
  planted: [
    { areaId: "themia", areaName: "Themia", thisWeek: 7, lastWeek: 11 },
    { areaId: "wellness", areaName: "Wellness", thisWeek: 1, lastWeek: 0 },
  ],
  footprints: [
    { surface: "body", status: "drawn", thisWeek: fp([]), lastWeek: fp([]) },
    {
      surface: "screen",
      status: "drawn",
      thisWeek: fp(
        [{ areaId: "ent", areaName: "Entertainment", minutes: 423 }],
        659,
      ),
      lastWeek: fp([
        { areaId: "ent", areaName: "Entertainment", minutes: 283 },
      ]),
    },
    {
      surface: "work",
      status: "drawn",
      thisWeek: fp([{ areaId: "themia", areaName: "Themia", minutes: 1110 }]),
      lastWeek: fp([{ areaId: "themia", areaName: "Themia", minutes: 1164 }]),
    },
    { surface: "journal", status: "not drawn" },
    { surface: "comms", status: "not drawn" },
  ],
  wilting: [
    { habitId: "h", name: "Sit", areaId: "wellness", areaName: "Wellness" },
  ],
};

const AREAS = {
  themia: { name: "Themia", color: "#05135c", order: 0 },
  ent: { name: "Entertainment", color: "#e11d48", order: 1 },
  wellness: { name: "Wellness", color: "#16a34a", order: 2 },
};

const renderView = (logReadable = true) =>
  render(
    <WeekReadbackView
      areas={AREAS}
      logReadable={logReadable}
      onPrevious={() => {}}
      readback={READBACK}
    />,
  );

describe("formatMinutes", () => {
  it("reads in hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0 m");
    expect(formatMinutes(45)).toBe("45 m");
    expect(formatMinutes(420)).toBe("7 h");
    expect(formatMinutes(423)).toBe("7 h 3 m");
  });
});

describe("areaRows", () => {
  it("puts planted counts beside footprint minutes summed across surfaces", () => {
    expect(areaRows(READBACK)).toEqual([
      {
        areaId: "themia",
        planted: 7,
        plantedLast: 11,
        minutes: 1110,
        minutesLast: 1164,
      },
      {
        areaId: "wellness",
        planted: 1,
        plantedLast: 0,
        minutes: 0,
        minutesLast: 0,
      },
      {
        areaId: "ent",
        planted: 0,
        plantedLast: 0,
        minutes: 423,
        minutesLast: 283,
      },
    ]);
  });
});

describe("WeekReadbackView", () => {
  it("reads journal and comms as not drawn, never as zero", () => {
    renderView();
    expect(screen.getAllByText(/not drawn/)).toHaveLength(2);
  });

  it("shows coverage beside every drawn surface, closed", () => {
    renderView();
    expect(screen.getAllByText(/^seen 40 h · 0 m through idle/)).toHaveLength(
      3,
    );
    expect(screen.getByText(/unmapped: cmux 10 h 59 m/)).toBeInTheDocument();
  });

  it("marks an off-screen moment untraceable, not missed", () => {
    renderView();
    expect(screen.getByText("untraceable")).toBeInTheDocument();
    expect(screen.queryByText(/missed/i)).toBeNull();
  });

  it("carries no percentage, ratio or arrow", () => {
    const { container } = renderView();
    expect(container.textContent).not.toMatch(/%|→|↑|↓|×|ratio|score/i);
  });

  it("says the log is unreadable in the web build instead of showing an empty week", () => {
    renderView(false);
    expect(screen.getByText(/desktop app's activity log/)).toBeInTheDocument();
    // Unseen is not zero: no footprint minutes render at all.
    expect(screen.queryByText("Footprints")).toBeNull();
    expect(screen.queryByText(/^\d+ (h|m)$|^\d+ h \d+ m$/)).toBeNull();
  });
});
