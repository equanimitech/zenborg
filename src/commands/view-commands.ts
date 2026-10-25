import { activeCycle$ } from "@/infrastructure/state/store";
import {
  cycleDeckCollapsed$,
  isCommandPaletteOpen$,
  isSettingsOpen$,
  setPlantEntity,
} from "@/infrastructure/state/ui-store";
import { nudgeVault } from "@/infrastructure/vault/adapter";
import { isTauri } from "@/infrastructure/vault/is-tauri.ts";
import type { Command } from "./types";

export const viewCommands: Command[] = [
  {
    id: "view.commandPalette",
    label: "Open Command Palette",
    shortcut: "mod+k",
    category: "Views",
    keywords: ["search", "commands", "palette"],
    action: () => {
      isCommandPaletteOpen$.set(true);
    },
  },
  {
    id: "view.planning.toggle",
    label: "Toggle Planning Panel",
    shortcut: "p",
    category: "Views",
    keywords: ["show", "hide", "cycle", "deck", "collapse"],
    action: () => {
      const cycle = activeCycle$.peek();
      if (cycle) {
        cycleDeckCollapsed$.set(!cycleDeckCollapsed$.peek());
      }
    },
  },
  {
    id: "view.plant",
    label: "Go to Plant",
    shortcut: "mod+1",
    category: "Views",
    keywords: ["plant", "day", "board"],
    action: () => {
      window.location.href = "/plant";
    },
  },
  {
    id: "view.cultivate",
    label: "Go to Cultivate",
    shortcut: "mod+2",
    category: "Views",
    keywords: ["cultivate", "timeline"],
    action: () => {
      window.location.href = "/cultivate";
    },
  },
  {
    id: "view.harvest",
    label: "Go to Harvest",
    shortcut: "mod+3",
    category: "Views",
    keywords: ["harvest", "review"],
    action: () => {
      window.location.href = "/harvest";
    },
  },
  {
    id: "view.plant.habits",
    label: "View Habits",
    shortcut: "shift+1",
    category: "Views",
    keywords: ["areas", "plots", "habits", "plant"],
    action: () => {
      setPlantEntity("habits");
    },
  },
  {
    id: "view.plant.people",
    label: "View People",
    shortcut: "shift+2",
    category: "Views",
    keywords: ["people", "contacts", "friends", "family"],
    action: () => {
      setPlantEntity("people");
    },
  },
  {
    // Tauri disables reload in production. Re-read the vault in place rather
    // than reload the page: a reload boots from the IndexedDB cache and can
    // drop a write still inside its 2s debounce. The nudge re-runs every
    // collection's get() against the files, and pending local edits survive.
    id: "view.reloadVault",
    label: "Reload from Vault",
    shortcut: "mod+r",
    category: "Views",
    keywords: ["reload", "refresh", "sync", "vault"],
    action: () => {
      if (isTauri()) {
        void nudgeVault();
      } else {
        window.location.reload();
      }
    },
  },
  {
    id: "view.settings",
    label: "Open Settings",
    shortcut: "mod+comma",
    category: "Views",
    keywords: ["preferences", "configure"],
    action: () => {
      isSettingsOpen$.set(!isSettingsOpen$.peek());
    },
  },
];
