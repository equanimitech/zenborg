"use client";

import { useDroppable } from "@dnd-kit/core";
import { useValue } from "@legendapp/state/react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Flag,
  Pencil,
  Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CycleService } from "@/application/services/CycleService";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Area } from "@/domain/entities/Area";
import {
  activeCycle$,
  areas$,
  cyclePlans$,
  cycles$,
  habits$,
  moments$,
  storeHydrated$,
} from "@/infrastructure/state/store";
import {
  cycleDeckCollapsed$,
  cycleDeckEditMode$,
  cycleDeckSelectedCycleId$,
} from "@/infrastructure/state/ui-store";
import {
  computeVirtualDeckCards,
  type VirtualDeckCard,
} from "@/infrastructure/state/virtualDeckCards";
import { formatCycleSubtitle } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { CycleDeckHeatmap } from "./banded-heatmap/CycleDeckHeatmap";
import { CycleCalendarDialog } from "./CycleCalendarDialog";
import { CycleDeckColumn } from "./CycleDeckColumn";

/**
 * CycleDeck - Container for virtual deck cards derived from cycle plans.
 *
 * Derive paradigm: the deck is a computed view of `cyclePlans$`.
 * Each plan contributes `budgetedCount - allocatedCount` ghost cards.
 * Dragging a ghost onto a timeline slot calls `allocateFromPlan`, which
 * materializes a new Moment. Dragging an allocated moment back onto the deck
 * calls `unallocateMoment`, which deletes the moment row.
 *
 * Features:
 *  - Strip-based cycle navigation (past, current, future cycles)
 *  - Double-click header to collapse/expand
 *  - Inline edit mode: editable name + date inputs, budget controls, ghost cards
 *  - CycleStarter shown when no cycle is active
 */
