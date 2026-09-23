/** biome-ignore-all lint/a11y/noAutofocus: inline edits open from a deliberate action, so focus has to follow it */
"use client";

import { use$ } from "@legendapp/state/react";
import {
  AtSign,
  Check,
  Copy,
  Link2,
  MapPin,
  MapPinned,
  Navigation,
  Trash2,
  TreePine,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { InitialMark } from "@/components/InitialMark";
import {
  RelationshipTagger,
  useRelationshipFromMention,
} from "@/components/RelationshipTagger";
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
import type { Coordinates } from "@/domain/entities/Place";
import { useTaggedNameField } from "@/hooks/useTaggedNameField";
import { places$ } from "@/infrastructure/state/store";
import {
  closePlaceForm,
  placeFormState$,
} from "@/infrastructure/state/ui-store";

interface PlaceFormDialogProps {
  onSave: (props: {
    name: string;
    emoji: string | null;
    parentKey: string | null;
    coordinates: Coordinates | null;
    address: string | null;
    url: string | null;
    tags: string[];
    aliases: string[];
  }) => void;
  onDelete?: () => void;
}

export function PlaceFormDialog({ onSave, onDelete }: PlaceFormDialogProps) {
  const formState = use$(placeFormState$);
  const {
    open,
    mode,
    emoji,
    parentKey,
    lat,
    lng,
    address,
    url,
    tags,
    aliases,
    editingPlaceId,
  } = formState;
  const name = formState.name;

  const allPlaces = use$(places$);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const taggedField = useTaggedNameField(name, tags);
  const addRelFromMention = useRelationshipFromMention(
    "place",
    editingPlaceId ?? null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds form state when dialog opens
  useEffect(() => {
    if (!open) return;
    taggedField.reinitialize(name, tags);
  }, [open, editingPlaceId]);

  useEffect(() => {
    if (!open) return;
    placeFormState$.name.set(taggedField.displayValue);
  }, [taggedField.displayValue, open]);

  useEffect(() => {
    if (open) {
      setValidationError(null);
      setEmojiPickerOpen(false);
      setParentOpen(false);
      setCoordsOpen(false);
      setAddressOpen(false);
      setUrlOpen(false);
      setAliasesOpen(false);
    }
  }, [open]);

  const possibleParents = useMemo(() => {
    const currentKey = editingPlaceId ? allPlaces[editingPlaceId]?.key : null;
    return Object.values(allPlaces)
      .filter((p) => p.key !== currentKey)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allPlaces, editingPlaceId]);

  const parentPlace = parentKey
    ? Object.values(allPlaces).find((p) => p.key === parentKey)
    : null;

  const hasCoords = lat.trim() !== "" || lng.trim() !== "";

  const handleSave = () => {
    const { name: cleanName, tags: finalTags } =
      taggedField.extractRemainingTags();
    if (!cleanName) {
      setValidationError("Name cannot be empty");
      return;
    }

    const parsedLat = Number.parseFloat(lat);
    const parsedLng = Number.parseFloat(lng);
    const coordinates: Coordinates | null =
      !Number.isNaN(parsedLat) && !Number.isNaN(parsedLng)
        ? { lat: parsedLat, lng: parsedLng }
        : null;

    onSave({
      name: cleanName,
      emoji: emoji || null,
      parentKey: parentKey || null,
      coordinates,
      address: address.trim() || null,
      url: url.trim() || null,
      tags: finalTags,
      aliases,
    });
  };

  const anyPopoverOpen =
    emojiPickerOpen ||
    parentOpen ||
    coordsOpen ||
    addressOpen ||
    urlOpen ||
    aliasesOpen ||
    taggedField.isAutocompleteOpen;
  const hotkeysEnabled = !anyPopoverOpen && open;

  useHotkeys(
    "enter",
    (e) => {
      e.preventDefault();
      handleSave();
    },
    { enableOnFormTags: ["INPUT", "SELECT"], enabled: hotkeysEnabled },
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closePlaceForm()}>
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
            {mode === "create" ? "New place" : "Edit place"}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-6 flex-1 overflow-y-auto overflow-x-hidden">
          {/* Name + Emoji */}
          <div className="relative mb-6 w-full">
            <div className="flex items-baseline gap-3 min-w-0">
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="text-4xl flex-shrink-0 hover:bg-stone-100 dark:hover:bg-stone-800 rounded w-14 h-14 flex items-center justify-center transition-colors mt-1"
                    aria-label="Change emoji"
                  >
                    {emoji || <InitialMark name={name} />}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-fit p-0" align="start">
                  <EmojiPicker
                    className="h-[342px]"
                    onEmojiSelect={({ emoji: e }) => {
                      placeFormState$.emoji.set(e);
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

          {/* Filled fields — bordered buttons */}
          <div className="flex flex-col gap-3">
            {/* Parent — shown when set */}
            {parentPlace && (
              <Popover open={parentOpen} onOpenChange={setParentOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <TreePine className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {parentPlace.emoji ? `${parentPlace.emoji} ` : ""}
                      {parentPlace.name}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                  <ParentPicker
                    value={parentKey}
                    options={possibleParents}
                    onChange={(v) => {
                      placeFormState$.parentKey.set(v);
                      setParentOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}

            {/* Coordinates — shown when set */}
            {hasCoords && (
              <Popover open={coordsOpen} onOpenChange={setCoordsOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <Navigation className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {lat || "—"}, {lng || "—"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-72 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
                >
                  <CoordinatesEditor lat={lat} lng={lng} />
                </PopoverContent>
              </Popover>
            )}

            {/* Address — shown when set */}
            {address.trim() && (
              <Popover open={addressOpen} onOpenChange={setAddressOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <MapPinned className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {address}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
                >
                  <TextFieldEditor
                    icon={
                      <MapPinned className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                    }
                    label="Address"
                    value={address}
                    onChange={(v) => placeFormState$.address.set(v)}
                    placeholder="Street, city, postal code"
                  />
                </PopoverContent>
              </Popover>
            )}

            {/* URL — shown when set */}
            {url.trim() && (
              <UrlField url={url} urlOpen={urlOpen} setUrlOpen={setUrlOpen} />
            )}

            {/* Aliases — shown when set */}
            {aliases.length > 0 && (
              <AliasesSelector
                open={aliasesOpen}
                value={aliases}
                onChange={(next) => placeFormState$.aliases.set(next)}
                onOpen={() => setAliasesOpen(true)}
                onClose={() => setAliasesOpen(false)}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 w-full"
                  >
                    <AtSign className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
                    <span className="font-mono text-sm flex-1 text-left truncate">
                      {aliases.join(", ")}
                    </span>
                  </button>
                }
              />
            )}
          </div>

          {/* Relationships (edit mode only) */}
          {mode === "edit" && editingPlaceId && (
            <div className="mt-6">
              <RelationshipTagger
                entityType="place"
                entityId={editingPlaceId}
              />
            </div>
          )}

          {/* Subtle chips for empty fields */}
          <div className="flex flex-wrap gap-3 items-center mt-8 mb-2">
            {!parentPlace && (
              <Popover open={parentOpen} onOpenChange={setParentOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <TreePine className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">no parent</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2">
                  <ParentPicker
                    value={parentKey}
                    options={possibleParents}
                    onChange={(v) => {
                      placeFormState$.parentKey.set(v);
                      setParentOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}

            {!hasCoords && (
              <Popover open={coordsOpen} onOpenChange={setCoordsOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <Navigation className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">coordinates</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-72 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
                >
                  <CoordinatesEditor lat={lat} lng={lng} />
                </PopoverContent>
              </Popover>
            )}

            {!address.trim() && (
              <Popover open={addressOpen} onOpenChange={setAddressOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <MapPinned className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">address</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
                >
                  <TextFieldEditor
                    icon={
                      <MapPinned className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                    }
                    label="Address"
                    value={address}
                    onChange={(v) => placeFormState$.address.set(v)}
                    placeholder="Street, city, postal code"
                  />
                </PopoverContent>
              </Popover>
            )}

            {!url.trim() && (
              <Popover open={urlOpen} onOpenChange={setUrlOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">url</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
                >
                  <TextFieldEditor
                    icon={
                      <Link2 className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                    }
                    label="URL"
                    value={url}
                    onChange={(v) => placeFormState$.url.set(v)}
                    placeholder="https://maps.app.goo.gl/..."
                  />
                </PopoverContent>
              </Popover>
            )}

            {aliases.length === 0 && (
              <AliasesSelector
                open={aliasesOpen}
                value={aliases}
                onChange={(next) => placeFormState$.aliases.set(next)}
                onOpen={() => setAliasesOpen(true)}
                onClose={() => setAliasesOpen(false)}
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                  >
                    <AtSign className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-mono">no aliases</span>
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
                onClick={closePlaceForm}
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

function UrlField({
  url,
  urlOpen,
  setUrlOpen,
}: {
  url: string;
  urlOpen: boolean;
  setUrlOpen: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-1.5 w-full">
      <Popover open={urlOpen} onOpenChange={setUrlOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-3 rounded-lg border border-stone-200 dark:border-stone-700 transition-all text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600 flex-1 min-w-0"
          >
            <Link2 className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
            <span className="font-mono text-sm flex-1 text-left truncate">
              {url}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
        >
          <TextFieldEditor
            icon={
              <Link2 className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
            }
            label="URL"
            value={url}
            onChange={(v) => placeFormState$.url.set(v)}
            placeholder="https://maps.app.goo.gl/..."
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={handleCopy}
        className="p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:border-stone-300 dark:hover:border-stone-600 transition-all flex-shrink-0"
        aria-label="Copy URL"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

function ParentPicker({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: { key: string; name: string; emoji: string | null }[];
  onChange: (key: string | null) => void;
}) {
  return (
    <div className="flex flex-col max-h-48 overflow-y-auto">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm font-mono transition-colors text-left ${
          !value
            ? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
            : "text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800"
        }`}
      >
        <MapPin className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        no parent (root)
      </button>
      {options.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm font-mono transition-colors text-left ${
            value === p.key
              ? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
              : "text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800"
          }`}
        >
          <span className="w-3.5 text-center flex-shrink-0">
            {p.emoji || "·"}
          </span>
          {p.name}
        </button>
      ))}
    </div>
  );
}

function CoordinatesEditor({ lat, lng }: { lat: string; lng: string }) {
  const inputClass =
    "w-full bg-transparent border border-stone-200 dark:border-stone-700 rounded-md text-sm font-mono px-2 py-1.5 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:border-stone-400 dark:focus:border-stone-500";

  return (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        <Navigation className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
        <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium">
          Coordinates
        </span>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500">
            lat
          </span>
          <input
            type="text"
            value={lat}
            onChange={(e) => placeFormState$.lat.set(e.target.value)}
            placeholder="e.g. 51.5074"
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
              }
            }}
          />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500">
            lng
          </span>
          <input
            type="text"
            value={lng}
            onChange={(e) => placeFormState$.lng.set(e.target.value)}
            placeholder="e.g. -0.1278"
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
              }
            }}
          />
        </div>
      </div>
    </>
  );
}

function AliasesSelector({
  open,
  value,
  onChange,
  onOpen,
  onClose,
  trigger,
}: {
  open: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  onOpen: () => void;
  onClose: () => void;
  trigger: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft("");
      return;
    }
    const lower = trimmed.toLowerCase();
    if (value.some((a) => a.toLowerCase() === lower)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen) onOpen();
        else {
          commitDraft();
          onClose();
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3 border-stone-200/50 dark:border-stone-700/50 shadow-sm bg-white/95 dark:bg-stone-900/95"
        side="bottom"
        sideOffset={4}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          setDraft("");
          onClose();
        }}
      >
        <div className="flex items-center gap-1.5 mb-2">
          <AtSign className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
          <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium">
            Aliases
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center border border-stone-200 dark:border-stone-700 rounded-md px-2 py-1.5 focus-within:border-stone-400 dark:focus-within:border-stone-500">
          {value.map((alias, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: aliases may repeat while being edited
              key={`${alias}-${index}`}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-xs font-mono text-stone-700 dark:text-stone-300"
            >
              {alias}
              <button
                type="button"
                onClick={() => removeAt(index)}
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
                removeAt(value.length - 1);
              }
            }}
            placeholder={value.length === 0 ? "Add alias…" : ""}
            className="flex-1 min-w-[80px] bg-transparent text-xs font-mono text-stone-700 dark:text-stone-300 placeholder:text-stone-400 focus:outline-none"
          />
        </div>

        <p className="mt-2 text-[11px] font-mono text-stone-400 dark:text-stone-500">
          Enter to add. Alternate names that match when searching.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function TextFieldEditor({
  icon,
  label,
  value,
  onChange,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-medium">
          {label}
        </span>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent border border-stone-200 dark:border-stone-700 rounded-md text-sm font-mono px-2 py-1.5 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:border-stone-400 dark:focus:border-stone-500"
        autoFocus
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
          }
        }}
      />
    </>
  );
}
