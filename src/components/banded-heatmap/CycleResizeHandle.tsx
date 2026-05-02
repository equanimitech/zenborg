"use client";

import { useRef } from "react";
import { CycleService } from "@/application/services/CycleService";
import { cycles$ } from "@/infrastructure/state/store";
import { flashCycleClamp } from "@/infrastructure/state/ui-store";
import { addDays, clampCycleEdge } from "@/lib/cycles/intervals";
import { STRIDE } from "./constants";

interface CycleResizeHandleProps {
  cycleId: string;
  edge: "start" | "end";
}

const cycleService = new CycleService();

export function CycleResizeHandle({ cycleId, edge }: CycleResizeHandleProps) {
  const dragRef = useRef<{
    startX: number;
    originalDate: string;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const cycle = cycles$[cycleId].peek();
    if (!cycle) return;
    const originalDate =
      edge === "start" ? cycle.startDate : (cycle.endDate ?? cycle.startDate);
    dragRef.current = { startX: e.clientX, originalDate };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Track only — preview not rendered live in the tiny version. The clamp
    // flash gives feedback when the cursor pushes past a neighbor.
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dayOffset = Math.round(dx / STRIDE);
    if (dayOffset === 0) return;
    const candidate = addDays(dragRef.current.originalDate, dayOffset);
    const all = Object.values(cycles$.peek());
    const { blockedBy } = clampCycleEdge({
      cycleId,
      edge,
      candidateDate: candidate,
      allCycles: all,
    });
    if (blockedBy) flashCycleClamp(blockedBy);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const dx = e.clientX - drag.startX;
    const dayOffset = Math.round(dx / STRIDE);
    if (dayOffset === 0) return;

    const candidate = addDays(drag.originalDate, dayOffset);
    const all = Object.values(cycles$.peek());
    const { date } = clampCycleEdge({
      cycleId,
      edge,
      candidateDate: candidate,
      allCycles: all,
    });

    if (date === drag.originalDate) return;

    if (edge === "start") {
      cycleService.updateCycle(cycleId, { startDate: date });
    } else {
      cycleService.updateCycle(cycleId, { endDate: date });
    }
  };

  const sideClass = edge === "start" ? "left-0" : "right-0";

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`absolute top-0 bottom-0 ${sideClass} z-10 w-4 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity`}
      aria-hidden="true"
    >
      <div
        className={`absolute top-0 bottom-0 ${edge === "start" ? "left-1" : "right-1"} w-[3px] rounded-full bg-stone-700 dark:bg-stone-300 shadow-sm pointer-events-none`}
      />
    </div>
  );
}
