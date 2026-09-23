"use client";

import { usePathname, useRouter } from "next/navigation";
import { GardenGlyph } from "@/components/GardenGlyph";
import { cn } from "@/lib/utils";

const modes = [
  { name: "Plant", path: "/plant", glyph: "plant" },
  { name: "Cultivate", path: "/cultivate", glyph: "cultivate" },
  { name: "Harvest", path: "/harvest", glyph: "harvest" },
] as const;

/**
 * ModeSelector - Claude-inspired segmented pill control
 *
 * Design:
 * - Segmented control with subtle container background
 * - Active tab: filled pill with solid background
 * - Inactive: plain text, hover highlight
 * - Keyboard shortcuts: Cmd+1/2/3 (handled globally)
 */
export function ModeSelector() {
  const pathname = usePathname();
  const router = useRouter();

  const currentMode = pathname.startsWith("/plan")
    ? "Plant"
    : pathname.startsWith("/harvest")
      ? "Harvest"
      : "Cultivate";

  return (
    <nav
      className={cn(
        "inline-flex items-center gap-0.5",
        "rounded-lg bg-stone-100 dark:bg-stone-800 p-0.5",
      )}
      aria-label="Navigation"
    >
      {modes.map((mode) => {
        const isActive = currentMode === mode.name;
        return (
          <button
            key={mode.path}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => router.push(mode.path)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-1 rounded-md text-sm font-medium transition-all duration-150",
              isActive
                ? "bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm"
                : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300",
            )}
          >
            <GardenGlyph
              name={mode.glyph}
              size={14}
              className={isActive ? undefined : "opacity-70"}
            />
            {mode.name}
          </button>
        );
      })}
    </nav>
  );
}
