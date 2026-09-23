import { createMoment } from "@/domain/entities/Moment";
import {
  createMomentWithHistory,
  unallocateMomentWithHistory,
} from "@/infrastructure/state/history-middleware";
import { selectionState$ } from "@/infrastructure/state/selection";
import { moments$ } from "@/infrastructure/state/store";
import {
  focusedMomentId$,
  momentFormState$,
} from "@/infrastructure/state/ui-store";
import type { Command } from "./types";

// Internal clipboard state (could also use Legend State observable)
let clipboardMoment: any = null;

export const clipboardCommands: Command[] = [
  {
    id: "clipboard.copy",
    label: "Copy Moment",
    shortcut: "mod+c",
    category: "Clipboard",
    keywords: ["duplicate", "yank"],
    action: () => {
      const focusedId = focusedMomentId$.get();
      if (!focusedId) return;

      const moment = moments$[focusedId].get();
      if (moment) {
        clipboardMoment = moment;
      }
    },
  },
  {
    id: "clipboard.paste",
    label: "Paste Moment",
    shortcut: "mod+v",
    category: "Clipboard",
    keywords: ["duplicate", "put"],
    action: () => {
      if (!clipboardMoment) return;

      const result = createMoment({
        name: clipboardMoment.name,
        areaId: clipboardMoment.areaId,
      });

      if (!("error" in result)) {
        createMomentWithHistory(result);
        focusedMomentId$.set(result.id);
      }
    },
  },
  {
    id: "clipboard.delete",
    label: "Set Aside or Delete Moment",
    shortcut: "backspace",
    category: "Clipboard",
    keywords: ["remove", "set aside", "unallocate"],
    action: () => {
      const focusedId = focusedMomentId$.get();
      if (!focusedId) return;

      const moment = moments$[focusedId].get();
      if (moment && moment.day !== null) {
        // Unallocate if allocated
        unallocateMomentWithHistory(focusedId);
      }
    },
  },
  {
    id: "selection.all",
    label: "Select All Moments",
    shortcut: "mod+a",
    category: "Selection",
    keywords: ["choose", "mark"],
    action: () => {
      const allMomentIds = Object.keys(moments$.peek());
      selectionState$.selectedMomentIds.set(allMomentIds);
    },
  },
  {
    id: "selection.clear",
    label: "Clear Selection",
    shortcut: "escape",
    category: "Selection",
    keywords: ["deselect", "none"],
    action: () => {
      selectionState$.selectedMomentIds.set([]);
      // Also close any open dialogs
      momentFormState$.open.set(false);
    },
  },
];
