"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Area } from "@/domain/entities/Area";
import type { Habit } from "@/domain/entities/Habit";
import { useHabitHealth } from "@/hooks/useHabitHealth";
import { getTextColorsForBackground, momentCard } from "@/lib/design-tokens";
import { healthEmojiClass } from "@/lib/health-style";
import { cn } from "@/lib/utils";
import type { DraggableData } from "@/types/dnd";

interface VirtualDeckCardProps {
  cycleId: string;
  habit: Habit;
  area: Area;
  /** Unique index so multiple ghost slots for the same habit each have their own draggable id. */
  slotIndex: number;
  /**
   * Skip the internal draggable wiring when this card is rendered as the top
   * of a VirtualDeckStack (the stack provides its own single draggable).
   */
  asPresentational?: boolean;
}

/**
 * VirtualDeckCard — a draggable ghost slot rendered from a CyclePlan's budget.
 *
 * The card is never materialized until dropped on a timeline slot. The drag
 * payload carries `{ type: "deck-card", cycleId, habitId }` — the drop target
 * in the timeline calls `CycleService.allocateFromPlan(...)` to create a
 * concrete Moment. Until then, this card exists only in the derived view.
 */
export function VirtualDeckCard({
  cycleId,
  habit,
  area,
  slotIndex,
  asPresentational = false,
}: VirtualDeckCardProps) {
  const { health, daysSinceLast } = useHabitHealth(habit.id);
  const showDaysSinceLast =
    health === "wilting" && daysSinceLast !== null && daysSinceLast > 0;

  const dragData: DraggableData = {
    type: "deck-card",
    cycleId,
    habitId: habit.id,
  };

  const draggable = useDraggable({
    id: `deck-card-${cycleId}-${habit.id}-${slotIndex}`,
    data: dragData,
    disabled: asPresentational,
  });
  const { attributes, listeners, setNodeRef, isDragging } = draggable;

  const textColors = getTextColorsForBackground(area.color);

  return (
    <div
      ref={asPresentational ? undefined : setNodeRef}
      {...(asPresentational ? {} : attributes)}
      {...(asPresentational ? {} : listeners)}
      data-testid="deck-card"
      data-habit-id={habit.id}
      data-cycle-id={cycleId}
      data-draggable={asPresentational ? undefined : "true"}
      className={cn(
        "rounded-lg w-full",
        !asPresentational && "cursor-grab",
        "flex flex-row items-center gap-2",
        "transition-opacity",
        "opacity-90",
        !asPresentational && "hover:opacity-100",
        isDragging && "opacity-50 cursor-grabbing",
      )}
      style={{
        backgroundColor: area.color,
        minHeight: momentCard.minHeight,
        paddingLeft: momentCard.paddingX,
        paddingRight: momentCard.paddingX,
        paddingTop: momentCard.paddingY,
        paddingBottom: momentCard.paddingY,
        // @ts-expect-error - CSS custom property
        "--tw-ring-color": `${area.color}99`,
      }}
    >
      {habit.emoji && (
        <span
          className={cn(
            "mr-2 text-lg",
            textColors.primary,
            healthEmojiClass(health),
          )}
        >
          {habit.emoji}
        </span>
      )}
      <span
        className={cn(
          "text-lg font-semibold font-mono truncate flex-1 min-w-0",
          textColors.primary,
        )}
      >
        {habit.name}
      </span>
      {showDaysSinceLast && (
        <span
          className={cn(
            "text-xs font-mono opacity-60 shrink-0",
            textColors.primary,
          )}
          aria-label={`${daysSinceLast} days since last allocation`}
        >
          ·{daysSinceLast}d
        </span>
      )}
    </div>
  );
}
