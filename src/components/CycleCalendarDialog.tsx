"use client";

import { useValue } from "@legendapp/state/react";
import { addMonths, format, startOfMonth } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { CycleService } from "@/application/services/CycleService";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Cycle } from "@/domain/entities/Cycle";
import { cycles$ } from "@/infrastructure/state/store";
import { cycleDeckSelectedCycleId$ } from "@/infrastructure/state/ui-store";
import { formatCycleDateRange, fromISODate, toISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface CycleCalendarDialogProps {
  open: boolean;
  onClose: () => void;
}

const MONTHS_BEFORE = 3;
const MONTHS_AFTER = 6;
const SCROLL_THRESHOLD_PX = 400;

/**
 * CycleCalendarDialog — drag a date range on a scrollable month grid to
 * create a new cycle. Existing cycles render as bands so overlaps are
 * visible and prevented. Name prompts inline on release; intention is
 * deferred to a later planning session.
 */
export function CycleCalendarDialog({
  open,
  onClose,
}: CycleCalendarDialogProps) {
  const cycleService = useMemo(() => new CycleService(), []);
  const allCyclesMap = useValue(() => cycles$.get());

  const [anchorMonth, setAnchorMonth] = useState(() =>
    startOfMonth(new Date()),
  );
  const [monthsBack, setMonthsBack] = useState(MONTHS_BEFORE);
  const [monthsAhead, setMonthsAhead] = useState(MONTHS_AFTER);

  // Drag selection state
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Name prompt on release
  const [promptRange, setPromptRange] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);

  const cycles = Object.values(allCyclesMap);

  // Reset and scroll to today when opening
  useEffect(() => {
    if (!open) return;
    setAnchorMonth(startOfMonth(new Date()));
    setMonthsBack(MONTHS_BEFORE);
    setMonthsAhead(MONTHS_AFTER);
    setDragStart(null);
    setDragEnd(null);
    setIsDragging(false);
    setPromptRange(null);
    setNameDraft("");
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // After render, scroll today's month into view
    const t = setTimeout(() => {
      if (todayRef.current && scrollRef.current) {
        scrollRef.current.scrollTo({
          top: todayRef.current.offsetTop - 24,
          behavior: "instant" as ScrollBehavior,
        });
      }
    }, 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!promptRange) return;
    const t = setTimeout(() => nameInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [promptRange]);

  const months = useMemo(() => {
    const result: Date[] = [];
    for (let i = -monthsBack; i <= monthsAhead; i++) {
      result.push(addMonths(anchorMonth, i));
    }
    return result;
  }, [anchorMonth, monthsBack, monthsAhead]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < SCROLL_THRESHOLD_PX) {
      setMonthsBack((n) => n + 3);
    }
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight <
      SCROLL_THRESHOLD_PX
    ) {
      setMonthsAhead((n) => n + 3);
    }
  };

  const selectedRange = computeSelectedRange(dragStart, dragEnd);
  const todayISO = toISODate(new Date());

  const handlePointerDownOnDay = (dayISO: string) => {
    if (findCycleContainingDay(cycles, dayISO)) return; // can't start inside existing cycle
    setDragStart(dayISO);
    setDragEnd(dayISO);
    setIsDragging(true);
    setPromptRange(null);
    setFormError(null);
  };

  const handlePointerEnterDay = (dayISO: string) => {
    if (!isDragging) return;
    setDragEnd(dayISO);
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (!selectedRange) return;

    // Validate: no existing cycle within the selected range
    const conflict = findCycleOverlappingRange(
      cycles,
      selectedRange.startDate,
      selectedRange.endDate,
    );
    if (conflict) {
      setDragStart(null);
      setDragEnd(null);
      setFormError(
        `Range overlaps "${conflict.name}" (${formatCycleDateRange(
          conflict.startDate,
          conflict.endDate,
        )})`,
      );
      return;
    }

    setPromptRange(selectedRange);
  };

  const handleCreate = () => {
    if (!promptRange) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setFormError("Name the season to create it");
      return;
    }

    const result = cycleService.planCycle(
      trimmed,
      undefined,
      promptRange.startDate,
      promptRange.endDate,
    );

    if ("error" in result) {
      setFormError(result.error);
      return;
    }

    // Active cycle is derived from dates — no explicit activate step.
    // A cycle whose range covers today becomes active automatically.
    cycleDeckSelectedCycleId$.set(result.id);
    setPromptRange(null);
    setDragStart(null);
    setDragEnd(null);
    setNameDraft("");
    setFormError(null);
    onClose();
  };

  const handleCancelPrompt = () => {
    setPromptRange(null);
    setDragStart(null);
    setDragEnd(null);
    setNameDraft("");
    setFormError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0 h-[85vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-stone-200 dark:border-stone-700">
          <DialogTitle className="text-sm font-mono font-medium text-stone-700 dark:text-stone-300">
            Plan a season — drag across days to paint a range
          </DialogTitle>
          {formError && (
            <p
              className="mt-2 text-xs font-mono text-red-600 dark:text-red-400"
              role="alert"
            >
              {formError}
            </p>
          )}
        </DialogHeader>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="flex-1 overflow-y-auto px-6 py-4 select-none"
        >
          {months.map((monthDate) => (
            <MonthGrid
              key={toISODate(monthDate)}
              monthDate={monthDate}
              cycles={cycles}
              todayISO={todayISO}
              selectedRange={selectedRange}
              onPointerDownDay={handlePointerDownOnDay}
              onPointerEnterDay={handlePointerEnterDay}
              todayRef={
                monthContainsDate(monthDate, todayISO) ? todayRef : undefined
              }
            />
          ))}
        </div>

        {promptRange && (
          <div className="border-t border-stone-200 dark:border-stone-700 px-6 py-4 flex flex-col gap-3 bg-stone-50 dark:bg-stone-900">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-mono text-stone-600 dark:text-stone-400">
                {formatCycleDateRange(
                  promptRange.startDate,
                  promptRange.endDate,
                )}
              </p>
              <button
                type="button"
                onClick={handleCancelPrompt}
                className="text-xs font-mono text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              >
                Cancel
              </button>
            </div>
            <div className="flex gap-2">
              <input
                ref={nameInputRef}
                type="text"
                value={nameDraft}
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  setFormError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleCancelPrompt();
                  }
                }}
                placeholder="Name this chapter (e.g. Paris, Vipassana, Focus week)"
                className="flex-1 px-3 py-2 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-sm font-mono text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-400"
                aria-label="Season name"
              />
              <button
                type="button"
                onClick={handleCreate}
                className="px-4 py-2 rounded-md bg-stone-800 dark:bg-stone-100 text-stone-50 dark:text-stone-900 text-sm font-mono font-medium hover:opacity-90 active:scale-95 transition-all"
              >
                Create season
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function computeSelectedRange(
  start: string | null,
  end: string | null,
): { startDate: string; endDate: string } | null {
  if (!start || !end) return null;
  if (start <= end) return { startDate: start, endDate: end };
  return { startDate: end, endDate: start };
}

function findCycleContainingDay(cycles: Cycle[], dayISO: string): Cycle | null {
  for (const cycle of cycles) {
    const start = cycle.startDate;
    const end = cycle.endDate ?? dayISO; // ongoing → treat as ending today or later
    if (dayISO > start && dayISO < end) return cycle;
    if (dayISO === start && cycle.endDate && dayISO !== cycle.endDate) {
      return cycle;
    }
    if (cycle.endDate === null && dayISO >= start) return cycle;
  }
  return null;
}

function findCycleOverlappingRange(
  cycles: Cycle[],
  startDate: string,
  endDate: string,
): Cycle | null {
  for (const cycle of cycles) {
    const cStart = cycle.startDate;
    const cEnd = cycle.endDate ?? "9999-12-31";
    // Strict overlap: share any interior day (touching endpoints allowed)
    if (startDate < cEnd && endDate > cStart) return cycle;
  }
  return null;
}

function monthContainsDate(monthDate: Date, dateISO: string): boolean {
  const d = fromISODate(dateISO);
  return (
    d.getFullYear() === monthDate.getFullYear() &&
    d.getMonth() === monthDate.getMonth()
  );
}

interface MonthGridProps {
  monthDate: Date;
  cycles: Cycle[];
  todayISO: string;
  selectedRange: { startDate: string; endDate: string } | null;
  onPointerDownDay: (dayISO: string) => void;
  onPointerEnterDay: (dayISO: string) => void;
  todayRef?: React.RefObject<HTMLDivElement | null>;
}

function MonthGrid({
  monthDate,
  cycles,
  todayISO,
  selectedRange,
  onPointerDownDay,
  onPointerEnterDay,
  todayRef,
}: MonthGridProps) {
  const monthStart = startOfMonth(monthDate);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  // ISO week starts Monday. Shift so Monday = 0.
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<{ date: Date | null; iso: string | null }> = [];
  for (let i = 0; i < firstDayOffset; i++) {
    cells.push({ date: null, iso: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ date, iso: toISODate(date) });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, iso: null });
  }

  return (
    <div ref={todayRef} className="mb-6">
      <h3 className="text-sm font-mono font-semibold text-stone-700 dark:text-stone-300 mb-2">
        {format(monthDate, "MMMM yyyy")}
      </h3>
      <div className="grid grid-cols-7 gap-px bg-stone-200 dark:bg-stone-700 rounded-md overflow-hidden text-xs font-mono">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: weekday initials repeat, so position is the identity
            key={`${d}-${i}`}
            className="bg-stone-50 dark:bg-stone-900 text-stone-500 dark:text-stone-400 py-1 text-center"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell.iso || !cell.date) {
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: leading blanks in a calendar grid have no identity but position
                key={`blank-${i}`}
                className="bg-stone-50 dark:bg-stone-900/50 h-14"
              />
            );
          }
          const iso = cell.iso;
          const containingCycle = findCycleContainingDay(cycles, iso);
          const inSelection =
            selectedRange &&
            iso >= selectedRange.startDate &&
            iso <= selectedRange.endDate;
          const isToday = iso === todayISO;

          return (
            <button
              key={iso}
              type="button"
              onPointerDown={(e) => {
                if (containingCycle) return;
                e.preventDefault();
                onPointerDownDay(iso);
              }}
              onPointerEnter={() => onPointerEnterDay(iso)}
              disabled={Boolean(containingCycle)}
              title={containingCycle ? containingCycle.name : undefined}
              className={cn(
                "h-14 text-left px-2 py-1 transition-colors touch-none",
                "bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200",
                containingCycle &&
                  "bg-stone-100 dark:bg-stone-700/40 text-stone-400 dark:text-stone-500 cursor-not-allowed",
                inSelection &&
                  "bg-stone-300 dark:bg-stone-200/90 text-stone-900 dark:text-stone-900",
                isToday && !inSelection && "ring-1 ring-stone-400 ring-inset",
              )}
            >
              <div className="text-xs font-semibold">{cell.date.getDate()}</div>
              {containingCycle && (
                <div className="text-[9px] truncate opacity-80">
                  {containingCycle.name}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
