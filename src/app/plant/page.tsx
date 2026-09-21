"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { observer, use$ } from "@legendapp/state/react";
import { useCallback, useState } from "react";
import { AreaService } from "@/application/services/AreaService";
import { HabitService } from "@/application/services/HabitService";
import { AreaBoardBuilder } from "@/components/AreaBoardBuilder";
import { DraggableHabitItem } from "@/components/DraggableHabitItem";
import { GroupedHabitView } from "@/components/GroupedHabitView";
import { LandscapePrompt } from "@/components/LandscapePrompt";
import { PeopleBoardBuilder } from "@/components/PeopleBoardBuilder";
import { PlaceFormDialog } from "@/components/PlaceFormDialog";
import { PlacesMapView } from "@/components/PlacesMapView";
import { PlacesTreeView } from "@/components/PlacesTreeView";
import { PlantToolbar } from "@/components/PlantToolbar";
import { WelcomeState } from "@/components/plant/WelcomeState";
import { slugify } from "@/domain/entities/Moment";
import { createPlace, normalizeAliases } from "@/domain/entities/Place";
import {
  activeAreas$,
  activeHabits$,
  areas$,
  places$,
  storeHydrated$,
} from "@/infrastructure/state/store";
import type { HabitGroupBy, PeopleGroupBy } from "@/infrastructure/state/ui-store";
import {
  closePlaceForm,
  placeFormState$,
  plantViewConfig$,
} from "@/infrastructure/state/ui-store";

