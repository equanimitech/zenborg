// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { Phase } from "@/domain/value-objects/Phase";
import type {
  HarvestMoment,
  HarvestSeason,
} from "@/infrastructure/state/harvestViewModel";
import { SeasonReadback } from "../SeasonReadback";

// Make React globally available (needed for JSX in components without React import)
globalThis.React = React;

const harvestMoment = (
  id: string,
  name: string,
  day: string,
  extra: Partial<HarvestMoment> = {},
): HarvestMoment => ({
  id,
  name,
  day,
  phase: Phase.MORNING,
  areaId: "a",
  areaName: "Atlantis",
  areaColor: "#7c3aed",
  people: [],
  ...extra,
});

const season = (extra: Partial<HarvestSeason> = {}): HarvestSeason => ({
  cycleId: "c",
  name: "Avalon Spring",
  startDate: "2026-03-01",
  endDate: "2026-03-31",
  intention: "Read the tide.",
  reflection: { l0: "The season held Avalon.", l1: "And the long walks." },
  reflectionIsHuman: true,
  days: [
    {
      date: "2026-03-01",
      moments: [harvestMoment("m1", "swim", "2026-03-01")],
    },
  ],
  momentCount: 1,
  ...extra,
});

describe("SeasonReadback", () => {
  it("names the season and its window", () => {
    render(<SeasonReadback season={season()} />);

    expect(screen.getByText("Avalon Spring")).toBeInTheDocument();
    expect(screen.getByText(/Mar 1 - 31/)).toBeInTheDocument();
  });

  it("shows what was intended and what the season held, both", () => {
    render(<SeasonReadback season={season()} />);

    expect(screen.getByText("Read the tide.")).toBeInTheDocument();
    expect(screen.getByText("The season held Avalon.")).toBeInTheDocument();
    expect(screen.getByText(/And the long walks\./)).toBeInTheDocument();
  });

  it("lists the moments planted, under their day", () => {
    render(
      <SeasonReadback
        season={season({
          days: [
            {
              date: "2026-03-01",
              moments: [
                harvestMoment("m1", "swim", "2026-03-01"),
                harvestMoment("m2", "write", "2026-03-01", {
                  phase: Phase.EVENING,
                  people: ["Ada", "Bea"],
                }),
              ],
            },
            {
              date: "2026-03-02",
              moments: [harvestMoment("m3", "walk", "2026-03-02")],
            },
          ],
          momentCount: 3,
        })}
      />,
    );

    expect(screen.getByText("swim")).toBeInTheDocument();
    expect(screen.getByText("write")).toBeInTheDocument();
    expect(screen.getByText("walk")).toBeInTheDocument();
    expect(screen.getByText(/Ada, Bea/)).toBeInTheDocument();
  });

  it("attributes colour to the area and nothing else", () => {
    const { container } = render(<SeasonReadback season={season()} />);

    const swatches = container.querySelectorAll("[data-area-swatch]");
    expect(swatches).toHaveLength(1);
    expect(swatches[0]).toHaveAttribute("data-area-id", "a");
  });

  it("renders a season with no reflection, no intention and no moments", () => {
    // Acceptance 1: never an error state.
    render(
      <SeasonReadback
        season={season({
          intention: null,
          reflection: null,
          days: [],
          momentCount: 0,
        })}
      />,
    );

    expect(screen.getByText("Avalon Spring")).toBeInTheDocument();
    expect(screen.queryByText("Read the tide.")).not.toBeInTheDocument();
  });

  it("reads back a reflection that is one line only", () => {
    render(
      <SeasonReadback
        season={season({ reflection: { l0: "One line, no more.", l1: "" } })}
      />,
    );

    expect(screen.getByText("One line, no more.")).toBeInTheDocument();
  });

  it("says so plainly when no season has closed yet", () => {
    render(<SeasonReadback season={null} />);

    expect(screen.getByText(/Your story will appear here after your first season ends/i)).toBeInTheDocument();
  });

  it("never scores the season — no progress bar, no percentage", () => {
    // Acceptance 4, held at the surface as well as in the view model.
    const { container } = render(<SeasonReadback season={season()} />);

    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(container.querySelector("progress")).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
  });

  describe("provenance", () => {
    it("marks a machine draft as drafted, so it cannot pass as your words", () => {
      // Acceptance 3. This is the whole point of the field.
      render(<SeasonReadback season={season({ reflectionIsHuman: false })} />);

      expect(screen.getByText(/drafted/i)).toBeInTheDocument();
    });

    it("says nothing about provenance when you wrote it yourself", () => {
      render(<SeasonReadback season={season({ reflectionIsHuman: true })} />);

      expect(screen.queryByText(/drafted/i)).not.toBeInTheDocument();
    });

    it("says nothing when there is no reflection to attribute", () => {
      render(
        <SeasonReadback
          season={season({ reflection: null, reflectionIsHuman: false })}
        />,
      );

      expect(screen.queryByText(/drafted/i)).not.toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("stays read-only when no editor is wired", () => {
      render(<SeasonReadback season={season()} />);

      expect(
        screen.queryByRole("button", { name: /edit/i }),
      ).not.toBeInTheDocument();
    });

    it("opens the two rungs for editing", () => {
      render(<SeasonReadback onEditReflection={() => {}} season={season()} />);

      fireEvent.click(screen.getByRole("button", { name: /edit/i }));

      expect(screen.getByLabelText(/the line/i)).toHaveValue(
        "The season held Avalon.",
      );
      expect(screen.getByLabelText(/behind it/i)).toHaveValue(
        "And the long walks.",
      );
    });

    it("composes the two rungs back into one stored string on save", () => {
      const onEditReflection = vi.fn();
      render(
        <SeasonReadback
          onEditReflection={onEditReflection}
          season={season()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      fireEvent.change(screen.getByLabelText(/the line/i), {
        target: { value: "My own line." },
      });
      fireEvent.change(screen.getByLabelText(/behind it/i), {
        target: { value: "My own body." },
      });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(onEditReflection).toHaveBeenCalledWith(
        "My own line.\n\nMy own body.",
      );
    });

    it("hands back null when both rungs are emptied", () => {
      const onEditReflection = vi.fn();
      render(
        <SeasonReadback
          onEditReflection={onEditReflection}
          season={season()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      fireEvent.change(screen.getByLabelText(/the line/i), {
        target: { value: "  " },
      });
      fireEvent.change(screen.getByLabelText(/behind it/i), {
        target: { value: "" },
      });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(onEditReflection).toHaveBeenCalledWith(null);
    });

    it("discards the edit on cancel", () => {
      const onEditReflection = vi.fn();
      render(
        <SeasonReadback
          onEditReflection={onEditReflection}
          season={season()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      fireEvent.change(screen.getByLabelText(/the line/i), {
        target: { value: "Never mind." },
      });
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onEditReflection).not.toHaveBeenCalled();
      expect(screen.getByText("The season held Avalon.")).toBeInTheDocument();
    });

    it("invites you to write one when the season has no reflection", () => {
      // Editing is the expected act, not a repair.
      render(
        <SeasonReadback
          onEditReflection={() => {}}
          season={season({ reflection: null, reflectionIsHuman: false })}
        />,
      );

      expect(
        screen.getByRole("button", { name: /write/i }),
      ).toBeInTheDocument();
    });
  });
});
