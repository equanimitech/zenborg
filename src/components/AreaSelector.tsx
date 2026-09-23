/** biome-ignore-all lint/a11y/noAutofocus: inline edit opens from a keyboard action, so focus has to follow it */
"use client";

import { useSelector } from "@legendapp/state/react";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createArea } from "@/domain/entities/Area";
import { activeAreas$, areas$ } from "@/infrastructure/state/store";
import { suggestEmojiForAreaName } from "@/lib/emoji-utils";

interface AreaSelectorProps {
  id?: string;
  open: boolean;
  selectedAreaId: string;
  onSelectArea: (areaId: string) => void;
  onClose: () => void;
  /** Called when popover should open (when trigger is clicked) */
  onOpen?: () => void;
  /** The trigger button/element that opens this popover */
  trigger: React.ReactNode;
  /** Element to use as collision boundary (e.g., dialog container) */
  collisionBoundary?: Element | null | Array<Element | null>;
}

// Available color palette for random selection
const AREA_COLORS = [
  "#10b981", // green
  "#3b82f6", // blue
  "#f97316", // orange
  "#eab308", // yellow
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#ef4444", // red
  "#06b6d4", // cyan
  "#059669", // emerald
  "#f59e0b", // amber
  "#6366f1", // indigo
  "#6b7280", // gray
];

/**
 * Get a random color from the palette
 */
function getRandomColor(): string {
  return AREA_COLORS[Math.floor(Math.random() * AREA_COLORS.length)];
}

/**
 * AreaSelector - Linear-inspired searchable combobox for area selection
 *
 * Features:
 * - Search/filter areas by name
 * - Inline area creation: type non-matching text → shows "+ Create area: 'X'"
 * - Auto-suggests emoji based on area name
 * - Random color selection
 * - Clean, minimal UI
 */
export function AreaSelector({
  id,
  open,
  selectedAreaId,
  onSelectArea,
  onClose,
  onOpen,
  trigger,
  collisionBoundary,
}: AreaSelectorProps) {
  // Use activeAreas$ which filters out archived areas and sorts by order
  const areasList = useSelector(() => activeAreas$.get());

  const [searchValue, setSearchValue] = useState("");

  const handleCreateArea = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const maxOrder = areasList.reduce(
      (max, area) => Math.max(max, area.order),
      -1,
    );

    const emoji = suggestEmojiForAreaName(trimmedName) || "";
    const color = getRandomColor();

    const result = createArea({
      name: trimmedName,
      color,
      emoji,
      order: maxOrder + 1,
    });

    if ("error" in result) {
      console.error("Failed to create area:", result.error);
      return;
    }

    // Add the new area to the store
    areas$[result.id].set(result);

    // Select it and close (the selector is responsible for updating the parent)
    onSelectArea(result.id);
    setSearchValue("");
    onClose();
  };

  const handleSelectArea = (areaId: string) => {
    onSelectArea(areaId);
    setSearchValue("");
    onClose();
  };

  // Filter areas based on search
  const filteredAreas = searchValue
    ? areasList.filter((area) =>
        area.name.toLowerCase().includes(searchValue.toLowerCase()),
      )
    : areasList;

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          onOpen?.();
        } else {
          onClose();
          setSearchValue("");
        }
      }}
    >
      <PopoverTrigger asChild id={id}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[300px] p-0"
        collisionBoundary={collisionBoundary}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search areas..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty className="py-2 px-2">
              {searchValue.trim() ? (
                <button
                  type="button"
                  onClick={() => handleCreateArea(searchValue)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-sm transition-colors text-left"
                >
                  <Plus className="w-4 h-4 text-stone-500" />
                  <span className="text-sm">
                    Create area: <strong>"{searchValue.trim()}"</strong>
                  </span>
                </button>
              ) : (
                <div className="text-sm text-stone-500">
                  No areas yet. Type to create one.
                </div>
              )}
            </CommandEmpty>
            {filteredAreas.length > 0 && (
              <CommandGroup>
                {filteredAreas.map((area) => {
                  const isSelected = area.id === selectedAreaId;

                  return (
                    <CommandItem
                      key={area.id}
                      value={area.id}
                      onSelect={() => handleSelectArea(area.id)}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                    >
                      {/* Colored dot */}
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: area.color }}
                      />

                      {/* Emoji: fixed slot keeps names aligned when none is chosen; the dot is the swatch */}
                      <span className="text-lg flex-shrink-0 w-6 text-center">
                        {area.emoji}
                      </span>

                      {/* Name */}
                      <span className="text-sm font-medium flex-1 min-w-0 truncate">
                        {area.name}
                      </span>
                      {/* Checkmark for selected */}
                      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                        {isSelected && (
                          <Check className="w-4 h-4" strokeWidth={3} />
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
