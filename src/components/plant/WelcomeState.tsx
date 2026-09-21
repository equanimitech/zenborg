"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const AREA_COLORS = [
  "#10b981", "#3b82f6", "#f97316", "#eab308",
  "#8b5cf6", "#ec4899", "#06b6d4", "#6366f1",
];

const SUGGESTED_FIELDS = [
  { name: "Wellness", emoji: "🌿", color: "#10b981" },
  { name: "Creative", emoji: "🎨", color: "#8b5cf6" },
  { name: "Social", emoji: "👥", color: "#3b82f6" },
  { name: "Work", emoji: "💼", color: "#f97316" },
  { name: "Inner", emoji: "🧘", color: "#6366f1" },
  { name: "Home", emoji: "🏠", color: "#f59e0b" },
];

interface CustomField {
  name: string;
  emoji: string;
  color: string;
}

export function WelcomeState({
  onCreateArea,
}: {
  onCreateArea: (name: string, emoji: string, color: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const allFields = [...SUGGESTED_FIELDS, ...customFields];

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addCustom = () => {
    const name = draft.trim();
    if (!name) return;
    if (allFields.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;

    const color = AREA_COLORS[(SUGGESTED_FIELDS.length + customFields.length) % AREA_COLORS.length];
    const field: CustomField = { name, emoji: "⭐", color };
    setCustomFields((prev) => [...prev, field]);
    setSelected((prev) => new Set(prev).add(name));
    setDraft("");
    setAdding(false);
  };

  const plant = () => {
    for (const field of allFields) {
      if (selected.has(field.name)) {
        onCreateArea(field.name, field.emoji, field.color);
      }
    }
  };

  return (
    <div className="flex items-center justify-center h-full px-6">
      <div className="max-w-[480px] text-center space-y-8">
        <div className="space-y-2">
          <p className="text-lg italic text-stone-600 dark:text-stone-400">
            «&thinsp;Il faut cultiver son jardin&thinsp;»
          </p>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            — Voltaire, <em>Candide</em>
          </p>
        </div>

        <p className="text-sm text-stone-600 dark:text-stone-400">
          Choose the fields of your life you'll tend.
        </p>

        <div className="flex flex-wrap justify-center gap-2">
          {allFields.map((field) => {
            const on = selected.has(field.name);
            return (
              <button
                key={field.name}
                type="button"
                onClick={() => toggle(field.name)}
                className={cn(
                  "px-4 py-2 text-sm font-mono transition-colors",
                  "border border-stone-200 dark:border-stone-700",
                  on
                    ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 border-transparent"
                    : "bg-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800",
                )}
              >
                {field.emoji} {field.name}
              </button>
            );
          })}

          {adding ? (
            <input
              ref={inputRef}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCustom();
                if (e.key === "Escape") { setAdding(false); setDraft(""); }
              }}
              onBlur={() => { if (draft.trim()) addCustom(); else setAdding(false); }}
              placeholder="your field..."
              className="px-4 py-2 text-sm font-mono border border-stone-300 dark:border-stone-600 bg-transparent text-stone-900 dark:text-stone-100 outline-none w-36 text-center"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="px-3 py-2 text-sm font-mono border border-dashed border-stone-300 dark:border-stone-600 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 inline -mt-0.5" /> add field
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <button
            type="button"
            onClick={plant}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-mono bg-stone-800 hover:bg-stone-900 text-white dark:bg-stone-200 dark:hover:bg-stone-300 dark:text-stone-900 transition-colors"
          >
            Plant {selected.size === 1 ? "this field" : "these fields"}
          </button>
        )}
      </div>
    </div>
  );
}
