// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import type { Area } from "@/domain/entities/Area";
import type { CyclePlan } from "@/domain/entities/CyclePlan";
import type { Habit } from "@/domain/entities/Habit";
import type { VirtualDeckCard } from "@/infrastructure/state/virtualDeckCards";

// Make React globally available (needed for JSX in components without React import)
globalThis.React = React;

// ---------- Test fixtures ----------
const testArea: Area = {
  id: "area-1",
  name: "Wellness",
  color: "#10b981",
  emoji: "🟢",
  isDefault: true,
  attitude: null,
  tags: [],
  order: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const testArea2: Area = {
  ...testArea,
  id: "area-2",
  name: "Craft",
  emoji: "🔵",
  order: 1,
};

const testHabit1: Habit = {
  id: "habit-1",
  name: "fiction",
  areaId: "area-1",
  attitude: null,
  phase: null,
  tags: [],
  emoji: "📖",
  isArchived: false,
  order: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const testHabit2: Habit = {
  ...testHabit1,
  id: "habit-2",
  name: "deep work",
  areaId: "area-2",
  emoji: "💻",
};

const testPlan1: CyclePlan = {
  id: "plan-1",
  cycleId: "cycle-1",
  habitId: "habit-1",
  budgetedCount: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const testPlan2: CyclePlan = {
  ...testPlan1,
  id: "plan-2",
  habitId: "habit-2",
  budgetedCount: 2,
};

const testCycle = {
  id: "cycle-1",
  name: "Dev Summer",
  startDate: "2026-01-01",
  endDate: "2026-04-01",
  intention: null,
  reflection: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------- Mocks ----------
vi.mock("@legendapp/state/react", () => ({
  use$: vi.fn(),
  useValue: vi.fn(),
}));

vi.mock("../banded-heatmap/CycleDeckHeatmap", () => ({
  CycleDeckHeatmap: () => <div data-testid="cycle-deck-heatmap" />,
}));

// Mock CycleDeckColumn: render a deck-card-testid element per ghost slot so
// the parent test can assert total ghost count via getAllByTestId.
vi.mock("../CycleDeckColumn", () => ({
  CycleDeckColumn: ({
    area,
    cards,
    isEditMode,
    showAllHabits,
  }: {
    area: Area;
    cards: VirtualDeckCard[];
    isEditMode: boolean;
    showAllHabits: boolean;
    cycleId: string;
  }) => (
    <div
      data-testid={`cycle-deck-column-${area.id}`}
      data-edit-mode={isEditMode}
      data-show-all={showAllHabits}
    >
      <span>{area.emoji}</span>
      <span>{area.name}</span>
      {cards.map((card) =>
        Array.from({ length: card.ghosts }).map((_, i) => (
          <div
            key={`${card.plan.id}-${i}`}
            data-testid="deck-card"
            data-habit-id={card.habit.id}
          >
            ghost
          </div>
        )),
      )}
    </div>
  ),
}));

vi.mock("../CycleCalendarDialog", () => ({
  CycleCalendarDialog: () => <div data-testid="cycle-calendar-dialog" />,
}));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
}));

const mockUpdateCycle = vi.fn();
const mockEndCycle = vi.fn();

vi.mock("@/application/services/CycleService", () => ({
  CycleService: vi.fn().mockImplementation(() => ({
    updateCycle: mockUpdateCycle,
    endCycle: mockEndCycle,
  })),
}));

vi.mock("@/lib/dates", () => ({
  formatCycleSubtitle: vi.fn(() => "ends in 5 days"),
  formatCycleDateRange: vi.fn(() => "Jan 1 – Apr 1"),
  fromISODate: vi.fn((s: string) => new Date(s)),
  toISODate: vi.fn((d: Date) => d.toISOString().slice(0, 10)),
}));

vi.mock("@/infrastructure/state/store", () => ({
  areas$: { get: vi.fn(() => ({})) },
  activeCycle$: { get: vi.fn(() => null) },
  cycles$: { get: vi.fn(() => ({})) },
  cyclePlans$: { get: vi.fn(() => ({})) },
  habits$: { get: vi.fn(() => ({})) },
  moments$: { get: vi.fn(() => ({})) },
  storeHydrated$: { get: vi.fn(() => true) },
}));

vi.mock("@/infrastructure/state/ui-store", () => ({
  cycleDeckCollapsed$: {
    get: vi.fn(() => false),
    set: vi.fn(),
    peek: vi.fn(() => false),
  },
  cycleDeckEditMode$: {
    get: vi.fn(() => false),
    set: vi.fn(),
    peek: vi.fn(() => false),
  },
  cycleDeckSelectedCycleId$: {
    get: vi.fn(() => null),
    set: vi.fn(),
    peek: vi.fn(() => null),
  },
}));

// ---------- Imports after mocks ----------
import { useValue } from "@legendapp/state/react";
// Import after mocks
import { CycleDeck } from "../CycleDeck";

const mockUseValue = useValue as unknown as ReturnType<typeof vi.fn>;

interface MockStoreState {
  activeCycle?: typeof testCycle | null;
  isCollapsed?: boolean;
  isEditMode?: boolean;
  selectedCycleId?: string | null;
  cyclesMap?: Record<string, typeof testCycle>;
  plansMap?: Record<string, CyclePlan>;
  habitsMap?: Record<string, Habit>;
  areasMap?: Record<string, Area>;
  momentsMap?: Record<string, unknown>;
  isHydrated?: boolean;
}

/**
 * CycleDeck calls `useValue` in this order (see CycleDeck.tsx):
 * 1. activeCycle (selector)
 * 2. cycleDeckCollapsed$
 * 3. cycleDeckEditMode$
 * 4. cycleDeckSelectedCycleId$
 * 5. cycles$ (selector)
 * 6. cyclePlans$ (selector)
 * 7. habits$ (selector)
 * 8. areas$ (selector)
 * 9. moments$ (selector)
 * 10. storeHydrated$
 */
const mockStore = (state: MockStoreState) => {
  const values = [
    state.activeCycle ?? null,
    state.isCollapsed ?? false,
    state.isEditMode ?? false,
    state.selectedCycleId ?? null,
    state.cyclesMap ??
      (state.activeCycle ? { [state.activeCycle.id]: state.activeCycle } : {}),
    state.plansMap ?? {},
    state.habitsMap ?? {},
    state.areasMap ?? {},
    state.momentsMap ?? {},
    state.isHydrated ?? true,
  ];

  let callIndex = 0;
  mockUseValue.mockImplementation(() => {
    const v = values[callIndex] ?? null;
    callIndex++;
    return v;
  });
};

describe("CycleDeck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("no active cycle", () => {
    it("renders the strip and a quiet hint when no cycle is active", () => {
      mockStore({ activeCycle: null });

      render(<CycleDeck />);

      expect(screen.getByTestId("cycle-deck-heatmap")).toBeInTheDocument();
      expect(screen.getByText(/no active season/i)).toBeInTheDocument();
    });
  });

  describe("empty state (no plans)", () => {
    it("shows empty state hint in read-only mode", () => {
      mockStore({ activeCycle: testCycle });

      render(<CycleDeck />);

      expect(
        screen.getByText(/Drag habits from the library to plan your week/),
      ).toBeInTheDocument();
    });

    it("hints to drag habits back to set aside", () => {
      mockStore({ activeCycle: testCycle });

      render(<CycleDeck />);

      expect(screen.getByText(/set aside/i)).toBeInTheDocument();
    });
  });

  describe("virtual deck cards", () => {
    it("renders one deck-card per ghost slot (budgetedCount - allocated)", () => {
      mockStore({
        activeCycle: testCycle,
        plansMap: { "plan-1": testPlan1 }, // budgetedCount: 3
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
        momentsMap: {}, // no allocations
      });

      render(<CycleDeck />);

      // 3 ghosts = 3 deck-card elements
      expect(screen.getAllByTestId("deck-card")).toHaveLength(3);
    });

    it("subtracts allocated moments from ghost count", () => {
      mockStore({
        activeCycle: testCycle,
        plansMap: { "plan-1": testPlan1 }, // budgetedCount: 3
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
        momentsMap: {
          "m-1": {
            id: "m-1",
            name: "fiction",
            areaId: "area-1",
            habitId: "habit-1",
            cycleId: "cycle-1",
            cyclePlanId: "plan-1",
            day: "2026-02-01",
            phase: "MORNING",
            order: 0,
            tags: [],
            emoji: null,
            createdAt: "",
            updatedAt: "",
          },
        },
      });

      render(<CycleDeck />);

      // 3 budgeted - 1 allocated = 2 ghosts
      expect(screen.getAllByTestId("deck-card")).toHaveLength(2);
    });

    it("renders area column per area with plans", () => {
      mockStore({
        activeCycle: testCycle,
        plansMap: { "plan-1": testPlan1, "plan-2": testPlan2 },
        habitsMap: { "habit-1": testHabit1, "habit-2": testHabit2 },
        areasMap: { "area-1": testArea, "area-2": testArea2 },
        momentsMap: {},
      });

      render(<CycleDeck />);

      expect(
        screen.getByTestId("cycle-deck-column-area-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("cycle-deck-column-area-2"),
      ).toBeInTheDocument();
    });

    it("renders total ghosts across both areas (3 + 2 = 5)", () => {
      mockStore({
        activeCycle: testCycle,
        plansMap: { "plan-1": testPlan1, "plan-2": testPlan2 },
        habitsMap: { "habit-1": testHabit1, "habit-2": testHabit2 },
        areasMap: { "area-1": testArea, "area-2": testArea2 },
        momentsMap: {},
      });

      render(<CycleDeck />);

      expect(screen.getAllByTestId("deck-card")).toHaveLength(5);
    });
  });

  describe("header", () => {
    it("shows collapse button", () => {
      mockStore({
        activeCycle: testCycle,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      expect(screen.getByTitle("Collapse season deck")).toBeInTheDocument();
    });

    it("renders the cycle heatmap above the header", () => {
      mockStore({
        activeCycle: testCycle,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      expect(screen.getByTestId("cycle-deck-heatmap")).toBeInTheDocument();
    });
  });

  describe("edit mode", () => {
    it("shows Done editing button when edit mode is active", () => {
      mockStore({
        activeCycle: testCycle,
        isEditMode: true,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      expect(screen.getByTitle("Done editing")).toBeInTheDocument();
    });

    it("shows Edit button when edit mode is inactive", () => {
      mockStore({
        activeCycle: testCycle,
        isEditMode: false,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      expect(screen.getByTitle("Edit season deck")).toBeInTheDocument();
    });

    it("hides Edit button when collapsed", () => {
      mockStore({
        activeCycle: testCycle,
        isCollapsed: true,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      expect(screen.queryByTitle("Edit season deck")).toBeNull();
    });
  });

  describe("inline cycle header editing", () => {
    it("renders name as input when edit mode is active", () => {
      mockStore({
        activeCycle: testCycle,
        isEditMode: true,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      const nameInput = screen.getByDisplayValue("Dev Summer");
      expect(nameInput).toBeInTheDocument();
      expect(nameInput.tagName).toBe("INPUT");
    });

    it("renders name as plain text when edit mode is off", () => {
      mockStore({
        activeCycle: testCycle,
        isEditMode: false,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      expect(screen.getByText(/Dev Summer/)).toBeInTheDocument();
      expect(screen.queryByDisplayValue("Dev Summer")).toBeNull();
    });

    it("renders date inputs when edit mode is active", () => {
      mockStore({
        activeCycle: testCycle,
        isEditMode: true,
        plansMap: { "plan-1": testPlan1 },
        habitsMap: { "habit-1": testHabit1 },
        areasMap: { "area-1": testArea },
      });

      render(<CycleDeck />);

      expect(screen.getByLabelText("Start date")).toBeInTheDocument();
      expect(screen.getByLabelText("End date")).toBeInTheDocument();
    });
  });

  describe("empty state in edit mode", () => {
    it("shows area columns instead of empty message", () => {
      mockStore({
        activeCycle: testCycle,
        isEditMode: true,
        plansMap: {},
        habitsMap: { "habit-1": testHabit1, "habit-2": testHabit2 },
        areasMap: { "area-1": testArea, "area-2": testArea2 },
      });

      render(<CycleDeck />);

      expect(screen.queryByText(/Drag habits from the library to plan your week/)).toBeNull();
      expect(
        screen.getByTestId("cycle-deck-column-area-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("cycle-deck-column-area-2"),
      ).toBeInTheDocument();
    });
  });
});
