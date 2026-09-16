"use client";

import { use$, useSelector } from "@legendapp/state/react";
import { useEffect } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { HamburgerMenuButton } from "@/components/HamburgerMenuButton";
import { ModeSelector } from "@/components/ModeSelector";
import { SettingsModal } from "@/components/SettingsModal";
import { TodayButton } from "@/components/TodayButton";
import { UpdateNotification } from "@/components/UpdateNotification";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AreaService } from "@/application/services/AreaService";
import { useGlobalKeyboard } from "@/hooks/useGlobalKeyboard";
import {
  deleteAreaDialogState$,
  closeDeleteAreaDialog,
  isCommandPaletteOpen$,
  isSettingsOpen$,
  resetCommandPaletteState,
} from "@/infrastructure/state/ui-store";
import { isTauri } from "@/lib/tauri-utils";

/**
 * LayoutClient - Client-side layout components
 *
 * Provides:
 * - Mode selector (top-center)
 * - Hamburger menu
 * - Settings drawer
 * - Area management modal
 * - Phase settings modal
 * - Archive area dialog
 * - Command palette (Cmd+K)
 * - Global keyboard shortcuts (Cmd+1/2/3)
 */
export function LayoutClient({ children }: { children: React.ReactNode }) {
  // Enable global keyboard shortcuts (Cmd+K, etc.) - registers once globally
  useGlobalKeyboard();

  // Attach console to native Tauri log system (forwards console.* to OS log files)
  useEffect(() => {
    if (isTauri()) {
      import("@tauri-apps/plugin-log").then(({ attachConsole }) => {
        attachConsole();
      });
    }
  }, []);

  const isSettingsOpen = useSelector(() => isSettingsOpen$.get());
  const deleteAreaState = use$(deleteAreaDialogState$);
  const isCommandPaletteOpen = useSelector(() => isCommandPaletteOpen$.get());

  const handleConfirmDeleteArea = () => {
    if (!deleteAreaState.areaId) return;

    const areaService = new AreaService();
    const result = areaService.deleteArea(deleteAreaState.areaId);
    if ("error" in result) {
      alert(result.error);
    }

    closeDeleteAreaDialog();
  };

  return (
    <>
      <div className="h-dvh grid grid-rows-[auto_1fr]">
        {/* Top Bar - Unified navigation bar with mode selector and settings */}
        <div
          className="z-40 flex items-center justify-center bg-background"
          style={{
            paddingTop: "max(0.75rem, env(safe-area-inset-top) + 0.25rem)",
            paddingBottom: "0.5rem",
            paddingLeft: "max(1rem, env(safe-area-inset-left) + 0.5rem)",
            paddingRight: "max(1rem, env(safe-area-inset-right) + 0.5rem)",
          }}
        >
          {/* Left: Today button (visible when selectedDay is off-today) */}
          <div className="min-w-8 mr-2 flex items-center">
            <TodayButton />
          </div>

          {/* Center: Mode Selector */}
          <ModeSelector />

          {/* Right: Settings button */}
          <div className="ml-2">
            <HamburgerMenuButton
              isOpen={isSettingsOpen}
              onClick={() => isSettingsOpen$.set(!isSettingsOpen)}
            />
          </div>
        </div>

        {/* Page Content - Contained below top bar */}
        <div className="overflow-hidden">{children}</div>
      </div>

      {/* Update Notification - Auto-checks on mount */}
      <UpdateNotification />

      {/* Settings Modal - Triggered by Mod+, or settings button */}
      <SettingsModal
        open={isSettingsOpen}
        onClose={() => isSettingsOpen$.set(false)}
      />

      {/* Delete Area Confirmation */}
      {deleteAreaState.open && deleteAreaState.areaName && (
        <Dialog open={true} onOpenChange={closeDeleteAreaDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {deleteAreaState.areaName}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-stone-600 dark:text-stone-400">
                This area will be permanently removed. Areas with habits or
                moments cannot be deleted.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={closeDeleteAreaDialog}
                  className="px-4 py-2 rounded-lg font-mono text-sm bg-stone-200 hover:bg-stone-300 text-stone-900 dark:bg-stone-700 dark:hover:bg-stone-600 dark:text-stone-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteArea}
                  className="px-4 py-2 rounded-lg font-mono text-sm bg-red-600 hover:bg-red-700 text-white dark:bg-red-500 dark:hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Command Palette - Global across all routes */}
      <CommandPalette
        open={isCommandPaletteOpen}
        onClose={() => {
          isCommandPaletteOpen$.set(false);
          resetCommandPaletteState();
        }}
      />
    </>
  );
}
