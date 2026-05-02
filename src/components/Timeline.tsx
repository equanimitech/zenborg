"use client";

import { use$ } from "@legendapp/state/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "@/domain/value-objects/Phase";
import {
  currentPhase$,
  timeTick$,
  visiblePhases$,
} from "@/infrastructure/state/store";
import { selectedDay$ } from "@/infrastructure/state/ui-store";
import {
  fromISODate,
  getDateLabel,
  getExtendedTimelineDays,
  getTodayISO,
} from "@/lib/dates";
import { columnWidth } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import { DayHeaderTitle } from "./DayHeaderTitle";
import { TimelineCell } from "./TimelineCell";

/**
 * DayRow - A single day row in the timeline
 */
interface DayRowProps {
  day: string;
  isToday: boolean;
  isActiveDay: boolean;
  isPastDay: boolean;
  visiblePhases: Array<{ phase: Phase }>;
  currentPhase: Phase | null;
}

const DayRow = forwardRef<HTMLDivElement, DayRowProps>(
  ({ day, isActiveDay, isPastDay, visiblePhases, currentPhase }, ref) => {
    const { dayOfWeek, monthDay } = formatDateShort(day);
    const label = getDateLabel(day);

    useEffect(() => {
      console.log(`Rendering DayRow for ${day} (${label})`);
      console.debug("visiblePhases:", visiblePhases);
    }, [day, label, visiblePhases]);

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col",
          // Minimal padding
          "scroll-ml-2 md:scroll-ml-6",
          "gap-1.5 px-2 py-2 md:px-4 md:py-4",
          // Smooth opacity transitions for past days
          "transition-opacity duration-medium transition-smooth",
          isActiveDay
            ? "snap-start snap-always border border-slate-400/30 dark:ring-slate-300 rounded-md shadow-sm"
            : "snap-start",
          isPastDay && "opacity-70",
        )}
      >
        {/* Day Title Section - Above Timeline */}
        <div className="flex flex-row items-baseline gap-2 px-1 py-0.5">
          <DayHeaderTitle
            day={day}
            fallbackLabel={label}
            isActiveDay={isActiveDay}
          />
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-stone-500 dark:text-stone-400 text-base md:text-lg">
              {dayOfWeek}
            </span>
            <span className="text-stone-400 dark:text-stone-500 font-mono text-sm md:text-base">
              {monthDay}
            </span>
          </div>
        </div>

        {/* Phase Sections - Horizontal Flow */}
        <div className="flex gap-1.5 md:gap-2 overflow-x-auto scrollbar-hide">
          {visiblePhases.map((phaseConfig, index) => {
            return (
              <div
                key={phaseConfig.phase}
                className={cn("flex flex-col", columnWidth.scrollableClassName)}
              >
                {/* Phase Cell - Height based on 3 cards (64px each) + 2 gaps (12px each) + padding */}
                <div className="p-0.5 md:p-1">
                  <TimelineCell
                    day={day}
                    phase={phaseConfig.phase}
                    isHighlighted={isActiveDay}
                    isActivePhase={
                      isActiveDay && phaseConfig.phase === currentPhase
                    }
                    phaseIndex={index}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

DayRow.displayName = "DayRow";

// Helper to format date as "Mon 12/25"
const formatDateShort = (dateStr: string) => {
  const date = fromISODate(dateStr);
  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
  return { dayOfWeek, monthDay };
};

/**
 * Timeline - DayRow-based timeline layout with extended days
 *
 * Layout:
 * - Each day is a horizontal row
 * - Vertical scroll with snap behavior (Today has stronger snap)
 * - Days before viewport have reduced opacity with transition
 * - Today is always front and center on load
 *
 * Design:
 * - Day titles are large and prominent
 * - Phase labels removed (icons only with darker colors)
 * - Progressive slate gradient backgrounds
 * - Smooth scroll snapping to days (Today has magnetic pull)
 */
export function Timeline() {
  const visiblePhases = use$(visiblePhases$);
  const currentPhase = use$(currentPhase$) as Phase | null;
  // Subscribe to timeTick$ so getExtendedTimelineDays recalculates on tick
  use$(timeTick$);
  const selectedDay = use$(selectedDay$);
  const [daysBefore, setDaysBefore] = useState(1);
  const [daysAfter, setDaysAfter] = useState(1);
  const timelineDays = getExtendedTimelineDays(daysBefore, daysAfter);
  const containerRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [isReady, setIsReady] = useState(false);

  const handleLoadEarlier = () => {
    setDaysBefore((prev) => prev + 3);
  };

  const handleLoadLater = () => {
    setDaysAfter((prev) => prev + 3);
  };

  const isExpanded = daysBefore > 1 || daysAfter > 1;

  // Scroll to calendar today (not active day — active day can shift to
  // yesterday before morning starts, which would surprise users opening the
  // app early in the morning).
  const scrollToToday = useCallback(() => {
    if (todayRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        todayRef.current?.scrollIntoView({
          behavior: "instant",
          inline: "start",
          block: "nearest",
        });

        // Fade in after scroll completes
        setIsReady(true);
      });
    }
  }, []);

  // Ensure today is scrolled into view on mount (skip if a day is already selected)
  useEffect(() => {
    if (selectedDay$.peek()) {
      setIsReady(true);
      return;
    }
    const timeout = setTimeout(scrollToToday, 200);
    return () => clearTimeout(timeout);
  }, [scrollToToday]);

  // Re-scroll to today and recalculate time on window focus
  useEffect(() => {
    const handleFocus = () => {
      timeTick$.set((t) => t + 1);
      if (!selectedDay$.peek()) scrollToToday();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [scrollToToday]);

  // Auto-expand the rendered range to include selectedDay, then scroll to it.
  // When selectedDay returns to today, collapse the range back to default.
  useEffect(() => {
    if (!selectedDay) return;
    const today = getTodayISO();
    if (selectedDay === today) {
      setDaysBefore((prev) => (prev > 1 ? 1 : prev));
      setDaysAfter((prev) => (prev > 1 ? 1 : prev));
      return;
    }
    const ms =
      fromISODate(selectedDay).getTime() - fromISODate(today).getTime();
    const dayDiff = Math.round(ms / 86_400_000);
    if (dayDiff < 0) {
      const need = -dayDiff;
      setDaysBefore((prev) => (prev < need ? need : prev));
    } else if (dayDiff > 0) {
      setDaysAfter((prev) => (prev < dayDiff ? dayDiff : prev));
    }
  }, [selectedDay]);

  // Scroll the selected day into view once it's rendered.
  useEffect(() => {
    if (!selectedDay) return;
    requestAnimationFrame(() => {
      dayRefs.current[selectedDay]?.scrollIntoView({
        behavior: "smooth",
        inline: "start",
        block: "nearest",
      });
    });
  }, [selectedDay, daysBefore, daysAfter]);

  // Tick every 60s so phase transitions happen even if app stays open
  useEffect(() => {
    const interval = setInterval(() => {
      timeTick$.set((t) => t + 1);
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Find active day's index to determine which days are past
  const activeDayIndex = timelineDays.findIndex((d) => d.isActiveDay);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div
        ref={containerRef}
        className={cn(
          "w-full h-full flex items-center overflow-x-scroll snap-x snap-mandatory scroll-smooth scrollbar-hide",
          // Minimal gap and padding on left/top, safe area padding on right
          "gap-3 md:gap-4 px-2 md:px-4 py-2 md:py-4",
          // Smooth fade-in on load
          "transition-opacity duration-slow transition-smooth",
          isReady ? "opacity-100" : "opacity-0",
        )}
        style={{
          // Enable momentum scrolling on iOS/Safari
          WebkitOverflowScrolling: "touch",
          // Ensure right padding includes safe area (bottom in landscape)
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        {/* Load Earlier Button */}
        <button
          type="button"
          onClick={handleLoadEarlier}
          className={cn(
            "flex-shrink-0 flex flex-col items-center justify-center gap-1",
            "px-3 py-4 rounded-md",
            "text-stone-400 dark:text-stone-500",
            "hover:text-stone-600 dark:hover:text-stone-400",
            "hover:bg-stone-100 dark:hover:bg-stone-800",
            "transition-colors font-mono text-xs",
            "min-w-[60px]",
          )}
          aria-label="Load 3 earlier days"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Earlier</span>
        </button>

        {timelineDays.map(({ date, isToday, isActiveDay }, index) => (
          <DayRow
            key={date}
            ref={(el) => {
              dayRefs.current[date] = el;
              if (isToday) todayRef.current = el;
            }}
            day={date}
            isToday={isToday}
            isActiveDay={isActiveDay}
            isPastDay={index < activeDayIndex}
            visiblePhases={visiblePhases}
            currentPhase={currentPhase}
          />
        ))}

        {/* Load Later Button */}
        <button
          type="button"
          onClick={handleLoadLater}
          className={cn(
            "flex-shrink-0 flex flex-col items-center justify-center gap-1",
            "px-3 py-4 rounded-md",
            "text-stone-400 dark:text-stone-500",
            "hover:text-stone-600 dark:hover:text-stone-400",
            "hover:bg-stone-100 dark:hover:bg-stone-800",
            "transition-colors font-mono text-xs",
            "min-w-[60px]",
          )}
          aria-label="Load 3 later days"
        >
          <ChevronRight className="w-4 h-4" />
          <span>Later</span>
        </button>
      </div>
    </div>
  );
}
