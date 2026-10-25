"use client";

import { use$ } from "@legendapp/state/react";
import type { Area } from "@/domain/entities/Area";
import type { Moment } from "@/domain/entities/Moment";
import { staleReason, wakingDayKey } from "@/domain/attention/ActiveMoment";
import { useActiveMoment } from "@/hooks/useActiveMoment";
import { useHabitHealth } from "@/hooks/useHabitHealth";
import { useSelection } from "@/hooks/useSelection";
import { phaseConfigs$ } from "@/infrastructure/state/store";
import { openMomentFormEdit } from "@/infrastructure/state/ui-store";
import { getTextColorsForBackground, momentCard } from "@/lib/design-tokens";
import { healthEmojiClass } from "@/lib/health-style";
import { cn } from "@/lib/utils";
import { MentionSummary } from "./MentionSummary";
import { TagSummary } from "./TagSummary";

interface MomentCardProps {
  moment: Moment;
  area: Area;
  /** Optional array of all moment IDs in the current context (for shift-click range selection) */
  contextMomentIds?: string[];
}

/**
 * MomentCard - Display card for a moment
 *
 * Design:
 * - Minimalist, calm aesthetic
 * - Full area-colored background with accessible text
 * - Subtle colored ring (area color @ 60% opacity) for selection/focus
 * - 1px ring offset for breathing room
 *
 * Interaction flow:
 * 1. Single click → Opens MomentEditCard modal
 * 2. Cmd/Ctrl + click → Toggle selection (shows ring)
 * 3. Shift + click → Range selection from last selected to current (if contextMomentIds provided)
 * 4. Alt/Option + click → Make this the active moment — the intention keel reads
 *    and surfaces in every Claude Code session. Alt-clicking the active one releases it.
 * 5. Hover → Shows subtle 1px ring
 * 6. Selected → Shows prominent 2px ring in area color
 * 7. Active → Shows a ◎ marker (the same glyph keel puts in its HUD)
 *
 * Features:
 * - Multi-select for bulk operations
 * - Range selection with Shift+click (within same column/context)
 * - Toggle selection with Cmd/Ctrl+click
 * - Calm, minimalist design with color-matched rings
 * - Full accessibility with ARIA labels
 */
export function MomentCard({
  moment,
  area,
  contextMomentIds,
}: MomentCardProps) {
  const {
    isSelected: isSelectedMoment,
    toggleSelection,
    selectRange,
  } = useSelection();
  const allPhaseConfigs = use$(phaseConfigs$);
  const { activeMomentId, toggleActive } = useActiveMoment();

  const isSelected = isSelectedMoment(moment.id);
  // A pointer to a moment off today's board is stale: shown as none.
  const isActive =
    activeMomentId === moment.id && !staleReason(moment, wakingDayKey());

  // Health-based emoji treatment (opacity) — "unstated" when no habit link
  const { health } = useHabitHealth(moment.habitId ?? "");

  const handleClick = (e: React.MouseEvent) => {
    // Shift + click → Range selection (if contextMomentIds provided)
    if (e.shiftKey) {
      e.preventDefault();
      if (contextMomentIds && contextMomentIds.length > 0) {
        selectRange(moment.id, contextMomentIds);
      } else {
        toggleSelection(moment.id);
      }
    }
    // Cmd/Ctrl + click → Toggle selection
    else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelection(moment.id);
    }
    // Alt/Option + click → Make this the intention (or release it)
    else if (e.altKey) {
      e.preventDefault();
      void toggleActive(moment.id);
    }
    // Regular click → Open global edit modal
    else {
      openMomentFormEdit(moment.id, moment);
    }
  };

  // Get accessible text colors based on area color
  const textColors = getTextColorsForBackground(area.color);

  // Get phase config for displaying emoji
  const _phaseConfig = moment.phase
    ? Object.values(allPhaseConfigs).find((pc) => pc.phase === moment.phase)
    : null;

  // Descriptive ARIA label for accessibility
  const activeSuffix = isActive ? ", active moment" : "";
  const ariaLabel = isSelected
    ? `${moment.name} in ${area.name} area, selected${activeSuffix}`
    : `${moment.name} in ${area.name} area${activeSuffix}, click to edit`;

  return (
    <button
      type="button"
      className={cn(
        "rounded-lg cursor-pointer w-full",
        "focus:outline-none relative",
        "transition-[translate,box-shadow,border-color] duration-150 ease-out",
        "outline-none",
        // Subtle lift on hover for depth
        "hover:-translate-y-0.5",
        // Active moment: inset left border as a strong visual anchor
        isActive && "border-l-[3px] border-l-stone-900 dark:border-l-stone-100",
      )}
      style={{
        backgroundColor: area.color,
        minHeight: momentCard.minHeight,
        paddingLeft: momentCard.paddingX,
        paddingRight: momentCard.paddingX,
        paddingTop: momentCard.paddingY,
        paddingBottom: momentCard.paddingY,
        // Inset shadow for hover/selection -- lives inside the card, never clipped
        boxShadow: isSelected
          ? `inset 0 0 0 2px rgba(255,255,255,0.5)`
          : undefined,
      }}
      data-moment-id={moment.id}
      onClick={handleClick}
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <div className="flex flex-row items-baseline gap-2 h-full">
        {moment.emoji && (
          <span
            className={cn(
              "mr-2 text-lg",
              textColors.primary,
              healthEmojiClass(health),
            )}
          >
            {moment.emoji}
          </span>
        )}
        <p
          className={cn(
            "text-lg font-semibold font-mono truncate min-w-0",
            textColors.primary,
          )}
        >
          {moment.name}
        </p>
        <MentionSummary
          personIds={moment.personIds}
          placeIds={moment.placeIds}
          className={cn("flex-shrink-0", textColors.primary)}
        />
        <TagSummary
          tags={moment.tags}
          className={cn("flex-shrink-0", textColors.primary)}
        />
        {moment.startTime && (
          <span
            className={cn(
              "ml-1 text-xs font-mono flex-shrink-0",
              textColors.secondary,
            )}
          >
            {moment.startTime}
          </span>
        )}
        {isActive && (
          <span
            className={cn("ml-auto text-sm flex-shrink-0", textColors.primary)}
            title="Active moment"
          >
            ◎
          </span>
        )}
      </div>
    </button>
  );
}
