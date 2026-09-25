"use client";

/**
 * DnD Context Provider
 *
 * Wraps the application with @dnd-kit's DndContext, providing drag & drop
 * functionality throughout the component tree.
 */

import {
  type CollisionDetection,
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
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useValue } from "@legendapp/state/react";
import { useState } from "react";
import { CycleService } from "@/application/services/CycleService";
import type { Area } from "@/domain/entities/Area";
import type { Habit } from "@/domain/entities/Habit";
import type { Phase } from "@/domain/value-objects/Phase";
import { endBatch, startBatch } from "@/infrastructure/state/history";
import {
  duplicateMomentWithHistory,
  moveMomentWithHistory,
  reorderMomentsWithHistory,
} from "@/infrastructure/state/history-middleware";
import { selectionState$ } from "@/infrastructure/state/selection";
import { areas$, habits$, moments$ } from "@/infrastructure/state/store";
import { isDuplicateMode$ } from "@/infrastructure/state/ui-store";
import {
  columnWidth,
  getTextColorsForBackground,
  momentCard,
} from "@/lib/design-tokens";
import {
  calculateNextOrder,
  canDropInCell,
  reorderAfterRemoval,
} from "@/lib/drag-validation";
import { cn } from "@/lib/utils";
import type { DraggableData, DroppableData } from "@/types/dnd";
import { MomentCard } from "./MomentCard";

interface DnDProviderProps {
  children: React.ReactNode;
}

/**
 * DeckCardPreview — overlay preview rendered when dragging a VirtualDeckCard.
 * Matches MomentCard styling so the drop into a timeline slot feels continuous
 * with allocating a moment.
 */
function DeckCardPreview({ habit, area }: { habit: Habit; area: Area }) {
  const textColors = getTextColorsForBackground(area.color);
  return (
    <div
      className={cn(
        "rounded-lg w-full flex flex-row items-center gap-2 shadow-lg",
      )}
      style={{
        backgroundColor: area.color,
        minHeight: momentCard.minHeight,
        paddingLeft: momentCard.paddingX,
        paddingRight: momentCard.paddingX,
        paddingTop: momentCard.paddingY,
        paddingBottom: momentCard.paddingY,
      }}
    >
      {habit.emoji && (
        <span className={cn("mr-2 text-lg", textColors.primary)}>
          {habit.emoji}
        </span>
      )}
      <span
        className={cn(
          "text-lg font-semibold font-mono truncate flex-1 min-w-0",
          textColors.primary,
        )}
      >
        {habit.name}
      </span>
    </div>
  );
}

