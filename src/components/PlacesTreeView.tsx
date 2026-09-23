"use client";

import { observer, use$ } from "@legendapp/state/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Place } from "@/domain/entities/Place";
import { activeHabits$, places$ } from "@/infrastructure/state/store";
import { openPlaceFormEdit } from "@/infrastructure/state/ui-store";
import { cn } from "@/lib/utils";

interface TreeNode {
  place: Place;
  children: TreeNode[];
  habitCount: number;
}

function buildTree(
  places: Place[],
  habitCountByPlaceId: Map<string, number>,
): TreeNode[] {
  const byParentKey = new Map<string | null, Place[]>();
  for (const p of places) {
    const list = byParentKey.get(p.parentKey) ?? [];
    list.push(p);
    byParentKey.set(p.parentKey, list);
  }

  const build = (parentKey: string | null): TreeNode[] => {
    const children = byParentKey.get(parentKey) ?? [];
    return children
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((place) => ({
        place,
        children: build(place.key),
        habitCount: habitCountByPlaceId.get(place.id) ?? 0,
      }));
  };

  return build(null);
}

function subtreeMatchesFilter(node: TreeNode, filter: string): boolean {
  if (
    node.place.name.toLowerCase().includes(filter) ||
    node.place.key.includes(filter)
  )
    return true;
  return node.children.some((c) => subtreeMatchesFilter(c, filter));
}

function PlaceNode({
  node,
  depth,
  filter,
}: {
  node: TreeNode;
  depth: number;
  filter: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  const matchesFilter =
    !filter ||
    node.place.name.toLowerCase().includes(filter) ||
    node.place.key.includes(filter);

  if (filter && !subtreeMatchesFilter(node, filter)) return null;

  const coords = node.place.coordinates;

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: the row holds the collapse <button>, and buttons cannot nest */}
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-3 rounded-sm transition-colors cursor-pointer",
          "hover:bg-stone-100 dark:hover:bg-stone-800",
          filter && matchesFilter && "bg-stone-50 dark:bg-stone-800/50",
        )}
        style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
        role="button"
        tabIndex={0}
        onClick={() => openPlaceFormEdit(node.place.id, node.place)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && e.key === "Enter") {
            openPlaceFormEdit(node.place.id, node.place);
          }
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
          }}
          className={cn(
            "p-0.5 text-stone-400 dark:text-stone-500 transition-colors",
            hasChildren
              ? "hover:text-stone-600 dark:hover:text-stone-300"
              : "invisible",
          )}
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>

        <span className="w-5 text-center text-sm leading-none">
          {node.place.emoji ?? (depth === 0 ? "🌍" : depth === 1 ? "📍" : "·")}
        </span>

        <span
          className={cn(
            "text-sm font-mono",
            depth === 0
              ? "font-medium text-stone-700 dark:text-stone-300"
              : "text-stone-600 dark:text-stone-400",
          )}
        >
          {node.place.name}
        </span>

        {node.habitCount > 0 && (
          <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500 tabular-nums">
            {node.habitCount}
          </span>
        )}

        {coords && (
          <span className="ml-auto text-[10px] font-mono text-stone-300 dark:text-stone-600 tabular-nums">
            {coords.lat.toFixed(2)}, {coords.lng.toFixed(2)}
          </span>
        )}
      </div>

      {!collapsed &&
        hasChildren &&
        node.children.map((child) => (
          <PlaceNode
            key={child.place.id}
            node={child}
            depth={depth + 1}
            filter={filter}
          />
        ))}
    </>
  );
}

export const PlacesTreeView = observer(({ filter }: { filter: string }) => {
  const places = use$(places$);
  const habits = use$(activeHabits$);

  const allPlaces = useMemo(() => Object.values(places), [places]);

  const habitCountByPlaceId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of habits) {
      for (const pid of h.placeIds ?? []) {
        counts.set(pid, (counts.get(pid) ?? 0) + 1);
      }
    }
    return counts;
  }, [habits]);

  const tree = useMemo(
    () => buildTree(allPlaces, habitCountByPlaceId),
    [allPlaces, habitCountByPlaceId],
  );

  const normalizedFilter = filter.trim().toLowerCase();

  if (tree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400 dark:text-stone-500 text-sm font-mono">
        no places
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="max-w-lg mx-auto">
        {tree.map((node) => (
          <PlaceNode
            key={node.place.id}
            node={node}
            depth={0}
            filter={normalizedFilter}
          />
        ))}
      </div>
    </div>
  );
});
