"use client";

import { use$ } from "@legendapp/state/react";
import { DialogTitle } from "@radix-ui/react-dialog";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command as CommandType } from "@/commands";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Area } from "@/domain/entities/Area";
import type { Moment } from "@/domain/entities/Moment";
import {
  type AppMode,
  type SearchableEntity,
  useCommandPaletteSearch,
} from "@/hooks/useCommandPaletteSearch";
import { useEntityActions } from "@/hooks/useEntityActions";
import {
  commandPaletteState$,
  resetCommandPaletteState,
} from "@/infrastructure/state/ui-store";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * CommandPalette - Enhanced two-level command + entity search palette
 *
 * Level 1 (root): Search commands and entities (areas, habits, moments)
 * Level 2 (entity-actions): Contextual quick actions for a selected entity
 *
 * Entity visibility depends on current route:
 * - Plant mode: areas + habits
 * - Cultivate mode: moments
 * - Harvest mode: commands only
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const paletteState = use$(commandPaletteState$);

  // Detect mode from pathname
  const pathname = usePathname();
  const mode: AppMode = useMemo(() => {
    if (pathname.startsWith("/plant")) return "plant";
    if (pathname.startsWith("/harvest")) return "harvest";
    return "cultivate";
  }, [pathname]);

  // Search results
  const searchResult = useCommandPaletteSearch(mode, search);

  // Resolve selected entity for actions page
  const selectedEntity = useMemo<SearchableEntity | null>(() => {
    if (paletteState.page !== "entity-actions" || !paletteState.selectedEntity)
      return null;

    const { type, id } = paletteState.selectedEntity;

    // Find in search results or reconstruct
    const allEntities = [
      ...searchResult.areas,
      ...searchResult.habits,
      ...searchResult.moments,
    ];
    return allEntities.find((e) => e.type === type && e.id === id) ?? null;
  }, [paletteState, searchResult]);

  // Entity actions
  const entityActions = useEntityActions(selectedEntity);

  // Reset search when closing or switching pages
  useEffect(() => {
    if (!open) {
      setSearch("");
      resetCommandPaletteState();
    }
  }, [open]);

  // Focus input when opening or returning to root
  useEffect(() => {
    if (open && paletteState.page === "root") {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, paletteState.page]);

  const handleClose = useCallback(() => {
    setSearch("");
    resetCommandPaletteState();
    onClose();
  }, [onClose]);

  const handleSelectCommand = useCallback(
    (command: CommandType) => {
      command.action();
      handleClose();
    },
    [handleClose],
  );

  const handleSelectEntity = useCallback((entity: SearchableEntity) => {
    commandPaletteState$.set({
      page: "entity-actions",
      selectedEntity: { type: entity.type, id: entity.id },
    });
    setSearch("");
  }, []);

  const handleSelectAction = useCallback(
    (action: { action: () => void; disabled?: boolean }) => {
      if (action.disabled) return;
      action.action();
      handleClose();
    },
    [handleClose],
  );

  const handleBackToRoot = useCallback(() => {
    commandPaletteState$.set({ page: "root", selectedEntity: null });
    setSearch("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Handle backspace on empty to go back
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        search === "" &&
        paletteState.page === "entity-actions"
      ) {
        e.preventDefault();
        handleBackToRoot();
      }
    },
    [search, paletteState.page, handleBackToRoot],
  );

  const hasEntityResults =
    searchResult.areas.length > 0 ||
    searchResult.habits.length > 0 ||
    searchResult.moments.length > 0;

  const isSearching = search.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="p-0 max-w-[640px]">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <Command shouldFilter={false}>
          {paletteState.page === "root" ? (
            <>
              <CommandInput
                ref={inputRef}
                placeholder={
                  mode === "plant"
                    ? "Search commands, areas, habits..."
                    : mode === "cultivate"
                      ? "Search commands, moments..."
                      : "Search commands..."
                }
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>

                {/* Entity results (only when searching) */}
                {isSearching && hasEntityResults && (
                  <>
                    {searchResult.areas.length > 0 && (
                      <CommandGroup heading="Areas">
                        {searchResult.areas.map((entity) => (
                          <EntityItem
                            key={entity.id}
                            entity={entity}
                            onSelect={() => handleSelectEntity(entity)}
                          />
                        ))}
                      </CommandGroup>
                    )}

                    {searchResult.habits.length > 0 && (
                      <CommandGroup heading="Habits">
                        {searchResult.habits.map((entity) => (
                          <EntityItem
                            key={entity.id}
                            entity={entity}
                            onSelect={() => handleSelectEntity(entity)}
                          />
                        ))}
                      </CommandGroup>
                    )}

                    {searchResult.moments.length > 0 && (
                      <CommandGroup heading="Moments">
                        {searchResult.moments.map((entity) => (
                          <EntityItem
                            key={entity.id}
                            entity={entity}
                            onSelect={() => handleSelectEntity(entity)}
                          />
                        ))}
                      </CommandGroup>
                    )}

                    {searchResult.commands.length > 0 && <CommandSeparator />}
                  </>
                )}

                {/* Commands */}
                {searchResult.commands.length > 0 && (
                  <CommandsSection
                    commands={searchResult.commands}
                    onSelect={handleSelectCommand}
                  />
                )}
              </CommandList>
            </>
          ) : (
            <>
              {/* Entity actions page */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only
                  delegates keys to the CommandInput below, which is the interactive element */}
              <div onKeyDown={handleKeyDown}>
                <CommandInput
                  ref={inputRef}
                  placeholder="Search actions..."
                  value={search}
                  onValueChange={setSearch}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <CommandList>
                {/* Entity header */}
                {selectedEntity && (
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-200 dark:border-stone-700">
                    <button
                      type="button"
                      onClick={handleBackToRoot}
                      className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                      aria-label="Back to search"
                    >
                      <ArrowLeft className="w-4 h-4 text-stone-400" />
                    </button>
                    <span className="text-lg">
                      {selectedEntity.emoji || ""}
                    </span>
                    <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                      {selectedEntity.name}
                    </span>
                    {selectedEntity.areaColor && selectedEntity.areaName && (
                      <span
                        className="text-xs font-mono px-1.5 py-0.5 rounded"
                        style={{
                          color: selectedEntity.areaColor,
                          backgroundColor: `${selectedEntity.areaColor}15`,
                        }}
                      >
                        {selectedEntity.areaName}
                      </span>
                    )}
                  </div>
                )}

                <CommandEmpty>No actions available.</CommandEmpty>

                <CommandGroup heading="Actions">
                  {entityActions
                    .filter((action) => {
                      if (!search.trim()) return true;
                      return action.label
                        .toLowerCase()
                        .includes(search.trim().toLowerCase());
                    })
                    .map((action) => (
                      <CommandItem
                        key={action.id}
                        value={action.id}
                        onSelect={() => handleSelectAction(action)}
                        disabled={action.disabled}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                      >
                        <action.icon className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                        <span className="text-sm font-medium">
                          {action.label}
                        </span>
                        {action.disabled && action.disabledReason && (
                          <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">
                            {action.disabledReason}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Renders an entity item in the search results (area, habit, or moment)
 */
function EntityItem({
  entity,
  onSelect,
}: {
  entity: SearchableEntity;
  onSelect: () => void;
}) {
  const moment = entity.type === "moment" ? (entity.entity as Moment) : null;
  const isAllocated = moment?.day !== null && moment?.day !== undefined;

  return (
    <CommandItem
      value={`${entity.type}-${entity.id}`}
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
    >
      {/* Entity emoji */}
      <span className="text-sm flex-shrink-0">
        {entity.emoji ||
          (entity.type === "area" ? (entity.entity as Area).emoji : "")}
      </span>

      {/* Entity name */}
      <span className="text-sm font-medium flex-1 min-w-0 truncate">
        {entity.name}
      </span>

      {/* Area color dot + name (for habits and moments) */}
      {entity.areaColor && entity.areaName && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entity.areaColor }}
          />
          <span
            className="text-xs font-mono"
            style={{ color: entity.areaColor }}
          >
            {entity.areaName}
          </span>
        </div>
      )}

      {/* Moment allocation indicator */}
      {entity.type === "moment" && (
        <span className="text-xs text-stone-400 dark:text-stone-500">
          {isAllocated ? moment?.day : "not yet tended"}
        </span>
      )}
    </CommandItem>
  );
}

/**
 * Renders grouped commands section
 */
function CommandsSection({
  commands,
  onSelect,
}: {
  commands: CommandType[];
  onSelect: (cmd: CommandType) => void;
}) {
  // Group by category
  const grouped = useMemo(() => {
    return commands.reduce(
      (acc, cmd) => {
        if (!acc[cmd.category]) {
          acc[cmd.category] = [];
        }
        acc[cmd.category].push(cmd);
        return acc;
      },
      {} as Record<string, CommandType[]>,
    );
  }, [commands]);

  return (
    <>
      {Object.entries(grouped).map(
        ([category, cmds]: [string, CommandType[]]) => (
          <CommandGroup key={category} heading={category}>
            {cmds.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={cmd.id}
                onSelect={() => onSelect(cmd)}
                className="flex items-center justify-between px-3 py-2 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {cmd.icon && <span>{cmd.icon}</span>}
                  <span className="text-sm font-medium">{cmd.label}</span>
                </div>
                {cmd.shortcut && (
                  <kbd className="ml-auto text-xs px-2 py-1 rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 font-mono">
                    {cmd.shortcut}
                  </kbd>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ),
      )}
    </>
  );
}
