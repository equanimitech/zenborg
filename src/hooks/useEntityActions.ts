import { useSelector } from "@legendapp/state/react";
import {
  Calendar,
  Edit3,
  type LucideIcon,
  PackagePlus,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { useMemo } from "react";
import { CycleService } from "@/application/services/CycleService";
import type { Area } from "@/domain/entities/Area";
import type { Habit } from "@/domain/entities/Habit";
import type { Moment } from "@/domain/entities/Moment";
import { getCurrentPhase } from "@/domain/value-objects/Phase";
import {
  activeCycle$,
  allocateMomentWithHistory,
  deleteMomentWithHistory,
  moments$,
  phaseConfigs$,
  unallocateMomentWithHistory,
} from "@/infrastructure/state/store";
import {
  momentFormState$,
  openHabitFormCreate,
  openHabitFormEdit,
  openMomentFormCreate,
  openMomentFormEdit,
} from "@/infrastructure/state/ui-store";
import type { SearchableEntity } from "./useCommandPaletteSearch";

export interface EntityAction {
  id: string;
  label: string;
  icon: LucideIcon;
  action: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Hook returning contextual actions for a selected entity in the command palette.
 *
 * Actions vary by entity type:
 * - Area: "Create habit in area", "Edit area"
 * - Habit: "Schedule to current cycle", "Create moment from habit", "Edit habit"
 * - Moment: "Tend today", "Move to drawing board", "Edit moment", "Delete moment"
 */
export function useEntityActions(
  selectedEntity: SearchableEntity | null,
): EntityAction[] {
  const activeCycle = useSelector(() => activeCycle$.get());
  const phaseConfigsMap = useSelector(() => phaseConfigs$.get());
  const allMoments = useSelector(() => moments$.get());

  return useMemo(() => {
    if (!selectedEntity) return [];

    const phaseConfigs = Object.values(phaseConfigsMap);
    const today = new Date().toISOString().split("T")[0];
    const currentHour = new Date().getHours();
    const currentPhase = getCurrentPhase(currentHour, phaseConfigs);

    switch (selectedEntity.type) {
      case "area": {
        const area = selectedEntity.entity as Area;
        return [
          {
            id: "area.create-habit",
            label: "Create habit in area",
            icon: Plus,
            action: () => openHabitFormCreate({ areaId: area.id }),
          },
        ];
      }

      case "habit": {
        const habit = selectedEntity.entity as Habit;
        const actions: EntityAction[] = [];

        // Schedule to current cycle (only if active cycle exists)
        if (activeCycle) {
          actions.push({
            id: "habit.schedule",
            label: "Schedule to current cycle",
            icon: PackagePlus,
            action: () => {
              const service = new CycleService();
              service.budgetHabitToCycle(activeCycle.id, habit.id, 1);
            },
          });
        }

        // Create moment from habit
        actions.push({
          id: "habit.create-moment",
          label: "Create moment from habit",
          icon: Plus,
          action: () => {
            openMomentFormCreate({
              areaId: habit.areaId,
              phase: habit.phase,
            });
            // Patch additional fields after openMomentFormCreate sets defaults
            momentFormState$.name.set(habit.name);
            momentFormState$.emoji.set(habit.emoji);
            if (habit.tags?.length) {
              momentFormState$.tags.set(habit.tags);
            }
          },
        });

        // Edit habit
        actions.push({
          id: "habit.edit",
          label: "Edit habit",
          icon: Edit3,
          action: () => openHabitFormEdit(habit.id, habit),
        });

        return actions;
      }

      case "moment": {
        const moment = selectedEntity.entity as Moment;
        const actions: EntityAction[] = [];
        const isAllocated = moment.day !== null && moment.phase !== null;

        if (!isAllocated && currentPhase) {
          // Count existing moments in today + current phase to determine order
          const existingCount = Object.values(allMoments).filter(
            (m) => m.day === today && m.phase === currentPhase,
          ).length;

          actions.push({
            id: "moment.allocate-today",
            label: "Tend today",
            icon: Calendar,
            action: () => {
              allocateMomentWithHistory(
                moment.id,
                today,
                currentPhase,
                existingCount,
              );
            },
          });
        }

        if (isAllocated) {
          actions.push({
            id: "moment.unallocate",
            label: "Move to drawing board",
            icon: Undo2,
            action: () => unallocateMomentWithHistory(moment.id),
          });
        }

        // Edit moment
        actions.push({
          id: "moment.edit",
          label: "Edit moment",
          icon: Edit3,
          action: () => openMomentFormEdit(moment.id, moment),
        });

        // Delete moment
        actions.push({
          id: "moment.delete",
          label: "Delete moment",
          icon: Trash2,
          action: () => deleteMomentWithHistory(moment.id),
        });

        return actions;
      }

      default:
        return [];
    }
  }, [selectedEntity, activeCycle, phaseConfigsMap, allMoments]);
}
