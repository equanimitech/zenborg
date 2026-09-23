"use client";

import { use$ } from "@legendapp/state/react";
import { AtSign, Timer, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  RelationshipTagger,
  useRelationshipFromMention,
} from "@/components/RelationshipTagger";
import {
  type SelectorOption,
  SelectorPopover,
} from "@/components/SelectorPopover";
import { TaggedNameInput } from "@/components/TaggedNameInput";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Cadence } from "@/domain/value-objects/Cadence";
import { useTaggedNameField } from "@/hooks/useTaggedNameField";
import { relationships$ } from "@/infrastructure/state/store";
import {
  closePersonForm,
  personFormState$,
} from "@/infrastructure/state/ui-store";

const CADENCE_OPTIONS: SelectorOption<Cadence | null>[] = [
  {
    value: null,
    label: "No cadence",
    icon: "○",
    className: "font-mono text-stone-500 dark:text-stone-400",
    hotkey: "0",
  },
  {
    value: "weekly",
    label: "Weekly",
    icon: "⟳",
    className: "font-mono text-stone-700 dark:text-stone-300",
    hotkey: "W",
  },
  {
    value: "monthly",
    label: "Monthly",
    icon: "⟳",
    className: "font-mono text-stone-700 dark:text-stone-300",
    hotkey: "M",
  },
  {
    value: "quarterly",
    label: "Quarterly",
    icon: "⟳",
    className: "font-mono text-stone-700 dark:text-stone-300",
    hotkey: "Q",
  },
  {
    value: "yearly",
    label: "Yearly",
    icon: "⟳",
    className: "font-mono text-stone-700 dark:text-stone-300",
    hotkey: "Y",
  },
];

interface PersonFormDialogProps {
  onSave: (props: {
    name: string;
    emoji: string | null;
    aliases: string[];
    tags: string[];
    cadence: Cadence | null;
    basePlaceId: string | null;
  }) => void;
  onDelete?: () => void;
}

