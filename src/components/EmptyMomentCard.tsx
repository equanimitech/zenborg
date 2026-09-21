"use client";

import { use$ } from "@legendapp/state/react";
import { Plus } from "lucide-react";
import { moments$ } from "@/infrastructure/state/store";
import { momentCard } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface EmptyMomentCardProps {
  onClick: () => void;
  label?: string;
}

/**
 * EmptyMomentCard - Explicit placeholder for creating moments
 *
 * Design:
 * - Matches MomentCard dimensions and styling
 * - Dashed border to indicate it's a placeholder
 * - Subtle hover state
 * - Plus icon to clearly indicate "add" action
 * - No more "click anywhere" magic
 *
 * Usage:
 * - Drawing board columns (when empty or after last moment)
 * - Timeline cells (when not full)
 */
export function EmptyMomentCard({
  onClick,
  label,
}: EmptyMomentCardProps) {
  const allMoments = use$(moments$);
  const defaultLabel =
    Object.keys(allMoments).length === 0
      ? "what will you give your attention to?"
      : "add moment";
  const displayLabel = label ?? defaultLabel;
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-lg cursor-pointer",
        "focus:outline-none",
        // Dashed hairline border over a tonal step. Flat at rest: no blur.
        "border-2 border-dashed border-stone-300 dark:border-stone-700",
        "bg-stone-50/50 dark:bg-stone-900/50",
        // Elastic transitions for natural feel
        "transition-all duration-medium transition-elastic",
        // Enhanced hover states
        "hover:border-stone-400 dark:hover:border-stone-600",
        "hover:bg-stone-100/50 dark:hover:bg-stone-800/50",
        "hover:-translate-y-0.5",
        // Focus states
        "focus:ring-2 focus:ring-stone-400 focus:ring-offset-2 focus:ring-offset-stone-50 dark:focus:ring-offset-stone-900",
      )}
      style={{
        minHeight: momentCard.minHeight,
        paddingLeft: momentCard.paddingX,
        paddingRight: momentCard.paddingX,
        paddingTop: momentCard.paddingY,
        paddingBottom: momentCard.paddingY,
      }}
      onClick={onClick}
      aria-label={displayLabel}
      tabIndex={0}
    >
      <div className="flex items-center justify-center h-full gap-2">
        <Plus
          className="w-4 h-4 text-stone-400 dark:text-stone-600"
          aria-hidden="true"
        />
        <p className="text-sm font-mono text-stone-400 dark:text-stone-600">
          {displayLabel}
        </p>
      </div>
    </button>
  );
}