const PlantPage = observer(() => {
  const areaService = new AreaService();
  const habitService = new HabitService();
  const areas = use$(activeAreas$);
  const habits = use$(activeHabits$);
  const config = use$(plantViewConfig$);
  const allAreas = use$(areas$);
  const hydrated = use$(storeHydrated$);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(true);
  const toggleEmpty = useCallback(() => setShowEmpty((v) => !v), []);

  // Custom collision detection (only used for habits-by-area DnD view)
  const customCollisionDetection = (args: any) => {
    const { active } = args;
    const activeData = active?.data?.current;

    if (activeData?.type === "habit") {
      const pointerCollisions = pointerWithin(args);
      const habitCollisions = pointerCollisions.filter((collision: any) => {
        const data = collision.data?.droppableContainer?.data?.current;
        return data?.type === "habit";
      });
      if (habitCollisions.length > 0) return habitCollisions;
      const areaCollisions = pointerCollisions.filter((collision: any) =>
        collision.id.toString().startsWith("area-"),
      );
      if (areaCollisions.length > 0) return areaCollisions;
      return rectIntersection(args);
    }

    if (activeData?.type === "area") {
      const allCollisions = closestCenter(args);
      const areaOnlyCollisions = allCollisions.filter((collision: any) => {
        const data = collision.data?.droppableContainer?.data?.current;
        return (
          data?.type === "area" || collision.id.toString().startsWith("area-")
        );
      });
      if (areaOnlyCollisions.length > 0) return areaOnlyCollisions;
      return allCollisions;
    }

    return closestCenter(args);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const dragData = active.data.current as {
      habitId?: string;
      sourceAreaId?: string;
      type?: string;
    };
    const dropData = over.data.current as {
      habitId?: string;
      sourceAreaId?: string;
      targetType?: string;
      targetAreaId?: string;
      type?: string;
    };

    if (
      dragData?.type === "habit" &&
      dropData?.type === "habit" &&
      dragData.sourceAreaId === dropData.sourceAreaId &&
      active.id !== over.id
    ) {
      const areaId = dragData.sourceAreaId;
      if (!areaId) return;
      const areaHabits = habits
        .filter((h) => h.areaId === areaId)
        .sort((a, b) => a.order - b.order);
      const oldIndex = areaHabits.findIndex((h) => h.id === active.id);
      const newIndex = areaHabits.findIndex((h) => h.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(areaHabits, oldIndex, newIndex);
      for (const [index, habit] of reordered.entries()) {
        habitService.updateHabit(habit.id, { order: index });
      }
      return;
    }

    if (
      dragData?.type === "habit" &&
      dropData?.type === "habit" &&
      dragData.sourceAreaId !== dropData.sourceAreaId
    ) {
      const habitId = dragData.habitId;
      const targetAreaId = dropData.sourceAreaId;
      if (habitId && targetAreaId) {
        habitService.updateHabit(habitId, { areaId: targetAreaId });
      }
      return;
    }

    if (dragData?.type === "habit" && dropData?.targetType === "area") {
      const habitId = dragData.habitId;
      const sourceAreaId = dragData.sourceAreaId;
      const targetAreaId = dropData.targetAreaId;
      if (habitId && targetAreaId && sourceAreaId !== targetAreaId) {
        habitService.updateHabit(habitId, { areaId: targetAreaId });
      }
      return;
    }

    if (
      dragData?.type === "area" &&
      (dropData?.type === "area" || !dropData?.type)
    ) {
      const sortedAreas = [...areas].sort((a, b) => a.order - b.order);
      const oldIndex = sortedAreas.findIndex((area) => area.id === active.id);
      const newIndex = sortedAreas.findIndex((area) => area.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(sortedAreas, oldIndex, newIndex);
      for (const [index, area] of reordered.entries()) {
        const updated = areaService.updateArea(area.id, { order: index });
        if ("error" in updated) return;
        areas$[area.id].set(updated);
      }
    }
  };

  const renderContent = () => {
    if (config.entity === "places") {
      return (
        <>
          {config.groupBy === "map" ? <PlacesMapView /> : <PlacesTreeView filter={config.filter} />}
          <PlaceFormDialog
            onSave={(props) => {
              const formState = placeFormState$.peek();
              const name = props.name.trim();
              if (!name) return;
              const key = slugify(name);

              if (formState.mode === "edit" && formState.editingPlaceId) {
                const existing = places$[formState.editingPlaceId].peek();
                const normalized = normalizeAliases(props.aliases, name);
                const updated = {
                  ...existing,
                  name,
                  key,
                  emoji: props.emoji,
                  parentKey: props.parentKey,
                  coordinates: props.coordinates,
                  address: props.address,
                  url: props.url,
                  tags: props.tags,
                  updatedAt: new Date().toISOString(),
                };
                if (normalized.length > 0) updated.aliases = normalized;
                else delete updated.aliases;
                places$[formState.editingPlaceId].set(updated);
              } else {
                const place = createPlace({
                  name,
                  key,
                  emoji: props.emoji,
                  parentKey: props.parentKey,
                  coordinates: props.coordinates,
                  address: props.address,
                  url: props.url,
                  tags: props.tags,
                  aliases: props.aliases,
                });
                places$[place.id].set(place);
              }
              closePlaceForm();
            }}
            onDelete={() => {
              const formState = placeFormState$.peek();
              if (formState.editingPlaceId) {
                places$[formState.editingPlaceId].delete();
                closePlaceForm();
              }
            }}
          />
        </>
      );
    }

    if (config.entity === "people") {
      return (
        <PeopleBoardBuilder
          groupBy={config.groupBy as PeopleGroupBy}
          filter={config.filter}
          showEmpty={showEmpty}
        />
      );
    }

    // Habits: area grouping gets the full DnD AreaBoardBuilder
    if (config.groupBy === "area" && !config.filter) {
      return (
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          autoScroll={{
            threshold: { x: 0.05, y: 0.05 },
            acceleration: 5,
          }}
        >
          <AreaBoardBuilder />

          <DragOverlay>
            {activeId
              ? (() => {
                  const activeHabit = habits.find((h) => h.id === activeId);
                  if (activeHabit) {
                    const area = areas.find(
                      (a) => a.id === activeHabit.areaId,
                    );
                    return (
                      <DraggableHabitItem
                        habit={activeHabit}
                        areaColor={area?.color}
                        onEdit={() => {}}
                      />
                    );
                  }
                  const activeArea = areas.find((a) => a.id === activeId);
                  if (activeArea) {
                    const areaHabits = habits.filter(
                      (h) => h.areaId === activeArea.id,
                    );
                    return (
                      <div className="w-[22.5rem] rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 shadow-lg opacity-90">
                        <div className="px-4 py-3 flex items-center gap-2">
                          <span className="text-xl">
                            {activeArea.emoji}
                          </span>
                          <span className="text-sm font-mono font-medium text-stone-700 dark:text-stone-300">
                            {activeArea.name}
                          </span>
                          <span className="text-xs font-mono text-stone-400 dark:text-stone-500">
                            {areaHabits.length}
                          </span>
                        </div>
                        <div
                          className="h-[3px] mx-4"
                          style={{ backgroundColor: activeArea.color }}
                        />
                      </div>
                    );
                  }
                  return null;
                })()
              : null}
          </DragOverlay>
        </DndContext>
      );
    }

    // Habits grouped by attitude, phase, tag, or area with filter
    return (
      <GroupedHabitView
        groupBy={config.groupBy as HabitGroupBy}
        filter={config.filter}
        showEmpty={showEmpty}
      />
    );
  };

  // Welcome state — zero areas and store is ready
  if (hydrated && Object.keys(allAreas).length === 0) {
    return (
      <>
        <LandscapePrompt />
        <div className="h-full bg-background transition-colors flex flex-col">
          <div className="flex-1 overflow-hidden">
            <WelcomeState
              onCreateArea={(name, emoji, color) => {
                const currentCount = Object.keys(allAreas).length;
                const result = areaService.createArea({
                  name,
                  emoji,
                  color,
                  order: currentCount,
                });
                if ("error" in result) {
                  alert(`Failed to create area: ${result.error}`);
                }
              }}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <LandscapePrompt />
      <div className="h-full bg-background transition-colors flex flex-col">
        <div className="flex-1 overflow-hidden">{renderContent()}</div>
        <PlantToolbar showEmpty={showEmpty} onToggleEmpty={toggleEmpty} />
      </div>
    </>
  );
});

export default PlantPage;
