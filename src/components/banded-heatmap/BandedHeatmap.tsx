/** biome-ignore-all lint/a11y/noStaticElementInteractions: heatmap is a custom interactive surface (drag/pan/resize), not a standard control */
/** biome-ignore-all lint/a11y/noNoninteractiveTabindex: scroll container needs tabIndex=0 to receive keyboard focus for arrow-key navigation */
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Area } from "@/domain/entities/Area";
import type { CreateCycleProps, Cycle } from "@/domain/entities/Cycle";
import type { Moment } from "@/domain/entities/Moment";
import type { PhaseConfig } from "@/domain/value-objects/Phase";
import {
  deriveBandedHeatmapViewModel,
  type HeatmapViewModel,
} from "@/infrastructure/state/bandedHeatmapViewModel";
import { phaseBackgrounds } from "@/lib/design-tokens";
import { BandedHeatmapAxis } from "./BandedHeatmapAxis";
import { BandedHeatmapCreateDraft } from "./BandedHeatmapCreateDraft";
import { BandedHeatmapCreatePopup } from "./BandedHeatmapCreatePopup";
import { BandedHeatmapCycleBlock } from "./BandedHeatmapCycleBlock";
import { BandedHeatmapGapSegment } from "./BandedHeatmapGapSegment";
import { BandedHeatmapNeedle } from "./BandedHeatmapNeedle";
import { BandedHeatmapSelectionCursor } from "./BandedHeatmapSelectionCursor";
import {
  BRACKET_HEIGHT,
  CELL_GAP,
  CELL_SIZE,
  HEATMAP_HEIGHT,
  ROW_GAP,
  STRIDE,
  VERTICAL_PADDING,
} from "./constants";

const DRAG_THRESHOLD_PX = 4;
const KEEP_ON_SCREEN_PADDING = STRIDE * 2;
// Tailwind `gap-x-1` between segments — must match the value on the segments
// flex row below. Segment offsets accumulate this between segments.
const SEGMENT_FLEX_GAP_PX = 4;

interface BandedHeatmapProps {
  cycles: Cycle[];
  moments: Moment[];
  areas: Area[];
  phaseConfigs: PhaseConfig[];
  today: string;
  selectedCycleId?: string | null;
  /** Controlled selection. Required for the cursor to render anywhere. */
  selectedDay?: string | null;
  onCycleSelect?: (cycleId: string) => void;
  onDaySelect?: (date: string) => void;
  onCycleCreate?: (props: CreateCycleProps) => void;
}

/**
 * Pure, controlled heatmap. Selection lives in `selectedDay` (parent owns it
 * via an observable). The component never holds its own selection state and
 * never writes-back implicitly — callbacks fire only from explicit user
 * actions (click, keyboard, drag-to-select). Structurally loop-proof.
 */
