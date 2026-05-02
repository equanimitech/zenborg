"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent } from "@/components/ui/popover";

interface BandedHeatmapCreatePopupProps {
  startDate: string;
  endDate: string;
  dayCount: number;
  /** Anchor element in the DOM. Popover positions itself relative to this. */
  anchorElement: HTMLElement | null;
  onCommit: (props: { name: string; intention: string | null }) => void;
  onCancel: () => void;
}

function formatDateRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const month = d.toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    const day = d.getUTCDate();
    return `${month} ${day}`;
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

export function BandedHeatmapCreatePopup({
  startDate,
  endDate,
  dayCount,
  anchorElement,
  onCommit,
  onCancel,
}: BandedHeatmapCreatePopupProps) {
  const [name, setName] = useState("");
  const [intention, setIntention] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the name input shortly after open. Radix has its own focus trap;
    // letting it run first avoids the steal-then-set bounce.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCommit({
      name: trimmed,
      intention: intention.trim() || null,
    });
  };

  if (!anchorElement) return null;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <PopoverPrimitive.Anchor virtualRef={{ current: anchorElement }} />
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-64 p-3 font-mono"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="text-[10px] tracking-[0.06em] text-stone-500 dark:text-stone-400 mb-2">
          {formatDateRange(startDate, endDate)} · {dayCount}d
        </div>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          autoCapitalize="none"
          spellCheck={false}
          placeholder="cycle name"
          className="w-full px-2 py-1.5 text-sm bg-transparent border-b border-stone-300 dark:border-stone-600 focus:border-stone-700 dark:focus:border-stone-300 outline-none text-stone-900 dark:text-stone-100"
        />
        <input
          type="text"
          value={intention}
          onChange={(e) => setIntention(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          autoCapitalize="none"
          spellCheck={false}
          placeholder="intention (optional)"
          className="w-full mt-2 px-2 py-1.5 text-xs bg-transparent border-b border-stone-200 dark:border-stone-700 focus:border-stone-700 dark:focus:border-stone-300 outline-none text-stone-700 dark:text-stone-300"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1 text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          >
            esc
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-3 py-1 text-[11px] rounded bg-stone-800 text-stone-50 dark:bg-stone-200 dark:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
          >
            plant cycle
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