export function CycleDeck() {
  const cycleService = new CycleService();

  // Reactive reads — order matters for test mocks
  const activeCycle = useValue(() => activeCycle$.get());
  const isCollapsed = useValue(cycleDeckCollapsed$);
  const isEditMode = useValue(cycleDeckEditMode$);
  const selectedCycleId = useValue(cycleDeckSelectedCycleId$);
  const allCyclesMap = useValue(() => cycles$.get());
  const plansMap = useValue(() => cyclePlans$.get());
  const habitsMap = useValue(() => habits$.get());
  const areasMap = useValue(() => areas$.get());
  const momentsMap = useValue(() => moments$.get());
  const isHydrated = useValue(storeHydrated$);

  const toggleCollapsed = () =>
    cycleDeckCollapsed$.set(!cycleDeckCollapsed$.peek());

  const toggleEditMode = () => {
    if (isCollapsed) return;
    const next = !cycleDeckEditMode$.peek();
    cycleDeckEditMode$.set(next);
  };

  // Resolve which cycle the detail pane below the strip is rendering.
  // Selection state (ui-store) trumps the active cycle so scrolling the
  // strip can surface any past/future cycle.
  const effectiveCycleId = selectedCycleId || activeCycle?.id || null;
  const effectiveCycle = effectiveCycleId
    ? allCyclesMap[effectiveCycleId] || null
    : null;

  // Create cycle dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // End cycle popover state
  const [endPopoverOpen, setEndPopoverOpen] = useState(false);
  const [endDateInput, setEndDateInput] = useState("");
  const [endCycleError, setEndCycleError] = useState<string | null>(null);

  const resetEndCycleState = () => {
    setEndPopoverOpen(false);
    setEndDateInput("");
    setEndCycleError(null);
  };

  const handleEndCycle = (explicitEndDate?: string) => {
    if (!effectiveCycleId) return;
    const result = cycleService.endCycle(effectiveCycleId, explicitEndDate);
    if ("error" in result) {
      setEndCycleError(result.error);
      return;
    }
    resetEndCycleState();
  };

  // Inline editing state for cycle name and dates
  const [editName, setEditName] = useState(effectiveCycle?.name || "");
  const [editStartDate, setEditStartDate] = useState(
    effectiveCycle?.startDate || "",
  );
  const [editEndDate, setEditEndDate] = useState(effectiveCycle?.endDate || "");

  // Sync inline edit state when navigating to a different cycle
  const effectiveCycleName = effectiveCycle?.name;
  const effectiveCycleStartDate = effectiveCycle?.startDate;
  const effectiveCycleEndDate = effectiveCycle?.endDate;

  useEffect(() => {
    if (effectiveCycleName !== undefined) {
      setEditName(effectiveCycleName);
    }
    if (effectiveCycleStartDate !== undefined) {
      setEditStartDate(effectiveCycleStartDate);
    }
    setEditEndDate(effectiveCycleEndDate || "");
  }, [effectiveCycleName, effectiveCycleStartDate, effectiveCycleEndDate]);

  // Setup droppable for the entire deck (to unallocate moments from timeline)
  // Must be called unconditionally before any early returns to satisfy React hooks rules
  const cycleId = effectiveCycle?.id;
  const { setNodeRef, isOver } = useDroppable({
    id: `cycle-deck-${cycleId || "none"}`,
    data: {
      cycleId,
      targetType: "cycle-deck",
    },
  });

  // Derive virtual deck cards for the effective cycle, grouped by area.
  // Intentionally not memoized: legend-state may return a stable top-level
  // reference after nested writes, which would leave a useMemo stale and
  // the UI stuck showing outdated ghost counts after +/-/remove.
  const areasWithCards: Array<{ area: Area; cards: VirtualDeckCard[] }> =
    (() => {
      if (!effectiveCycleId) return [];
      const cards = computeVirtualDeckCards({
        cycleId: effectiveCycleId,
        plans: Object.values(plansMap),
        habits: Object.values(habitsMap),
        areas: Object.values(areasMap),
        moments: Object.values(momentsMap),
      });

      const byArea = new Map<string, VirtualDeckCard[]>();
      for (const card of cards) {
        const list = byArea.get(card.habit.areaId) ?? [];
        list.push(card);
        byArea.set(card.habit.areaId, list);
      }

      return Array.from(byArea.entries())
        .map(([areaId, list]) => ({ area: areasMap[areaId], cards: list }))
        .filter(({ area }) => Boolean(area))
        .sort((a, b) => a.area.order - b.area.order);
    })();

  // No active cycle → show only the strip (with "+ Plan new cycle") and a
  // quiet hint. No floating "Cycle Deck" container over an empty space.
  if (!activeCycle) {
    if (!isHydrated) return null;
    return (
      <div className="w-full border-t-2 border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 flex-shrink-0">
        <div className="px-6 py-4 text-center text-xs font-mono text-stone-400 dark:text-stone-500">
          no active season ·{" "}
          <button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            className="underline underline-offset-2 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
          >
            start one
          </button>
        </div>
        <CycleDeckHeatmap />
        <CycleCalendarDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
        />
      </div>
    );
  }

  const handleNameBlur = () => {
    if (!effectiveCycleId || editName.trim() === effectiveCycle?.name) return;
    cycleService.updateCycle(effectiveCycleId, { name: editName.trim() });
  };

  const handleDateBlur = () => {
    if (!effectiveCycleId) return;
    cycleService.updateCycle(effectiveCycleId, {
      startDate: editStartDate,
      endDate: editEndDate || null,
    });
  };

  const hasAnyCards = areasWithCards.some(({ cards }) =>
    cards.some((c) => c.ghosts > 0 || c.plan.budgetedCount > 0),
  );

  // Subtitle for view mode
  const isEffectiveCycleActive = effectiveCycle?.id === activeCycle?.id;
  const deckSubtitle = effectiveCycle
    ? formatCycleSubtitle(
        effectiveCycle.startDate,
        effectiveCycle.endDate,
        isEffectiveCycleActive,
      )
    : "";

  // Header with arrow navigation and action buttons
  const header = (
    <div className="px-6 py-2.5 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between cursor-default select-none">
      {/* Left side: arrow nav or inline editing */}
      <div className="flex items-center gap-2 min-w-0">
        {isEditMode && !isCollapsed ? (
          /* Edit mode: name input + date inputs */
          <div className="flex items-center gap-3 min-w-0">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="text-sm font-mono text-stone-900 dark:text-stone-100 font-semibold bg-transparent border-b border-stone-300 dark:border-stone-600 focus:border-stone-500 outline-none px-0 py-0 min-w-0"
              aria-label="Season name"
            />
            <div className="flex items-center gap-1.5 text-xs font-mono text-stone-500 flex-shrink-0">
              <input
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                onBlur={handleDateBlur}
                className="bg-transparent border-b border-stone-300 dark:border-stone-600 focus:border-stone-500 outline-none px-0 py-0 text-xs font-mono text-stone-600 dark:text-stone-400"
                aria-label="Start date"
              />
              <span className="text-stone-400">{"→"}</span>
              <input
                type="date"
                value={editEndDate}
                onChange={(e) => setEditEndDate(e.target.value)}
                onBlur={handleDateBlur}
                className="bg-transparent border-b border-stone-300 dark:border-stone-600 focus:border-stone-500 outline-none px-0 py-0 text-xs font-mono text-stone-600 dark:text-stone-400"
                aria-label="End date"
              />
            </div>
          </div>
        ) : (
          /* View mode: name + subtitle (strip above handles nav) */
          <div className="min-w-0">
            <h2 className="text-sm font-mono text-stone-900 dark:text-stone-100 font-semibold truncate leading-tight">
              {effectiveCycle?.name ?? "Pick a cycle"}
            </h2>
            {deckSubtitle && (
              <p className="text-xs font-mono text-stone-500 dark:text-stone-400 truncate leading-tight">
                {deckSubtitle}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right side: action icon buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!isCollapsed && effectiveCycle && (
          <Popover
            open={endPopoverOpen}
            onOpenChange={(open) => {
              if (open) {
                setEndCycleError(null);
                setEndDateInput(effectiveCycle.endDate ?? "");
              }
              setEndPopoverOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="p-1.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                title={
                  effectiveCycle.endDate ? "Adjust end date" : "End this season"
                }
                aria-label={
                  effectiveCycle.endDate ? "Adjust end date" : "End this season"
                }
              >
                <Flag className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-64 p-3 flex flex-col gap-3 font-mono"
            >
              <div>
                <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  {effectiveCycle.endDate ? "Season end date" : "End season"}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                  {effectiveCycle.endDate
                    ? `Adjust when “${effectiveCycle.name}” ended.`
                    : `Close “${effectiveCycle.name}”. Defaults to today, capped before the next season.`}
                </p>
              </div>
              {!effectiveCycle.endDate && (
                <button
                  type="button"
                  onClick={() => handleEndCycle()}
                  className="w-full px-3 py-2 rounded-md bg-stone-800 dark:bg-stone-100 text-stone-50 dark:text-stone-900 text-xs font-medium hover:opacity-90 active:scale-95 transition-all"
                >
                  End today
                </button>
              )}
              <div className="flex flex-col gap-2">
                <input
                  type="date"
                  value={endDateInput}
                  min={effectiveCycle.startDate}
                  onChange={(e) => {
                    setEndDateInput(e.target.value);
                    setEndCycleError(null);
                  }}
                  className="w-full px-2 py-1.5 border border-stone-300 dark:border-stone-600 rounded-md bg-white dark:bg-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-400"
                  aria-label="End date"
                />
                <button
                  type="button"
                  disabled={!endDateInput}
                  onClick={() => handleEndCycle(endDateInput)}
                  className="w-full px-3 py-1.5 rounded-md text-xs font-medium border border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {effectiveCycle.endDate
                    ? "Save end date"
                    : "End on this date"}
                </button>
              </div>
              {endCycleError && (
                <p
                  className="text-xs text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {endCycleError}
                </p>
              )}
            </PopoverContent>
          </Popover>
        )}
        {!isCollapsed && (
          <>
            <button
              type="button"
              onClick={() => setCreateDialogOpen(true)}
              className="p-1.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
              title="Plan new season"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleEditMode}
              className="p-1.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
              title={isEditMode ? "Done editing" : "Edit season deck"}
            >
              {isEditMode ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        )}
        {/* Collapse/expand toggle — always visible */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="p-1.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
          title={isCollapsed ? "Expand season deck" : "Collapse season deck"}
        >
          {isCollapsed ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );

  // Helper to render area columns content
  const renderColumns = (
    list: Array<{ area: Area; cards: VirtualDeckCard[] }>,
  ) => (
    <div className="flex gap-4 overflow-x-auto px-6 py-2 snap-x snap-mandatory scroll-smooth">
      {list.map(({ area, cards }) => (
        <CycleDeckColumn
          key={area.id}
          area={area}
          cards={cards}
          isEditMode={isEditMode}
          showAllHabits={isEditMode}
          cycleId={cycleId ?? ""}
        />
      ))}
    </div>
  );

  // In edit mode, also include areas that have habits but no plans yet,
  // so the user can ghost-add them to the budget.
  const allAreasForEdit = (() => {
    if (!isEditMode) return areasWithCards;

    const budgetedAreaIds = new Set(areasWithCards.map(({ area }) => area.id));

    const extraAreas = Object.values(areasMap)
      .filter(
        (a) =>
          !budgetedAreaIds.has(a.id) &&
          Object.values(habitsMap).some(
            (h) => h.areaId === a.id && !h.isArchived,
          ),
      )
      .sort((a, b) => a.order - b.order)
      .map((area) => ({ area, cards: [] as VirtualDeckCard[] }));

    return [...areasWithCards, ...extraAreas].sort(
      (a, b) => a.area.order - b.area.order,
    );
  })();

  // Empty state — in edit mode, show area columns with ghost cards
  if (!hasAnyCards && isEditMode && !isCollapsed) {
    const areaIdsWithHabits = new Set(
      Object.values(habitsMap)
        .filter((h) => !h.isArchived)
        .map((h) => h.areaId),
    );

    const areasToShow = Object.values(areasMap)
      .filter((a) => areaIdsWithHabits.has(a.id))
      .sort((a, b) => a.order - b.order)
      .map((area) => ({ area, cards: [] as VirtualDeckCard[] }));

    return (
      <div className="w-full border-t-2 border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 flex-shrink-0">
        {header}
        {renderColumns(areasToShow)}
        <CycleDeckHeatmap />
        <CycleCalendarDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
        />
      </div>
    );
  }

  // Empty state — read-only mode
  if (!hasAnyCards) {
    return (
      <div className="w-full border-t-2 border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 flex-shrink-0">
        {header}
        {!isCollapsed && (
          <div
            ref={setNodeRef}
            className={cn(
              "p-8 min-h-[200px] flex flex-col items-center justify-center gap-3 border-2 border-dashed mx-6 my-4 rounded-lg transition-colors",
              isOver
                ? "border-stone-400 dark:border-stone-500 bg-stone-100 dark:bg-stone-800"
                : "border-stone-300 dark:border-stone-600",
            )}
          >
            <p className="text-stone-400 text-sm font-mono text-center">
              Drag habits from the library to plan your week
            </p>
            <p className="text-xs text-stone-500 font-mono text-center">
              Or drag them back here to set aside
            </p>
          </div>
        )}
        <CycleDeckHeatmap />
        <CycleCalendarDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="w-full border-t-2 border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 flex-shrink-0">
      {header}

      {/* Droppable container for unallocating moments */}
      {!isCollapsed && (
        <div
          ref={setNodeRef}
          className={cn(
            "relative transition-colors",
            isOver && "bg-stone-100/50 dark:bg-stone-800/50",
          )}
        >
          {/* Drop indicator when dragging over */}
          {isOver && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
              <div className="border-4 border-dashed border-stone-400 dark:border-stone-500 rounded-lg absolute inset-4 bg-stone-100/30 dark:bg-stone-800/30">
                <div className="flex items-center justify-center h-full">
                  <div className="bg-stone-800/90 dark:bg-stone-200/90 text-white dark:text-stone-900 px-6 py-3 rounded-lg shadow-lg">
                    <p className="text-sm font-bold font-mono">
                      Drop here to set aside
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Horizontal scrollable columns */}
          {renderColumns(isEditMode ? allAreasForEdit : areasWithCards)}
        </div>
      )}

      <CycleDeckHeatmap />
      <CycleCalendarDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  );
}