export function PersonFormDialog({ onSave, onDelete }: PersonFormDialogProps) {
  const formState = use$(personFormState$);
  const { open, mode, name, emoji, aliases, tags, cadence, editingPersonId } =
    formState;

  const allRelationships = use$(relationships$);

  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [cadenceSelectorOpen, setCadenceSelectorOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const taggedField = useTaggedNameField(name, tags);
  const addRelFromMention = useRelationshipFromMention(
    "person",
    editingPersonId ?? null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds form state when the dialog opens
  useEffect(() => {
    if (!open) return;
    taggedField.reinitialize(name, tags);
  }, [open, editingPersonId]);

  useEffect(() => {
    if (!open) return;
    personFormState$.name.set(taggedField.displayValue);
  }, [taggedField.displayValue, open]);

  useEffect(() => {
    if (open) {
      setValidationError(null);
      setEmojiPickerOpen(false);
      setAliasesOpen(false);
      setCadenceSelectorOpen(false);
    }
  }, [open]);

  const handleSave = () => {
    const { name: cleanName, tags: finalTags } =
      taggedField.extractRemainingTags();
    if (!cleanName) {
      setValidationError("Name cannot be empty");
      return;
    }
    const basedInRel = editingPersonId
      ? Object.values(allRelationships).find(
          (r) =>
            r.label === "based-in" &&
            ((r.fromType === "person" &&
              r.fromId === editingPersonId &&
              r.toType === "place") ||
              (r.toType === "person" &&
                r.toId === editingPersonId &&
                r.fromType === "place" &&
                r.direction === "mutual")),
        )
      : null;
    const basePlaceId = basedInRel
      ? basedInRel.fromType === "person"
        ? basedInRel.toId
        : basedInRel.fromId
      : null;
    onSave({
      name: cleanName,
      emoji: emoji || null,
      aliases,
      tags: finalTags,
      cadence,
      basePlaceId,
    });
    closePersonForm();
  };

  const hotkeysEnabled =
    !emojiPickerOpen &&
    !aliasesOpen &&
    !cadenceSelectorOpen &&
    !taggedField.isAutocompleteOpen &&
    !taggedField.isMentionOpen &&
    open;

  useHotkeys(
    "enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    { enableOnFormTags: ["INPUT"], enabled: hotkeysEnabled },
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closePersonForm()}>
      <DialogContent
        ref={dialogRef}
        className="p-0 gap-0 max-w-2xl overflow-hidden"
        onEscapeKeyDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.tagName === "INPUT") {
            target.blur();
            e.preventDefault();
          } else if (name.trim().length > 0) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="border-b border-stone-200 dark:border-stone-700">
          <DialogTitle className="text-sm font-medium text-stone-600 dark:text-stone-400">
            {mode === "create" ? "New person" : "Edit person"}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-6 flex-1 overflow-y-auto overflow-x-hidden">
          {/* Name + Emoji + Tags (inline, same as habits) */}
          <div className="relative mb-6 w-full">
            <div className="flex items-baseline gap-3 min-w-0">
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="text-4xl flex-shrink-0 hover:bg-stone-100 dark:hover:bg-stone-800 rounded w-14 h-14 flex items-center justify-center transition-colors mt-1"
                    aria-label="Change emoji"
                  >
                    {emoji || "👤"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-fit p-0" align="start">
                  <EmojiPicker
                    className="h-[342px]"
                    onEmojiSelect={({ emoji: e }) => {
                      personFormState$.emoji.set(e);
                      setEmojiPickerOpen(false);
                    }}
                  >
                    <EmojiPickerSearch />
                    <EmojiPickerContent />
                    <EmojiPickerFooter />
                  </EmojiPicker>
                </PopoverContent>
              </Popover>

              <TaggedNameInput
                field={taggedField}
                placeholder={
                  mode === "edit" ? "Name... @mention #tag" : "Name... #tag"
                }
                autoFocus={true}
                className="flex-1 text-4xl font-bold"
                collisionBoundary={dialogRef.current}
                maxSuggestions={5}
                showTags={true}
                showMentions={false}
                includeAreas={true}
                onMentionSelect={
                  mode === "edit" ? addRelFromMention : undefined
                }
              />
            </div>
            {validationError && (
              <p
                className="text-sm text-red-500 dark:text-red-400 mt-2"
                role="alert"
              >
                {validationError}
              </p>
            )}
          </div>

          {/* Filled selectors (shown when value is set) */}
          <div className="flex flex-col gap-3">
            {/* Cadence — full-width button when set */}
            {cadence && (
              <SelectorPopover
                open={cadenceSelectorOpen}
                options={CADENCE_OPTIONS}
                selectedValue={cadence}
                onSelect={(v) => personFormState$.cadence.set(v)}
                onClose={() => setCadenceSelectorOpen(false)}
                onOpen={() => setCadenceSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <Timer className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {cadence}
                    </span>
                  </button>
                }
              />
            )}
          </div>

          {/* Relationships — shows all relationship chips (edit mode only) */}
          {mode === "edit" && editingPersonId && (
            <div className="mt-6">
              <RelationshipTagger
                entityType="person"
                entityId={editingPersonId}
              />
            </div>
          )}

          {/* Subtle wrapped row for empty selectors */}
          <div className="flex flex-wrap gap-3 items-center mt-8 mb-2">
            {/* Aliases */}
            <Popover
              open={aliasesOpen}
              onOpenChange={(isOpen) => {
                if (isOpen) setAliasesOpen(true);
                else setAliasesOpen(false);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                >
                  <AtSign className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span className="text-xs font-mono">
                    {aliases.length > 0
                      ? `${aliases.length} alias${aliases.length > 1 ? "es" : ""}`
                      : "no aliases"}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-80 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
              >
                <AliasesEditor
                  value={aliases}
                  onChange={(next) => personFormState$.aliases.set(next)}
                />
              </PopoverContent>
            </Popover>

            {/* Cadence — subtle chip when empty */}
            {!cadence && (
              <SelectorPopover
                open={cadenceSelectorOpen}
                options={CADENCE_OPTIONS}
                selectedValue={cadence}
                onSelect={(v) => personFormState$.cadence.set(v)}
                onClose={() => setCadenceSelectorOpen(false)}
                onOpen={() => setCadenceSelectorOpen(true)}
                collisionBoundary={dialogRef.current}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <Timer className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">no cadence</span>
                  </button>
                }
              />
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-stone-200 dark:border-stone-700 px-6 py-4">
          <div className="flex items-center justify-between w-full">
            {mode === "edit" && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-2 rounded-md text-xs font-mono text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={closePersonForm}
                className="px-4 py-2 rounded-sm font-mono text-sm bg-stone-200 hover:bg-stone-300 text-stone-900 dark:bg-stone-700 dark:hover:bg-stone-600 dark:text-stone-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 rounded-sm font-mono text-sm bg-stone-800 hover:bg-stone-900 text-white dark:bg-stone-200 dark:hover:bg-stone-300 dark:text-stone-900 transition-colors"
              >
                {mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AliasesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (
      !trimmed ||
      value.some((a) => a.toLowerCase() === trimmed.toLowerCase())
    ) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  return (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        <AtSign className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
        <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium">
          Aliases
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center border border-stone-200 dark:border-stone-700 rounded-md px-2 py-1.5 focus-within:border-stone-400 dark:focus-within:border-stone-500">
        {value.map((alias) => (
          <span
            key={alias}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-xs font-mono text-stone-700 dark:text-stone-300"
          >
            {alias}
            <button
              type="button"
              onClick={() => onChange(value.filter((a) => a !== alias))}
              className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
              aria-label={`Remove alias ${alias}`}
            >
              <X className="w-3 h-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          autoCapitalize="none"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              commitDraft();
            } else if (
              e.key === "Backspace" &&
              draft === "" &&
              value.length > 0
            ) {
              e.preventDefault();
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length === 0 ? "Add alias…" : ""}
          className="flex-1 min-w-[80px] bg-transparent text-xs font-mono text-stone-700 dark:text-stone-300 placeholder:text-stone-400 focus:outline-none"
        />
      </div>
      <p className="mt-2 text-[11px] font-mono text-stone-400 dark:text-stone-500">
        Enter to add. Alternate names that match when searching.
      </p>
    </>
  );
}
