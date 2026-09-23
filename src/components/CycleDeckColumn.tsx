"use client";

import { useValue } from "@legendapp/state/react";
import { CycleService } from "@/application/services/CycleService";
import { AreaSwatch } from "@/components/AreaSwatch";
import type { Area } from "@/domain/entities/Area";
import { habits$ } from "@/infrastructure/state/store";
import type { VirtualDeckCard as VirtualDeckCardData } from "@/infrastructure/state/virtualDeckCards";
import { columnWidth } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { GhostHabitCard } from "./GhostHabitCard";
import { VirtualDeckStack } from "./VirtualDeckStack";

/**
 * CycleDeckColumn - Single vertical column for an area in the cycle deck.
 *
 * Derive paradigm: displays virtual deck cards computed from CyclePlans.
 * Each budgeted habit renders one VirtualDeckCard per ghost slot
 * (budgetedCount minus allocatedCount).
 *
 * In edit mode, also shows:
 *  - +/- controls per budgeted habit to adjust budget
 *  - GhostHabitCard for unbudgeted habits in this area
 */
interface CycleDeckColumnProps {
  area: Area;
  cards: VirtualDeckCardData[];
  isEditMode: boolean;
  showAllHabits: boolean;
  cycleId: string;
}

export function CycleDeckColumn({
  area,
  cards,
  isEditMode,
  showAllHabits,
  cycleId,
}: CycleDeckColumnProps) {
  const allHabits = useValue(habits$);
  const cycleService = new CycleService();

  const budgetedHabitIds = new Set(cards.map((c) => c.habit.id));

  // In showAllHabits mode, also list unbudgeted habits for this area
  // (rendered as GhostHabitCard after the budgeted cards).
  const unbudgetedHabitIds = showAllHabits
    ? Object.values(allHabits)
        .filter(
          (h) =>
            h.areaId === area.id &&
            !h.isArchived &&
            !budgetedHabitIds.has(h.id),
        )
        .sort((a, b) => a.order - b.order)
        .map((h) => h.id)
    : [];

  const totalGhosts = cards.reduce((sum, c) => sum + c.ghosts, 0);

  return (
    <div
      className={cn(
        "flex flex-col snap-start rounded-lg",
        columnWidth.scrollableClassName,
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">
            {area.emoji || <AreaSwatch color={area.color} />}
          </span>
          <h3 className="text-sm font-mono font-medium text-stone-700 dark:text-stone-300">
            {area.name}
          </h3>
          <span className="text-xs font-mono text-stone-400 dark:text-stone-500">
            {totalGhosts}
          </span>
        </div>
      </div>

      {/* Colored Divider */}
      <div
        className="h-[3px] mx-4 mb-2"
        style={{ backgroundColor: area.color }}
      />

      {/* Column Content */}
      <div className="flex flex-col gap-3 p-3 min-h-[80px] max-h-[280px] overflow-y-auto">
        {cards.map((card) => (
          <VirtualDeckStack
            key={card.plan.id}
            cycleId={cycleId}
            habit={card.habit}
            area={area}
            count={card.ghosts}
            onIncrement={
              isEditMode
                ? () =>
                    cycleService.incrementHabitBudget(cycleId, card.habit.id)
                : undefined
            }
            onDecrement={
              isEditMode && card.plan.budgetedCount > 1
                ? () =>
                    cycleService.decrementHabitBudget(cycleId, card.habit.id)
                : undefined
            }
            onRemove={
              isEditMode && card.plan.budgetedCount <= 1
                ? () => cycleService.removeHabitFromDeck(cycleId, card.habit.id)
                : undefined
            }
          />
        ))}

        {/* Unbudgeted habits as ghost cards (edit mode) */}
        {unbudgetedHabitIds.map((habitId) => (
          <GhostHabitCard
            key={habitId}
            habitId={habitId}
            area={area}
            cycleId={cycleId}
          />
        ))}
      </div>
    </div>
  );
}
