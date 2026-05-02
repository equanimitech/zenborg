import { use$ } from "@legendapp/state/react";
import type { Area } from "@/domain/entities/Area";
import type { Phase } from "@/domain/value-objects/Phase";
import type {
  HeatmapBand,
  HeatmapDay,
} from "@/infrastructure/state/bandedHeatmapViewModel";
import { cycleClampHighlight$ } from "@/infrastructure/state/ui-store";
import { BandedHeatmapCell } from "./BandedHeatmapCell";
import { CycleResizeHandle } from "./CycleResizeHandle";
import {
  BRACKET_HEIGHT,
  CELL_GAP,
  CELL_SIZE,
  ROW_GAP,
  STRIDE,
} from "./constants";

interface BandedHeatmapCycleBlockProps {
  band: HeatmapBand;
  days: HeatmapDay[];
  rows: Phase[];
  areaById: Map<string, Area>;
  phaseFallowClasses: string[];
  isSelected: boolean;
  onSelect?: (cycleId: string) => void;
}

export function BandedHeatmapCycleBlock({
  band,
  days,
  rows,
  areaById,
  phaseFallowClasses,
  isSelected,
  onSelect,
}: BandedHeatmapCycleBlockProps) {
  const gridWidth = days.length * STRIDE - CELL_GAP;
  const blockWidth = gridWidth;

  const clampHighlight = use$(cycleClampHighlight$);
  const isClamping = clampHighlight?.cycleId === band.cycleId;

  const containerClass = isSelected
    ? "group relative flex flex-col rounded-md overflow-visible bg-white dark:bg-stone-800 ring-2 ring-stone-700 dark:ring-stone-300 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.18)] transition-colors"
    : (() => {
        const base =
          "group relative flex flex-col rounded-md overflow-visible ring-1 transition-colors";
        switch (band.tense) {
          case "active":
            return `${base} bg-stone-50 dark:bg-stone-900/70 ring-stone-400 dark:ring-stone-500`;
          case "past":
            return `${base} bg-stone-200/60 dark:bg-stone-800/50 ring-stone-300/70 dark:ring-stone-700/70`;
          case "future":
            return `${base} bg-white dark:bg-stone-900/30 ring-stone-300 dark:ring-stone-600`;
        }
      })();

  const clampClass = isClamping
    ? " ring-2 ring-amber-500/80 dark:ring-amber-400/80"
    : "";

  const bracketClass = (() => {
    if (isSelected) return "text-stone-900 dark:text-stone-100 font-semibold";
    switch (band.tense) {
      case "active":
        return "text-stone-700 dark:text-stone-300 font-medium";
      case "past":
        return "text-stone-500 dark:text-stone-500 opacity-70";
      case "future":
        return "text-stone-500 dark:text-stone-500 italic";
    }
  })();

  return (
    <div
      className={containerClass + clampClass}
      style={{ width: blockWidth, flexShrink: 0 }}
    >
      <CycleResizeHandle cycleId={band.cycleId} edge="start" />
      <CycleResizeHandle cycleId={band.cycleId} edge="end" />
      <button
        type="button"
        onClick={() => onSelect?.(band.cycleId)}
        className={`flex items-center px-2 text-[11px] tracking-[0.02em] font-mono whitespace-nowrap overflow-hidden text-ellipsis text-left transition-colors ${bracketClass} ${
          isSelected
            ? "bg-stone-900/5 dark:bg-stone-100/5"
            : "bg-transparent hover:bg-stone-200/40 dark:hover:bg-stone-700/40"
        } ${onSelect ? "cursor-pointer" : "cursor-default"}`}
        style={{ height: BRACKET_HEIGHT, width: "100%" }}
      >
        {band.name}
      </button>
      <div
        className="px-0 pb-0"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: ROW_GAP,
        }}
      >
        {rows.map((phase, rowIndex) => (
          <div
            key={phase}
            style={{
              display: "grid",
              gridAutoFlow: "column",
              gridAutoColumns: `${CELL_SIZE}px`,
              gap: CELL_GAP,
              width: gridWidth,
            }}
          >
            {days.map((day) => (
              <BandedHeatmapCell
                key={day.date}
                cell={day.cells[phase]}
                areaById={areaById}
                fallowClassName={phaseFallowClasses[rowIndex]}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
