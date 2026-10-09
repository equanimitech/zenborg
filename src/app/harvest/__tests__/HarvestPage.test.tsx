// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import HarvestPage from "../page";

globalThis.React = React;

describe("Harvest", () => {
  it("opens on the week and zooms out to the season", () => {
    render(<HarvestPage />);
    expect(
      screen.getByRole("heading", { name: "The week" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "season" }));
    expect(screen.queryByRole("heading", { name: "The week" })).toBeNull();
    expect(screen.getByRole("button", { name: "season" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
