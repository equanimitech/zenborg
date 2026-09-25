"use client";

import { observer, use$ } from "@legendapp/state/react";
import {
  Eye,
  EyeOff,
  Globe,
  Grid3X3,
  Hash,
  Heart,
  MapPin,
  Search,
  Sprout,
  SunMoon,
  Tag,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { areas$ } from "@/infrastructure/state/store";
import {
  type HabitGroupBy,
  type PeopleGroupBy,
  type PlacesGroupBy,
  type PlantEntity,
  type PlantGroupBy,
  plantViewConfig$,
  setPlantEntity,
  setPlantFilter,
  setPlantGroupBy,
} from "@/infrastructure/state/ui-store";
import { cn } from "@/lib/utils";

const ENTITIES: { value: PlantEntity; label: string; icon: ReactNode }[] = [
  { value: "habits", label: "Habits", icon: <Sprout className="w-3.5 h-3.5" /> },
  { value: "people", label: "People", icon: <Users className="w-3.5 h-3.5" /> },
  { value: "places", label: "Places", icon: <MapPin className="w-3.5 h-3.5" /> },
];

const HABIT_GROUPS: { value: HabitGroupBy; label: string; icon: ReactNode }[] = [
  { value: "area", label: "Area", icon: <Grid3X3 className="w-3 h-3" /> },
  { value: "attitude", label: "Attitude", icon: <Heart className="w-3 h-3" /> },
  { value: "phase", label: "Phase", icon: <SunMoon className="w-3 h-3" /> },
  { value: "tag", label: "Tag", icon: <Tag className="w-3 h-3" /> },
];

const PEOPLE_GROUPS: { value: PeopleGroupBy; label: string; icon: ReactNode }[] = [
  { value: "tag", label: "Tag", icon: <Hash className="w-3 h-3" /> },
  { value: "place", label: "Place", icon: <MapPin className="w-3 h-3" /> },
];

const PLACES_GROUPS: { value: PlacesGroupBy; label: string; icon: ReactNode }[] = [
  { value: "tree", label: "Tree", icon: <MapPin className="w-3 h-3" /> },
  { value: "map", label: "Map", icon: <Globe className="w-3 h-3" /> },
];

function GroupChip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-mono transition-colors",
        active
          ? "bg-stone-200 dark:bg-stone-700 text-stone-800 dark:text-stone-200"
          : "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-400",
      )}
    >
      {children}
    </button>
  );
}

export const PlantToolbar = observer(
  ({
    showEmpty,
    onToggleEmpty,
  }: {
    showEmpty: boolean;
    onToggleEmpty: () => void;
  }) => {
    const config = use$(plantViewConfig$);
    const areaCount = Object.keys(use$(areas$)).length;
    const isNewUser = areaCount < 3;

    // Progressively reveal entities and groupings as the garden grows
    const entities = isNewUser
      ? ENTITIES.filter((e) => e.value === "habits")
      : ENTITIES;
    const groups =
      config.entity === "habits"
        ? isNewUser
          ? HABIT_GROUPS.filter((g) => g.value === "area")
          : HABIT_GROUPS
        : config.entity === "people"
          ? PEOPLE_GROUPS
          : PLACES_GROUPS;

    return (
      <div className="flex items-center gap-2 px-4 py-1.5 border-t border-stone-200 dark:border-stone-800">
        {/* Entity switcher — heavier visual weight, primary action */}
        <nav className="inline-flex items-center gap-0.5 rounded-sm bg-stone-100 dark:bg-stone-800 p-0.5">
          {entities.map((e) => (
            <button
              key={e.value}
              type="button"
              onClick={() => setPlantEntity(e.value)}
              title={e.label}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-mono font-medium transition-colors",
                config.entity === e.value
                  ? "bg-white dark:bg-stone-600 text-stone-900 dark:text-stone-100 shadow-sm"
                  : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300",
              )}
            >
              {e.icon}
              <span>{e.label}</span>
            </button>
          ))}
        </nav>

        <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

        {/* Group by — lighter, secondary */}
        <div className="flex items-center gap-0.5">
          {groups.map((g) => (
            <GroupChip
              key={g.value}
              active={config.groupBy === g.value}
              onClick={() => setPlantGroupBy(g.value)}
              title={`Group by ${g.label}`}
            >
              {g.icon}
              <span className="hidden md:inline">{g.label}</span>
            </GroupChip>
          ))}
        </div>

        <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

        {/* Show/hide empty */}
        <button
          type="button"
          onClick={onToggleEmpty}
          title={showEmpty ? "Hide empty columns" : "Show empty columns"}
          className="p-1 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
        >
          {showEmpty ? (
            <Eye className="w-3.5 h-3.5" />
          ) : (
            <EyeOff className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Filter — pushed right */}
        <div className="flex items-center gap-1.5 ml-auto max-w-[200px]">
          <Search className="w-3 h-3 text-stone-400 dark:text-stone-500 flex-shrink-0" />
          <input
            type="text"
            value={config.filter}
            onChange={(e) => setPlantFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full bg-transparent text-xs font-mono text-stone-700 dark:text-stone-300 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none"
          />
        </div>
      </div>
    );
  },
);
