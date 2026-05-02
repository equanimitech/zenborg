"use client";

import { useEffect, useRef, useState } from "react";

interface BandedHeatmapCreatePopupProps {
  startDate: string;
  endDate: string;
  dayCount: number;
  /** Viewport-space horizontal anchor (popup is portaled to document.body). */
  viewportLeft: number;
  /** Viewport-space top anchor (typically the bottom of the heatmap). */
  viewportTop: number;
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
  viewportLeft,
  viewportTop,
  onCommit,
  onCancel,
}: BandedHeatmapCreatePopupProps) {
  const [name, setName] = useState("");
  const [intention, setIntention] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onCancel]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCommit({
      name: trimmed,
      intention: intention.trim() || null,
    });
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Plant cycle"
      className="fixed z-50 rounded-md bg-white dark:bg-stone-800 ring-1 ring-stone-300 dark:ring-stone-600 shadow-lg p-3 w-64 font-mono"
      style={{
        left: viewportLeft,
        top: viewportTop,
        transform: "translateX(-50%)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
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
    </div>
  );
}
