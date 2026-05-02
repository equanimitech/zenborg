"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CycleService } from "@/application/services/CycleService";
import { cycles$ } from "@/infrastructure/state/store";
import {
  cycleResizePreview$,
  flashCycleClamp,
} from "@/infrastructure/state/ui-store";
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
  const [labelPos, setLabelPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const dragRef = useRef<{
    startX: number;
    originalDate: string;
    lastDate: string;
  } | null>(null);

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
      lastDate: originalDate,
    };
    setDragDate(originalDate);
    cycleResizePreview$.set({ cycleId, edge, date: originalDate });
    const rect = e.currentTarget.getBoundingClientRect();
    setLabelPos({ left: rect.left + rect.width / 2, top: rect.bottom + 8 });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture can fail in rare cases (e.g. detached element).
    }
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
    // Track cursor for the date label even when day didn't change.
    setLabelPos((pos) => (pos ? { left: e.clientX, top: pos.top } : pos));
    if (date === drag.lastDate) return;
    setDragDate(date);
    cycleResizePreview$.set({ cycleId, edge, date });
    drag.lastDate = date;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    setDragDate(null);
    setLabelPos(null);
    cycleResizePreview$.set(null);
    if (!drag) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // OK if it wasn't captured.
    }
    if (drag.lastDate === drag.originalDate) return;
    if (edge === "start") {
      cycleService.updateCycle(cycleId, { startDate: drag.lastDate });
    } else {
      cycleService.updateCycle(cycleId, { endDate: drag.lastDate });
    }
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
      className={`absolute top-0 bottom-0 z-20 w-4 cursor-ew-resize transition-opacity ${
        isDragging
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 hover:opacity-100"
      }`}
      aria-hidden="true"
    >
      {/* Visual pill, centered on the handle (and therefore on the block edge) */}
      <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[3px] rounded-full bg-stone-700 dark:bg-stone-300 shadow-sm pointer-events-none" />
      {dragDate &&
        labelPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[1000] whitespace-nowrap rounded-md bg-stone-900 dark:bg-stone-100 px-2 py-0.5 text-[11px] font-mono font-medium text-stone-50 dark:text-stone-900 shadow-md pointer-events-none"
            style={{
              left: labelPos.left,
              top: labelPos.top,
              transform: "translateX(-50%)",
            }}
          >
            {formatDateLabel(dragDate)}
          </div>,
          document.body,
        )}
    </div>
  );
}
