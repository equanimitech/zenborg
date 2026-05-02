"use client";

import { useRef, useState } from "react";
import { CycleService } from "@/application/services/CycleService";
import { cycles$ } from "@/infrastructure/state/store";
import { flashCycleClamp } from "@/infrastructure/state/ui-store";
import { addDays, clampCycleEdge } from "@/lib/cycles/intervals";
import { fromISODate } from "@/lib/dates";
import { STRIDE } from "./constants";

interface CycleResizeHandleProps {
  cycleId: string;
  edge: "start" | "end";
}

const cycleService = new CycleService();

function formatDateLabel(iso: string): string {
  const d = fromISODate(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function CycleResizeHandle({ cycleId, edge }: CycleResizeHandleProps) {
  const [dragDate, setDragDate] = useState<string | null>(null);
  const dragRef = useRef<{
    startX: number;
    originalDate: string;
    lastCommittedDate: string;
  } | null>(null);

  const commit = (date: string) => {
    if (edge === "start") {
      cycleService.updateCycle(cycleId, { startDate: date });
    } else {
      cycleService.updateCycle(cycleId, { endDate: date });
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const cycle = cycles$[cycleId].peek();
    if (!cycle) return;
    const originalDate =
      edge === "start" ? cycle.startDate : (cycle.endDate ?? cycle.startDate);
    dragRef.current = {
      startX: e.clientX,
      originalDate,
      lastCommittedDate: originalDate,
    };
    setDragDate(originalDate);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dayOffset = Math.round(dx / STRIDE);
    const candidate = addDays(drag.originalDate, dayOffset);
    const all = Object.values(cycles$.peek());
    const { date, blockedBy } = clampCycleEdge({
      cycleId,
      edge,
      candidateDate: candidate,
      allCycles: all,
    });
    if (blockedBy) flashCycleClamp(blockedBy);
    setDragDate(date);
    if (date === drag.lastCommittedDate) return;
    commit(date);
    drag.lastCommittedDate = date;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    setDragDate(null);
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Straddle the block's edge so the handle visually IS the border.
  // -8px puts the 16px-wide hit zone centered on the block edge.
  const positionStyle: React.CSSProperties =
    edge === "start" ? { left: -8 } : { right: -8 };

  const isDragging = dragDate !== null;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={positionStyle}
      className={`absolute top-0 bottom-0 z-10 w-4 cursor-ew-resize transition-opacity ${
        isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
      aria-hidden="true"
    >
      {/* Visual pill, centered on the handle (and therefore on the block edge) */}
      <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[3px] rounded-full bg-stone-700 dark:bg-stone-300 shadow-sm pointer-events-none" />
      {dragDate && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-900 dark:bg-stone-100 px-2 py-0.5 text-[11px] font-mono font-medium text-stone-50 dark:text-stone-900 shadow-md pointer-events-none">
          {formatDateLabel(dragDate)}
        </div>
      )}
    </div>
  );
}