export function BandedHeatmap({
  cycles,
  moments,
  areas,
  phaseConfigs,
  today,
  selectedCycleId,
  selectedDay,
  onCycleSelect,
  onDaySelect,
  onCycleCreate,
}: BandedHeatmapProps) {
  const vm: HeatmapViewModel = useMemo(
    () =>
      deriveBandedHeatmapViewModel({
        cycles,
        moments,
        areas,
        phaseConfigs,
        today,
      }),
    [cycles, moments, areas, phaseConfigs, today],
  );

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const dayX = useMemo(() => {
    const out = new Array<number>(vm.days.length);
    let x = 0;
    for (const seg of vm.segments) {
      const count = seg.endIndex - seg.startIndex + 1;
      for (let j = 0; j < count; j++) {
        out[seg.startIndex + j] = x;
        x += STRIDE;
      }
      x += SEGMENT_FLEX_GAP_PX - CELL_GAP;
    }
    return out;
  }, [vm.segments, vm.days.length]);

  const totalRenderedWidth = useMemo(() => {
    if (vm.segments.length === 0 || dayX.length === 0) return 0;
    const last = vm.segments[vm.segments.length - 1];
    return dayX[last.endIndex] + STRIDE;
  }, [vm.segments, dayX]);

  // Selection is fully derived from the `selectedDay` prop. Defaults to
  // today's index when no day is selected, so the cursor is always visible.
  const selectedIndex = useMemo(() => {
    if (!selectedDay) return vm.todayIndex;
    return vm.days.findIndex((d) => d.date === selectedDay);
  }, [selectedDay, vm.days, vm.todayIndex]);

  // Shared with TimelineCell — same vocabulary across surfaces.
  const phaseFallowClasses: string[] = [
    phaseBackgrounds[0],
    phaseBackgrounds[1],
    phaseBackgrounds[2],
    phaseBackgrounds[3],
  ];

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<
    | {
        mode: "pan";
        startX: number;
        startScrollLeft: number;
        moved: boolean;
      }
    | {
        mode: "create";
        startIdx: number;
        startX: number;
        moved: boolean;
      }
    | null
  >(null);

  type Draft = { startIdx: number; endIdx: number; valid: boolean };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingCreate, setPendingCreate] = useState<Draft | null>(null);
  const [popupAnchor, setPopupAnchor] = useState<{
    left: number;
    top: number;
  } | null>(null);

  // Imperative scroll helper. Idempotent — only mutates DOM scrollLeft.
  const ensureVisible = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el || index < 0 || index >= dayX.length) return;
      const cellLeft = dayX[index];
      const cellRight = cellLeft + CELL_SIZE;
      const viewLeft = el.scrollLeft + KEEP_ON_SCREEN_PADDING;
      const viewRight = el.scrollLeft + el.clientWidth - KEEP_ON_SCREEN_PADDING;
      if (cellLeft < viewLeft) {
        el.scrollLeft = cellLeft - KEEP_ON_SCREEN_PADDING;
      } else if (cellRight > viewRight) {
        el.scrollLeft = cellRight - el.clientWidth + KEEP_ON_SCREEN_PADDING;
      }
    },
    [dayX],
  );

  // When the controlled selectedDay changes, keep the cursor visible.
  // Pure DOM mutation; no state setters here, so no loop risk.
  const lastEnsuredDay = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedDay) return;
    if (lastEnsuredDay.current === selectedDay) return;
    if (selectedIndex < 0) return;
    ensureVisible(selectedIndex);
    lastEnsuredDay.current = selectedDay;
  }, [selectedDay, selectedIndex, ensureVisible]);

  // Mount-scroll to today, exactly once.
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return;
    const el = scrollRef.current;
    if (!el || vm.todayIndex < 0 || dayX.length === 0) return;
    const target = dayX[vm.todayIndex] + CELL_SIZE / 2 - el.clientWidth / 2;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, target);
        didInitialScrollRef.current = true;
      });
    });
  }, [vm.todayIndex, dayX]);

  const indexAtX = useCallback(
    (x: number): number | null => {
      if (vm.days.length === 0) return null;
      let lo = 0;
      let hi = vm.days.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (dayX[mid] <= x) lo = mid;
        else hi = mid - 1;
      }
      if (x < dayX[lo] + STRIDE) return lo;
      if (lo + 1 >= vm.days.length) return lo;
      const distToHere = x - (dayX[lo] + CELL_SIZE);
      const distToNext = dayX[lo + 1] - x;
      return distToHere < distToNext ? lo : lo + 1;
    },
    [dayX, vm.days.length],
  );

  const indexFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = scrollRef.current;
      if (!el) return null;
      const inner = el.firstElementChild as HTMLElement | null;
      if (!inner) return null;
      const rect = inner.getBoundingClientRect();
      return indexAtX(clientX - rect.left);
    },
    [indexAtX],
  );

  const isGapDay = useCallback(
    (idx: number): boolean =>
      idx >= 0 && idx < vm.days.length && vm.days[idx].cycleId === null,
    [vm.days],
  );

  const computeRangeValid = useCallback(
    (start: number, end: number): boolean => {
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i++) {
        if (vm.days[i].cycleId !== null) return false;
      }
      return true;
    },
    [vm.days],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el || e.button !== 0) return;
      // Bracket buttons handle their own click.
      const target = e.target as HTMLElement | null;
      if (target?.closest("button")) return;

      const idx = indexFromClientX(e.clientX);
      if (idx !== null && isGapDay(idx)) {
        // Press in gap-space → start a create draft.
        dragRef.current = {
          mode: "create",
          startIdx: idx,
          startX: e.clientX,
          moved: false,
        };
        setDraft({ startIdx: idx, endIdx: idx, valid: true });
        setIsDragging(true);
        el.setPointerCapture(e.pointerId);
        return;
      }

      // Otherwise pan.
      dragRef.current = {
        mode: "pan",
        startX: e.clientX,
        startScrollLeft: el.scrollLeft,
        moved: false,
      };
      setIsDragging(true);
      el.setPointerCapture(e.pointerId);
    },
    [indexFromClientX, isGapDay],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const el = scrollRef.current;
      if (!drag || !el) return;
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) drag.moved = true;

      if (drag.mode === "pan") {
        el.scrollLeft = drag.startScrollLeft - dx;
        return;
      }

      // Create mode — extend draft to current cell.
      const idx = indexFromClientX(e.clientX);
      if (idx === null) return;
      const start = Math.min(drag.startIdx, idx);
      const end = Math.max(drag.startIdx, idx);
      setDraft({
        startIdx: start,
        endIdx: end,
        valid: computeRangeValid(start, end),
      });
    },
    [indexFromClientX, computeRangeValid],
  );

  const selectIndex = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= vm.days.length) return;
      onDaySelect?.(vm.days[idx].date);
    },
    [vm.days, onDaySelect],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const el = scrollRef.current;

      if (drag?.mode === "create") {
        if (draft?.valid) {
          setPendingCreate(draft);
          // Capture viewport coords for the popup, anchored at the bottom of
          // the heatmap and horizontally centered over the new cycle range.
          if (el) {
            const rect = el.getBoundingClientRect();
            const centerContentX =
              (dayX[draft.startIdx] + dayX[draft.endIdx] + CELL_SIZE) / 2;
            setPopupAnchor({
              left: rect.left + centerContentX - el.scrollLeft + 8, // +8 for px-2 padding
              top: rect.bottom + 6,
            });
          }
        } else {
          setDraft(null);
        }
      } else if (drag?.mode === "pan" && !drag.moved) {
        const target = e.target as HTMLElement | null;
        const isBracket = target?.closest("button");
        if (!isBracket) {
          const idx = indexFromClientX(e.clientX);
          if (idx !== null) selectIndex(idx);
        }
      }

      dragRef.current = null;
      setIsDragging(false);
      if (el?.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    },
    [indexFromClientX, selectIndex, draft, dayX],
  );

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (!e.shiftKey) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const anchor = selectedIndex >= 0 ? selectedIndex : vm.todayIndex;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          selectIndex(Math.max(0, anchor + (e.shiftKey ? -7 : -1)));
          break;
        case "ArrowRight":
          e.preventDefault();
          selectIndex(
            Math.min(vm.days.length - 1, anchor + (e.shiftKey ? 7 : 1)),
          );
          break;
        case "Home":
        case "Escape":
          e.preventDefault();
          if (vm.todayIndex >= 0) selectIndex(vm.todayIndex);
          break;
      }
    },
    [selectedIndex, vm.todayIndex, vm.days.length, selectIndex],
  );

  const segmentRowHeight = BRACKET_HEIGHT + CELL_SIZE * 3 + ROW_GAP * 2;

  return (
    <div
      className="relative bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-md select-none font-sans"
      style={{
        height: HEATMAP_HEIGHT,
        padding: `${VERTICAL_PADDING}px 0px`,
        boxSizing: "border-box",
      }}
    >
      <div
        ref={scrollRef}
        tabIndex={0}
        className={`relative overflow-x-auto overflow-y-hidden px-2 [scrollbar-width:thin] outline-none focus-visible:ring-1 focus-visible:ring-stone-400 ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <div
          className="relative py-2"
          style={{
            width: totalRenderedWidth,
            minWidth: totalRenderedWidth,
            touchAction: "pan-x",
          }}
        >
          <div className="flex gap-x-1" style={{ height: segmentRowHeight }}>
            {vm.segments.map((seg) => {
              const segDays = vm.days.slice(seg.startIndex, seg.endIndex + 1);
              if (seg.band) {
                return (
                  <BandedHeatmapCycleBlock
                    key={`cycle-${seg.band.cycleId}-${seg.startIndex}`}
                    band={seg.band}
                    days={segDays}
                    rows={vm.rows}
                    areaById={areaById}
                    phaseFallowClasses={phaseFallowClasses}
                    isSelected={seg.band.cycleId === selectedCycleId}
                    onSelect={onCycleSelect}
                  />
                );
              }
              return (
                <BandedHeatmapGapSegment
                  key={`gap-${seg.startIndex}`}
                  days={segDays}
                  rows={vm.rows}
                  areaById={areaById}
                  phaseFallowClasses={phaseFallowClasses}
                />
              );
            })}
          </div>

          <BandedHeatmapAxis
            days={vm.days}
            todayIndex={vm.todayIndex}
            dayX={dayX}
          />

          <div
            className="absolute left-0 right-0 top-2"
            style={{
              height: segmentRowHeight,
              pointerEvents: "none",
            }}
          >
            <BandedHeatmapNeedle
              x={
                vm.todayIndex >= 0 ? dayX[vm.todayIndex] + CELL_SIZE / 2 : null
              }
            />
            <BandedHeatmapSelectionCursor
              x={selectedIndex >= 0 ? dayX[selectedIndex] : null}
            />
            {draft && (
              <BandedHeatmapCreateDraft
                startX={dayX[draft.startIdx]}
                endX={dayX[draft.endIdx]}
                valid={draft.valid}
              />
            )}
          </div>
        </div>
      </div>
      {pendingCreate &&
        popupAnchor &&
        typeof document !== "undefined" &&
        createPortal(
          <BandedHeatmapCreatePopup
            startDate={vm.days[pendingCreate.startIdx].date}
            endDate={vm.days[pendingCreate.endIdx].date}
            dayCount={pendingCreate.endIdx - pendingCreate.startIdx + 1}
            viewportLeft={popupAnchor.left}
            viewportTop={popupAnchor.top}
            onCommit={({ name, intention }) => {
              onCycleCreate?.({
                name,
                startDate: vm.days[pendingCreate.startIdx].date,
                endDate: vm.days[pendingCreate.endIdx].date,
                intention,
              });
              setPendingCreate(null);
              setPopupAnchor(null);
              setDraft(null);
            }}
            onCancel={() => {
              setPendingCreate(null);
              setPopupAnchor(null);
              setDraft(null);
            }}
          />,
          document.body,
        )}
    </div>
  );
}
