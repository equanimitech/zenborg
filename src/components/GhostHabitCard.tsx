"use client";

import { useValue } from "@legendapp/state/react";
import { ChevronUp, X } from "lucide-react";
import { CycleService } from "@/application/services/CycleService";
import type { Area } from "@/domain/entities/Area";
import { useHabitHealth } from "@/hooks/useHabitHealth";
import { habits$ } from "@/infrastructure/state/store";
import { healthEmojiClass } from "@/lib/health-style";
import { cn } from "@/lib/utils";

/**
 * GhostHabitCard - Dashed card for unbudgeted habits in edit mode
 *
 * Shows a faded, dashed-border card with a badge to add the habit
 * to the current cycle budget.
 */
interface GhostHabitCardProps {
  habitId: string;
  area: Area;
  cycleId: string;
}

export function GhostHabitCard({ habitId, area, cycleId }: GhostHabitCardProps) {
  const allHabits = useValue(habits$);
  const habit = allHabits[habitId];
  const cycleService = new CycleService();
  const { health } = useHabitHealth(habitId);

  if (!habit) return null;

  const handleAdd = () => {
    cycleService.incrementHabitBudget(cycleId, habitId);
  };

  return (
    <div
      data-testid={`ghost-card-${habitId}`}
      className="relative opacity-40 w-full"
      style={{ paddingTop: "8px" }}
    >
      <div className="relative" style={{ zIndex: 1 }}>
        <div
          className="rounded-lg border-2 border-dashed p-3 min-h-[64px] flex items-center gap-2"
          style={{ borderColor: area.color }}
        >
          {habit.emoji && (
            <span className={cn("text-sm", healthEmojiClass(health))}>
              {habit.emoji}
            </span>
          )}
          <span className="text-sm font-mono font-medium text-stone-500 dark:text-stone-400 truncate">
            {habit.name}
          </span>
        </div>

        {/* Badge: [x] x0 [+] */}
        <div
          className="absolute -top-2 -right-2 rounded-md bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 text-xs font-mono font-medium shadow-sm flex items-center gap-0.5 px-1 py-0.5"
          style={{ zIndex: 2 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="p-0.5 rounded opacity-30 cursor-default"
            disabled
          >
            <X className="h-3 w-3" />
          </button>
          <span className="px-1">x0</span>
          <button
            type="button"
            onClick={handleAdd}
            className="p-0.5 rounded hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors"
            title="Add to cycle"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
