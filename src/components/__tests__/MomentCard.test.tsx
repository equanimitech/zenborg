// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { wakingDayKey } from "@/domain/attention/ActiveMoment";
import type { Area } from "@/domain/entities/Area";
import type { Moment } from "@/domain/entities/Moment";

globalThis.React = React;

const toggleActive = vi.fn();
const openMomentFormEdit = vi.fn();
let activeMomentId: string | null = null;

vi.mock("@legendapp/state/react", () => ({ use$: () => ({}) }));
vi.mock("@/hooks/useActiveMoment", () => ({
  useActiveMoment: () => ({ activeMomentId, toggleActive }),
}));
vi.mock("@/hooks/useHabitHealth", () => ({
  useHabitHealth: () => ({ health: "unstated" }),
}));
vi.mock("@/hooks/useSelection", () => ({
  useSelection: () => ({
    isSelected: () => false,
    toggleSelection: vi.fn(),
    selectRange: vi.fn(),
  }),
}));
vi.mock("@/infrastructure/state/store", () => ({ phaseConfigs$: {} }));
vi.mock("../MentionSummary", () => ({ MentionSummary: () => null }));
vi.mock("../TagSummary", () => ({ TagSummary: () => null }));
vi.mock("@/infrastructure/state/ui-store", () => ({
  openMomentFormEdit: (...a: unknown[]) => openMomentFormEdit(...a),
}));

import { MomentCard } from "../MomentCard";

const area = { id: "a", name: "Body", color: "#a8c4a2" } as Area;
const moment = (day: string | null) =>
  ({ id: "m1", name: "Run", day, tags: [] }) as unknown as Moment;

describe("MomentCard start control", () => {
  beforeEach(() => {
    toggleActive.mockClear();
    openMomentFormEdit.mockClear();
    activeMomentId = null;
  });

  it("shows only for moments on today's board", () => {
    const { rerender } = render(
      <MomentCard moment={moment(wakingDayKey())} area={area} />,
    );
    expect(screen.getByLabelText("Start Run")).toBeInTheDocument();
    rerender(<MomentCard moment={moment("2000-01-01")} area={area} />);
    expect(screen.queryByTestId("moment-start")).not.toBeInTheDocument();
    rerender(<MomentCard moment={moment(null)} area={area} />);
    expect(screen.queryByTestId("moment-start")).not.toBeInTheDocument();
  });

  it("toggles without opening the editor, and is not nested in the card button", () => {
    render(<MomentCard moment={moment(wakingDayKey())} area={area} />);
    const control = screen.getByLabelText("Start Run");
    expect(control.closest("button[data-moment-id]")).toBeNull();
    fireEvent.click(control);
    expect(toggleActive).toHaveBeenCalledWith("m1");
    expect(openMomentFormEdit).not.toHaveBeenCalled();
  });

  it("offers release on the active moment", () => {
    activeMomentId = "m1";
    render(<MomentCard moment={moment(wakingDayKey())} area={area} />);
    expect(screen.getByLabelText("Release Run")).toBeInTheDocument();
  });
});