export function DnDProvider({ children }: DnDProviderProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDeckHabitId, setActiveDeckHabitId] = useState<string | null>(
    null,
  );
  const isDuplicateMode = useValue(isDuplicateMode$);
  const allMoments = useValue(moments$);
  const allAreas = useValue(areas$);
  const allHabits = useValue(habits$);
  const selectedMomentIds = useValue(selectionState$.selectedMomentIds);

  // Custom collision detection strategy
  // Prioritize pointer-based detection for better accuracy when dropping
  const collisionDetectionStrategy: CollisionDetection = (args) => {
    // First try pointer-based detection
    // This works well for both mouse and touch (mobile)
    const pointerCollisions = pointerWithin(args);

    if (pointerCollisions.length > 0) {
      // Separate sortable items (moments) from droppable containers (cells)
      const sortableCollisions = pointerCollisions.filter((collision) => {
        const id = collision.id.toString();
        // Sortable items don't start with these prefixes - they're moment IDs
        return !(id.startsWith("timeline-") || id.startsWith("column-"));
      });

      const droppableCollisions = pointerCollisions.filter((collision) => {
        const id = collision.id.toString();
        return id.startsWith("timeline-") || id.startsWith("column-");
      });

      // Prioritize sortable items (moments) for reordering within same cell
      // Only fall back to droppable containers if no sortable items found
      if (sortableCollisions.length > 0) {
        return sortableCollisions;
      }

      if (droppableCollisions.length > 0) {
        return droppableCollisions;
      }

      return pointerCollisions;
    }

    // Fallback to rect intersection for edge cases
    return rectIntersection(args);
  };

  // Configure sensors for mouse, touch, and keyboard interactions
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    const data = event.active.data.current as DraggableData | undefined;

    // Deck-card drags don't correspond to a Moment yet. Track the habit so
    // the overlay can render a moment-shaped preview of the intended drop.
    if (data?.type === "deck-card") {
      setActiveDeckHabitId(data.habitId);
      setActiveId(null);
      const altKeyPressed =
        // @ts-expect-error - activatorEvent carries the original pointer event
        event.activatorEvent?.altKey || false;
      isDuplicateMode$.set(altKeyPressed);
      return;
    }

    // MomentStack draggables use "stack-{momentId}" as their dnd-kit ID but
    // store the real moment ID in data.current.momentId. Use that for the
    // overlay lookup so allMoments[activeId] resolves correctly.
    const momentId =
      (event.active.data.current as { momentId?: string } | undefined)
        ?.momentId ?? id;
    setActiveId(momentId);
    setActiveDeckHabitId(null);
    // Capture duplicate decision at drag start (locked for entire drag operation)
    // If Option/Alt is held when drag begins, we'll duplicate on drop
    // @ts-expect-error - activatorEvent contains the original mouse/pointer event
    const altKeyPressed = event.activatorEvent?.altKey || false;
    isDuplicateMode$.set(altKeyPressed);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const wasDuplicateMode = isDuplicateMode;
    setActiveId(null);
    setActiveDeckHabitId(null);
    isDuplicateMode$.set(false);

    if (!over) {
      // Dropped outside any droppable zone
      return;
    }

    const dragData = active.data.current as DraggableData | undefined;
    const dropData = over.data.current as DroppableData | undefined;

    // Check if we're dragging a selected moment with multiple selections
    // Use .get() to get the latest selection state at drop time
    const currentSelectedIds = selectionState$.selectedMomentIds.get();
    const draggedMomentId = active.id as string;
    const isDraggingSelection =
      currentSelectedIds.includes(draggedMomentId) &&
      currentSelectedIds.length > 1;

    if (isDraggingSelection && dropData?.targetType === "timeline-cell") {
      handleBatchDropOnTimelineCell(
        currentSelectedIds,
        dropData,
        wasDuplicateMode,
      );
      return;
    }

    if (isDraggingSelection && dropData?.targetType === "cycle-deck") {
      // Handle batch drop on cycle deck (unallocate all)
      if (!wasDuplicateMode) {
        const validMomentIds = currentSelectedIds.filter((momentId) => {
          const moment = allMoments[momentId];
          return !!moment;
        });

        if (validMomentIds.length === 0) {
          console.warn("No valid moments to unallocate to cycle deck");
          return;
        }

        handleBatchUnallocate(validMomentIds);
      }
      return;
    }

    // Handle sortable reordering (when dragging over another moment, not a cell)
    if (active.id !== over.id && !dropData?.targetType) {
      const activeMoment = allMoments[active.id as string];
      const overMoment = allMoments[over.id as string];

      // Bug C1: deck-card dropped on an allocated moment resolves over.id to
      // that sortable moment's id (not its droppable cell), so dropData has no
      // targetType. Re-route to handleAllocateFromPlan using the overMoment's
      // cell coordinates so the drop isn't silently swallowed.
      if (
        !activeMoment &&
        dragData?.type === "deck-card" &&
        overMoment?.day &&
        overMoment?.phase
      ) {
        handleAllocateFromPlan(dragData, {
          targetType: "timeline-cell",
          targetDay: overMoment.day,
          targetPhase: overMoment.phase,
        });
        return;
      }

      if (!activeMoment || !overMoment) {
        return;
      }

      // If dragging multiple selected moments, treat dropping on a moment as dropping on its cell/area
      if (isDraggingSelection) {
        if (overMoment.day && overMoment.phase) {
          // Dropping on allocated moment -> move to its cell
          const cellDropData: DroppableData = {
            targetType: "timeline-cell",
            targetDay: overMoment.day,
            targetPhase: overMoment.phase,
          };
          handleBatchDropOnTimelineCell(
            currentSelectedIds,
            cellDropData,
            wasDuplicateMode,
          );
          return;
        }
      }

      // Reorder within timeline cell (both moments are allocated to same cell)
      if (
        activeMoment.day &&
        activeMoment.phase &&
        activeMoment.day === overMoment.day &&
        activeMoment.phase === overMoment.phase
      ) {
        handleSortableReorder(
          active.id as string,
          over.id as string,
          activeMoment.day,
          activeMoment.phase,
        );
        return;
      }

      // Cross-cell drop: dragged onto a moment in a different cell
      if (overMoment.day && overMoment.phase) {
        handleDropOnTimelineCell(
          dragData as Extract<DraggableData, { type?: undefined }>,
          {
            targetType: "timeline-cell",
            targetDay: overMoment.day,
            targetPhase: overMoment.phase,
          },
          wasDuplicateMode,
        );
        return;
      }
    }

    if (!dragData || !dropData) {
      console.warn("Missing drag/drop data", { dragData, dropData });
      return;
    }

    // Virtual deck card drag (derive paradigm) — materialize on allocation.
    if (dragData.type === "deck-card") {
      if (dropData.targetType === "timeline-cell") {
        handleAllocateFromPlan(dragData, dropData);
      }
      // Deck card dropped on deck or elsewhere: no-op.
      return;
    }

    const momentId = dragData.momentId;
    if (!momentId) {
      console.warn("Missing momentId in drag data", dragData);
      return;
    }
    const moment = allMoments[momentId];

    if (!moment) {
      console.error("Moment not found:", momentId);
      return;
    }

    // Handle different drop target types
    switch (dropData.targetType) {
      case "timeline-cell":
        handleDropOnTimelineCell(dragData, dropData, wasDuplicateMode);
        break;

      case "cycle-deck":
        // Unallocate moment back to cycle deck (only if coming from timeline)
        if (!wasDuplicateMode && dragData.sourceType === "timeline") {
          handleUnallocateMoment(dragData);
        }
        break;

      default:
        console.warn("Unknown drop target type:", dropData.targetType);
    }
  }

  /**
   * Allocate a virtual deck card into a timeline slot.
   * Calls `CycleService.allocateFromPlan` which materializes a new Moment
   * linked to the plan. Errors (over-budget, slot full, etc.) are surfaced
   * via alert().
   */
  function handleAllocateFromPlan(
    dragData: Extract<DraggableData, { type: "deck-card" }>,
    dropData: DroppableData,
  ) {
    const { cycleId, habitId } = dragData;
    const { targetDay, targetPhase } = dropData;

    if (!targetDay || !targetPhase) {
      console.warn("timeline-cell drop missing day/phase", dropData);
      return;
    }

    const service = new CycleService();
    const result = service.allocateFromPlan({
      cycleId,
      habitId,
      day: targetDay,
      phase: targetPhase,
    });

    if ("error" in result) {
      alert(result.error);
    }
  }

  function handleSortableReorder(
    activeId: string,
    overId: string,
    day: string,
    phase: Phase,
  ) {
    // Get all moments in this cell, sorted by current order
    const cellMoments = Object.values(allMoments)
      .filter((m) => m.day === day && m.phase === phase)
      .sort((a, b) => a.order - b.order);

    const oldIndex = cellMoments.findIndex((m) => m.id === activeId);
    const newIndex = cellMoments.findIndex((m) => m.id === overId);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Reorder the array
    const reordered = [...cellMoments];
    const [movedItem] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, movedItem);

    // Build reorder operations for history
    const reorders = reordered.map((moment, newOrder) => ({
      momentId: moment.id,
      fromOrder: moment.order,
      toOrder: newOrder,
    }));

    // Apply with history tracking
    reorderMomentsWithHistory(day, phase, reorders);
  }

  function handleUnallocateMoment(
    dragData: Extract<DraggableData, { type?: undefined }>,
  ) {
    const { momentId, sourceDay, sourcePhase } = dragData;

    // Only process if moment was allocated (coming from timeline)
    if (!momentId || !sourceDay || !sourcePhase) {
      return; // Already unallocated or missing id
    }

    const moment = allMoments[momentId];
    if (!moment) return;

    // Derive paradigm: plan-linked moments are deleted on unallocate
    // (the virtual ghost in the deck auto-reappears as allocatedCount drops).
    // Spontaneous moments (cyclePlanId === null) have no deck home, so
    // unallocating them would send them into an invisible null-day/null-phase
    // state. Reject instead; the user must delete them explicitly.
    if (moment.cyclePlanId === null) {
      alert("This moment isn't part of a season plan — delete it instead");
      return;
    }

    const service = new CycleService();
    const result = service.unallocateMoment(momentId);
    if ("error" in result) {
      alert(result.error);
    }
  }

  function handleBatchUnallocate(momentIds: string[]) {
    const service = new CycleService();

    // Reject the whole batch if any moment is spontaneous — no silent
    // fallback to an invisible null-day/null-phase state.
    const spontaneous = momentIds.filter((id) => {
      const m = allMoments[id];
      return m?.day && m.phase && m.cyclePlanId === null;
    });
    if (spontaneous.length > 0) {
      alert("This moment isn't part of a season plan — delete it instead");
      return;
    }

    startBatch();

    for (const momentId of momentIds) {
      const moment = allMoments[momentId];
      if (!moment) continue;

      const sourceDay = moment.day;
      const sourcePhase = moment.phase;

      if (!sourceDay || !sourcePhase) {
        continue; // Already unallocated
      }

      const result = service.unallocateMoment(momentId);
      if ("error" in result) {
        console.warn("[DnD] Unallocate failed:", result.error);
      }
    }

    endBatch(`Unallocated ${momentIds.length} moments`);
  }

  function handleDropOnTimelineCell(
    dragData: Extract<DraggableData, { type?: undefined }>,
    dropData: DroppableData,
    shouldDuplicate = false,
  ) {
    const { momentId, sourceDay, sourcePhase } = dragData;
    const { targetDay, targetPhase } = dropData;

    if (!targetDay || !targetPhase) {
      console.error("Timeline cell missing day/phase", dropData);
      return;
    }

    const isSameCell = sourceDay === targetDay && sourcePhase === targetPhase;

    if (isSameCell && !shouldDuplicate) {
      // Reordering within the same cell - handled by sortable
      // We don't need to do anything here, @dnd-kit/sortable handles it
      return;
    }

    // Moving/duplicating to a different cell (or duplicating in same cell)
    // Validate max-3 constraint
    const validation = canDropInCell(
      targetDay,
      targetPhase,
      allMoments,
      shouldDuplicate ? "" : momentId, // Don't exclude original if duplicating
    );

    if (!validation.isValid) {
      console.warn("Cannot drop:", validation.reason);
      // TODO: Show visual feedback (red border flash)
      return;
    }

    // Calculate next available order in target cell
    const newOrder = calculateNextOrder(
      targetDay,
      targetPhase,
      allMoments,
      shouldDuplicate ? "" : momentId,
    );

    if (shouldDuplicate) {
      // Duplicate mode: create a copy of the moment in the target cell
      duplicateMomentWithHistory(
        momentId,
        targetDay,
        targetPhase as Phase,
        newOrder,
      );
    } else {
      // Move mode: batch the move + any reorders
      startBatch();

      // Calculate reorders in source cell (if moving from timeline)
      const reorders =
        sourceDay && sourcePhase
          ? reorderAfterRemoval(
              sourceDay,
              sourcePhase,
              allMoments,
              momentId,
            ).map(({ momentId: id, newOrder: order }) => ({
              momentId: id,
              fromOrder: allMoments[id].order,
              toOrder: order,
            }))
          : undefined;

      // Apply move with history
      moveMomentWithHistory(
        momentId,
        targetDay,
        targetPhase as Phase,
        newOrder,
        reorders,
      );

      endBatch(`Moved moment to ${targetDay} ${targetPhase}`);
    }
  }

  /**
   * Handle batch drop of multiple selected moments on timeline cell
   */
  function handleBatchDropOnTimelineCell(
    momentIds: string[],
    dropData: DroppableData,
    shouldDuplicate = false,
  ) {
    const { targetDay, targetPhase } = dropData;

    if (!targetDay || !targetPhase) {
      console.error("Timeline cell missing day/phase", dropData);
      return;
    }

    // Check if we have enough space for all selected moments
    const currentMomentsInCell = Object.values(allMoments).filter(
      (m) => m.day === targetDay && m.phase === targetPhase,
    );

    const spaceNeeded = shouldDuplicate
      ? momentIds.length
      : momentIds.length -
        momentIds.filter((id) => {
          const m = allMoments[id];
          return m && m.day === targetDay && m.phase === targetPhase;
        }).length;

    const availableSpace = 3 - currentMomentsInCell.length;

    if (spaceNeeded > availableSpace) {
      console.warn(
        `Cannot drop ${momentIds.length} moments: only ${availableSpace} spaces available`,
      );
      // TODO: Show visual feedback
      return;
    }

    // Batch all the moves/duplicates together
    startBatch();

    let currentOrder = calculateNextOrder(
      targetDay,
      targetPhase,
      allMoments,
      shouldDuplicate ? "" : momentIds[0],
    );

    for (const momentId of momentIds) {
      const moment = allMoments[momentId];
      if (!moment) {
        console.warn("[DnD] Moment not found:", momentId);
        continue;
      }

      if (shouldDuplicate) {
        // Duplicate each moment to the target cell
        duplicateMomentWithHistory(
          momentId,
          targetDay,
          targetPhase as Phase,
          currentOrder,
        );
        currentOrder++;
      } else {
        // Move each moment to the target cell
        const sourceDay = moment.day;
        const sourcePhase = moment.phase;

        // Skip if already in target cell
        if (sourceDay === targetDay && sourcePhase === targetPhase) {
          continue;
        }

        // Calculate reorders in source cell (if moving from timeline)
        const reorders =
          sourceDay && sourcePhase
            ? reorderAfterRemoval(
                sourceDay,
                sourcePhase,
                allMoments,
                momentId,
              ).map(({ momentId: id, newOrder: order }) => ({
                momentId: id,
                fromOrder: allMoments[id].order,
                toOrder: order,
              }))
            : undefined;

        // Apply move with history
        moveMomentWithHistory(
          momentId,
          targetDay,
          targetPhase as Phase,
          currentOrder,
          reorders,
        );
        currentOrder++;
      }
    }

    endBatch(
      shouldDuplicate
        ? `Duplicated ${momentIds.length} moments to ${targetDay} ${targetPhase}`
        : `Moved ${momentIds.length} moments to ${targetDay} ${targetPhase}`,
    );
  }

  function handleDragCancel() {
    setActiveId(null);
    setActiveDeckHabitId(null);
    isDuplicateMode$.set(false);
  }

  // Get active moment for drag overlay
  const activeMoment = activeId ? allMoments[activeId] : null;
  const activeArea = activeMoment ? allAreas[activeMoment.areaId] : null;

  // Get active deck-card habit for drag overlay (moment-shaped preview)
  const activeDeckHabit = activeDeckHabitId
    ? allHabits[activeDeckHabitId]
    : null;
  const activeDeckArea = activeDeckHabit
    ? allAreas[activeDeckHabit.areaId]
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      autoScroll={false}
    >
      {children}

      {/* Drag overlay shows preview of dragged item(s). Null dropAnimation
          avoids the snap-back when deck-card drops materialize a new moment —
          the source draggable disappears, so the default return animation
          looks like the card bounced away from the slot it just filled. */}
      <DragOverlay dropAnimation={null}>
        {activeMoment && activeArea ? (
          <div
            className={isDuplicateMode ? "cursor-copy" : "cursor-grabbing"}
            style={{ width: columnWidth.md }}
          >
            {/* Check if dragging multiple selected moments */}
            {selectedMomentIds.includes(activeMoment.id) &&
            selectedMomentIds.length > 1 ? (
              // Show stacked preview for multiple items
              <div className="relative">
                {/* Show up to 3 cards in a stacked effect */}
                {selectedMomentIds.slice(0, 3).map((momentId, index) => {
                  const moment = allMoments[momentId];
                  const area = moment ? allAreas[moment.areaId] : null;
                  if (!moment || !area) return null;

                  return (
                    <div
                      key={momentId}
                      className="absolute"
                      style={{
                        top: `${index * 8}px`,
                        left: `${index * 8}px`,
                        zIndex: 3 - index,
                        opacity: index === 0 ? 1 : 0.6,
                      }}
                    >
                      <MomentCard moment={moment} area={area} />
                    </div>
                  );
                })}
                {/* Show count badge if more than 3 selected */}
                {selectedMomentIds.length > 3 && (
                  <div
                    className="absolute bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold font-mono"
                    style={{
                      top: "24px",
                      right: "-12px",
                      zIndex: 4,
                    }}
                  >
                    {selectedMomentIds.length}
                  </div>
                )}
              </div>
            ) : (
              // Single moment - show normally
              <MomentCard moment={activeMoment} area={activeArea} />
            )}
          </div>
        ) : activeDeckHabit && activeDeckArea ? (
          <div className="cursor-grabbing" style={{ width: columnWidth.md }}>
            <DeckCardPreview habit={activeDeckHabit} area={activeDeckArea} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
