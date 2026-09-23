"use client";

import {
  horizontalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable";
import { observer, use$ } from "@legendapp/state/react";
import { AreaService } from "@/application/services/AreaService";
import { HabitService } from "@/application/services/HabitService";
import { AreaBoardColumn } from "@/components/AreaBoardColumn";
import { EmptyAreaColumn } from "@/components/EmptyAreaColumn";
import { GardenGlyph } from "@/components/GardenGlyph";
import { HabitFormDialog } from "@/components/HabitFormDialog";
import type { Area, UpdateAreaProps } from "@/domain/entities/Area";
import type {
  CreateHabitProps,
  UpdateHabitProps,
} from "@/domain/entities/Habit";
import {
  activeAreas$,
  activeHabits$,
  archivedHabits$,
} from "@/infrastructure/state/store";
import {
  closeHabitForm,
  habitFormState$,
  openDeleteAreaDialog,
  openHabitFormCreate,
  openHabitFormEdit,
} from "@/infrastructure/state/ui-store";

export const AreaBoardBuilder = observer(() => {
  const areaService = new AreaService();
  const habitService = new HabitService();

  const areas = use$(activeAreas$);
  const habits = use$(activeHabits$);
  const archivedHabits = use$(archivedHabits$);

  const sortedAreas = [...areas].sort((a, b) => a.order - b.order);

  // Group habits by area
  const habitsByArea: Record<string, typeof habits> = {};
  for (const habit of habits) {
    if (!habitsByArea[habit.areaId]) {
      habitsByArea[habit.areaId] = [];
    }
    habitsByArea[habit.areaId].push(habit);
  }

  // Group archived (resting) habits by area
  const archivedByArea: Record<string, typeof archivedHabits> = {};
  for (const habit of archivedHabits) {
    if (!archivedByArea[habit.areaId]) {
      archivedByArea[habit.areaId] = [];
    }
    archivedByArea[habit.areaId].push(habit);
  }

  // Area CRUD
  const handleCreateArea = (name: string, emoji: string, color: string) => {
    const result = areaService.createArea({
      name,
      emoji,
      color,
      order: areas.length,
    });
    if ("error" in result) {
      alert(`Failed to create area: ${result.error}`);
    }
  };

  const handleUpdateArea = (areaId: string, updates: UpdateAreaProps) => {
    const result = areaService.updateArea(areaId, updates);
    if ("error" in result) {
      alert(`Failed to update area: ${result.error}`);
    }
  };

  const handleDeleteArea = (areaId: string) => {
    const area = areas.find((a) => a.id === areaId);
    if (area) {
      openDeleteAreaDialog(areaId, area.name);
    }
  };

  // Habit CRUD
  const handleOpenCreateHabit = (areaId: string) => {
    openHabitFormCreate({ areaId });
  };

  const handleEditHabit = (habitId: string) => {
    const habit = habits.find((h) => h.id === habitId);
    if (habit) {
      openHabitFormEdit(habitId, habit);
    }
  };

  const handleArchiveHabit = (habitId: string) => {
    const result = habitService.archiveHabit(habitId);
    if ("error" in result) {
      alert(`Failed to archive habit: ${result.error}`);
    }
  };

  const handleUnarchiveHabit = (habitId: string) => {
    const result = habitService.unarchiveHabit(habitId);
    if ("error" in result) {
      alert(`Failed to restore habit: ${result.error}`);
    }
  };

  const handleDeleteArchivedHabit = (habitId: string) => {
    const result = habitService.deleteHabit(habitId);
    if ("error" in result) {
      alert(`Failed to delete habit: ${result.error}`);
    }
  };

  const handleSaveHabit = (props: CreateHabitProps | UpdateHabitProps) => {
    const formState = habitFormState$.peek();

    if (formState.mode === "edit" && formState.editingHabitId) {
      const result = habitService.updateHabit(formState.editingHabitId, props);
      if ("error" in result) {
        alert(`Failed to update habit: ${result.error}`);
      }
    } else {
      const areaHabits = habitsByArea[props.areaId!] || [];
      const result = habitService.createHabit({
        ...props,
        order: areaHabits.length,
      } as CreateHabitProps);
      if ("error" in result) {
        alert(`Failed to create habit: ${result.error}`);
      }
    }
  };

  const handleDeleteHabit = () => {
    const formState = habitFormState$.peek();
    if (!formState.editingHabitId) return;

    const result = habitService.archiveHabit(formState.editingHabitId);
    if ("error" in result) {
      alert(`Failed to archive habit: ${result.error}`);
    }
    closeHabitForm();
  };

  if (sortedAreas.length === 0) {
    return <FirstRun onCreateArea={handleCreateArea} />;
  }

  return (
    <>
      <SortableContext
        items={sortedAreas.map((a) => a.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex gap-4 overflow-x-auto px-4 py-4 h-full snap-x snap-mandatory scroll-smooth">
          {sortedAreas.map((area: Area) => (
            <AreaBoardColumn
              key={area.id}
              area={area}
              habits={habitsByArea[area.id] || []}
              archivedHabits={archivedByArea[area.id] || []}
              onUpdateArea={handleUpdateArea}
              onDeleteArea={handleDeleteArea}
              onEditHabit={handleEditHabit}
              onArchiveHabit={handleArchiveHabit}
              onUnarchiveHabit={handleUnarchiveHabit}
              onDeleteHabit={handleDeleteArchivedHabit}
              onCreateHabit={() => handleOpenCreateHabit(area.id)}
            />
          ))}

          <EmptyAreaColumn onCreateArea={handleCreateArea} />
        </div>
      </SortableContext>

      <HabitFormDialog onSave={handleSaveHabit} onDelete={handleDeleteHabit} />
    </>
  );
});

const GESTURES = [
  [
    "plant",
    "Plant",
    "habits, people, places. What you grow, with whom, and where.",
  ],
  [
    "cultivate",
    "Cultivate",
    "tend and fence. Every day, tend what matters and fence out the weeds.",
  ],
  [
    "harvest",
    "Harvest",
    "reflect and tune. What it taught you; retune for the next season.",
  ],
] as const;

/** First run: an empty garden. One paragraph, the question, the first plot. */
function FirstRun({
  onCreateArea,
}: {
  onCreateArea: (name: string, emoji: string, color: string) => void;
}) {
  return (
    <div
      data-testid="first-run"
      className="h-full overflow-y-auto px-4 py-10 flex flex-col items-center"
    >
      <div className="max-w-md space-y-4 font-sans text-sm text-stone-600 dark:text-stone-400">
        <p>
          <span className="text-stone-900 dark:text-stone-100">
            You are the gardener.
          </span>{" "}
          Your garden is your habit ecosystem, digital and physical. You already
          tend it. Zenborg is the toolshed.
        </p>
        <ul className="space-y-1">
          {GESTURES.map(([glyph, name, what]) => (
            <li key={name}>
              <GardenGlyph
                name={glyph}
                className="inline-block mr-2 -mt-0.5 align-middle"
              />
              <span className="font-mono text-stone-900 dark:text-stone-100">
                {name}
              </span>{" "}
              · {what}
            </li>
          ))}
        </ul>
        <p className="pt-2 text-stone-900 dark:text-stone-100">
          What will I tend to today?
        </p>
      </div>
      <div className="mt-6">
        <EmptyAreaColumn
          onCreateArea={onCreateArea}
          label="Plant your first area"
        />
      </div>
    </div>
  );
}
