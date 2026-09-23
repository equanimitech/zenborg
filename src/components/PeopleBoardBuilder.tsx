/** biome-ignore-all lint/a11y/noAutofocus: inline edits open from a deliberate action, so focus has to follow it */
"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { observer, use$ } from "@legendapp/state/react";
import { Plus, User } from "lucide-react";
import { useMemo, useState } from "react";
import { InitialMark } from "@/components/InitialMark";
import { PersonFormDialog } from "@/components/PersonFormDialog";
import { slugify } from "@/domain/entities/Moment";
import type { Person } from "@/domain/entities/Person";
import {
  createPerson,
  displayName,
  normalizeAliases,
} from "@/domain/entities/Person";
import type { Place } from "@/domain/entities/Place";
import type { Relationship } from "@/domain/entities/Relationship";
import { createRelationship } from "@/domain/entities/Relationship";
import { people$, places$, relationships$ } from "@/infrastructure/state/store";
import {
  closePersonForm,
  openPersonFormCreate,
  openPersonFormEdit,
  type PeopleGroupBy,
  personFormState$,
} from "@/infrastructure/state/ui-store";
import { columnWidth } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

const NONE_KEY = "__none__";
const TAG_ORDER = ["family", "friends", "lovers"];
const BASED_IN_LABEL = "based-in";

const NONE_LABELS: Record<PeopleGroupBy, string> = {
  tag: "No tag",
  place: "No place",
};

function buildBasePlaceMap(
  relationships: Record<string, Relationship>,
  places: Record<string, Place>,
): Map<string, Place> {
  const map = new Map<string, Place>();
  for (const rel of Object.values(relationships)) {
    if (rel.label !== BASED_IN_LABEL) continue;
    if (rel.fromType === "person" && rel.toType === "place") {
      const place = places[rel.toId];
      if (place) map.set(rel.fromId, place);
    } else if (
      rel.toType === "person" &&
      rel.fromType === "place" &&
      rel.direction === "mutual"
    ) {
      const place = places[rel.fromId];
      if (place) map.set(rel.toId, place);
    }
  }
  return map;
}

function getPersonBasePlace(
  personId: string,
  basePlaceMap: Map<string, Place>,
  person: Person,
  allPlaces: Record<string, Place>,
): Place | null {
  const fromRel = basePlaceMap.get(personId);
  if (fromRel) return fromRel;
  // legacy fallback
  if (person.basePlace) {
    return (
      Object.values(allPlaces).find((p) => p.key === person.basePlace) ?? null
    );
  }
  return null;
}

function buildPlacesByKey(
  allPlaces: Record<string, Place>,
): Map<string, Place> {
  const m = new Map<string, Place>();
  for (const p of Object.values(allPlaces)) m.set(p.key, p);
  return m;
}

function resolveCountry(place: Place, byKey: Map<string, Place>): Place {
  let current = place;
  const seen = new Set<string>();
  while (current.parentKey && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byKey.get(current.parentKey);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function placeLabel(place: Place): string {
  return place.emoji ? `${place.emoji} ${place.name}` : place.name;
}

function groupPeople(
  people: Person[],
  groupBy: PeopleGroupBy,
  basePlaceMap: Map<string, Place>,
  allPlaces: Record<string, Place>,
): { key: string; label: string; people: Person[] }[] {
  const groups = new Map<string, { label: string; people: Person[] }>();
  const byKey = groupBy === "place" ? buildPlacesByKey(allPlaces) : null;

  for (const person of people) {
    let key: string;
    let label: string;
    switch (groupBy) {
      case "tag":
        key = person.tags?.[0] || NONE_KEY;
        label = person.tags?.[0] || NONE_LABELS.tag;
        break;
      case "place": {
        const place = getPersonBasePlace(
          person.id,
          basePlaceMap,
          person,
          allPlaces,
        );
        const country = place && byKey ? resolveCountry(place, byKey) : null;
        key = country?.id || NONE_KEY;
        label = country ? placeLabel(country) : NONE_LABELS.place;
        break;
      }
    }
    const group = groups.get(key) ?? { label, people: [] };
    group.people.push(person);
    groups.set(key, group);
  }

  if (groupBy === "place") {
    for (const place of Object.values(allPlaces)) {
      if (place.parentKey !== null) continue;
      if (!groups.has(place.id)) {
        groups.set(place.id, { label: placeLabel(place), people: [] });
      }
    }
  }

  for (const { people: list } of groups.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const entries = [...groups.entries()];
  entries.sort(([a], [b]) => {
    if (groupBy === "tag") {
      const ai = TAG_ORDER.indexOf(a);
      const bi = TAG_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
    }
    if (a === NONE_KEY) return 1;
    if (b === NONE_KEY) return -1;
    return a.localeCompare(b);
  });

  return entries.map(([key, { label, people }]) => ({ key, label, people }));
}

function DraggablePersonCard({
  person,
  groupKey,
}: {
  person: Person;
  groupKey: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: person.id,
    data: {
      personId: person.id,
      sourceGroupKey: groupKey,
      type: "person-card",
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center justify-between gap-2 px-3 py-3 rounded-md bg-stone-100 dark:bg-stone-800 transition-all hover:ring-2 hover:ring-offset-2 ring-offset-transparent hover:ring-stone-300 dark:hover:ring-stone-600"
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openPersonFormEdit(person.id, person);
        }}
        className="flex-1 text-left min-w-0"
      >
        <div className="flex items-center text-sm font-mono gap-2 text-stone-800 dark:text-stone-200">
          <span className="text-lg flex-shrink-0 w-6 text-center">
            {person.emoji || <InitialMark name={displayName(person)} />}
          </span>
          <span className="text-lg font-semibold truncate flex-1 min-w-0">
            {displayName(person)}
          </span>
        </div>
      </button>
    </div>
  );
}

function EmptyTagColumn({
  onCreateTag,
}: {
  onCreateTag: (name: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");

  const handleSave = () => {
    if (name.trim()) {
      onCreateTag(name.trim());
    }
    setIsCreating(false);
    setName("");
  };

  if (isCreating) {
    return (
      <div
        className={cn(
          "flex flex-col snap-start rounded-lg overflow-hidden",
          columnWidth.scrollableClassName,
        )}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <User className="w-4 h-4 text-stone-400 flex-shrink-0" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
                if (e.key === "Escape") {
                  setIsCreating(false);
                  setName("");
                }
              }}
              autoFocus
              placeholder="Tag name..."
              className="flex-1 min-w-0 bg-transparent text-sm font-mono font-medium text-stone-700 dark:text-stone-300 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="h-[3px] mx-4 bg-stone-300 dark:bg-stone-600" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsCreating(true)}
      className={cn(
        "group flex flex-col snap-start rounded-lg overflow-hidden text-left transition-colors cursor-pointer",
        columnWidth.scrollableClassName,
      )}
    >
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="text-xl flex-shrink-0 w-8 h-8 flex items-center justify-center rounded group-hover:bg-stone-100 dark:group-hover:bg-stone-800 transition-colors">
            <Plus className="w-5 h-5 text-stone-400 dark:text-stone-500 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors" />
          </div>
          <h3 className="text-sm font-mono font-medium text-stone-400 dark:text-stone-500 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors truncate">
            New tag
          </h3>
        </div>
      </div>
      <div className="h-[3px] mx-4 mb-2 bg-stone-200/60 dark:bg-stone-700/40 group-hover:bg-stone-300 dark:group-hover:bg-stone-600 transition-colors" />
      <div className="flex-1 p-4 min-h-[200px]" />
    </button>
  );
}

function PeopleColumn({
  groupKey,
  label,
  people,
  onAddPerson,
}: {
  groupKey: string;
  label: string;
  people: Person[];
  onAddPerson: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-${groupKey}`,
    data: { targetGroupKey: groupKey, type: "people-column" },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col snap-start rounded-lg h-full",
        columnWidth.scrollableClassName,
        isOver &&
          "ring-2 ring-stone-400 dark:ring-stone-500 bg-stone-50 dark:bg-stone-800/50",
      )}
    >
      <div className="px-4 py-3 flex items-center gap-2">
        <User className="w-4 h-4 text-stone-400 dark:text-stone-500" />
        <span className="text-sm font-mono font-medium text-stone-700 dark:text-stone-300">
          {label}
        </span>
        <span className="text-xs font-mono text-stone-400 dark:text-stone-500">
          {people.length}
        </span>
        <button
          type="button"
          onClick={onAddPerson}
          className="ml-auto p-1 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          aria-label={`Add person to ${label}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="h-[3px] mx-4 bg-stone-300 dark:bg-stone-600" />

      <div className="flex flex-col gap-3 p-4 flex-1 overflow-y-auto min-h-0">
        <SortableContext
          items={people.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          {people.length === 0 ? (
            <button
              type="button"
              onClick={onAddPerson}
              className="flex items-center justify-center gap-2 py-6 text-stone-400 dark:text-stone-500 hover:text-stone-500 dark:hover:text-stone-400 transition-colors cursor-pointer"
            >
              <span className="text-sm font-mono">Add first person</span>
            </button>
          ) : (
            people.map((person) => (
              <DraggablePersonCard
                key={person.id}
                person={person}
                groupKey={groupKey}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}

function findBasedInRel(personId: string): string | null {
  const allRels = relationships$.peek();
  const existing = Object.values(allRels).find(
    (r) =>
      r.label === BASED_IN_LABEL &&
      ((r.fromType === "person" &&
        r.fromId === personId &&
        r.toType === "place") ||
        (r.toType === "person" &&
          r.toId === personId &&
          r.fromType === "place" &&
          r.direction === "mutual")),
  );
  return existing?.id ?? null;
}

function syncBasedInRelationship(personId: string, placeId: string | null) {
  const existingRelId = findBasedInRel(personId);
  if (existingRelId) relationships$[existingRelId].delete();
  if (placeId) {
    const rel = createRelationship({
      fromType: "person",
      fromId: personId,
      toType: "place",
      toId: placeId,
      label: BASED_IN_LABEL,
      direction: "directed",
    });
    relationships$[rel.id].set(rel);
  }
  // clear legacy field
  const person = people$[personId].peek();
  if (person?.basePlace) {
    people$[personId].basePlace.set(null);
    people$[personId].updatedAt.set(new Date().toISOString());
  }
}

function applyDragGroupChange(
  personId: string,
  groupBy: PeopleGroupBy,
  targetGroupKey: string,
) {
  switch (groupBy) {
    case "tag": {
      const current = people$[personId].tags.peek() ?? [];
      const oldTag = current[0];
      const newTag = targetGroupKey === NONE_KEY ? undefined : targetGroupKey;
      const updated = oldTag
        ? current.filter((t: string) => t !== oldTag)
        : [...current];
      if (newTag) updated.unshift(newTag);
      people$[personId].tags.set(updated);
      people$[personId].updatedAt.set(new Date().toISOString());
      break;
    }
    case "place": {
      syncBasedInRelationship(
        personId,
        targetGroupKey === NONE_KEY ? null : targetGroupKey,
      );
      break;
    }
  }
}

export const PeopleBoardBuilder = observer(
  ({
    groupBy,
    filter,
    showEmpty,
  }: {
    groupBy: PeopleGroupBy;
    filter: string;
    showEmpty: boolean;
  }) => {
    const allPeople = use$(people$);
    const allPlaces = use$(places$);
    const allRelationships = use$(relationships$);
    const [activeId, setActiveId] = useState<string | null>(null);

    const basePlaceMap = useMemo(
      () => buildBasePlaceMap(allRelationships, allPlaces),
      [allRelationships, allPlaces],
    );

    let people = Object.values(allPeople).filter((p) => !p.isSelf);
    if (filter) {
      const q = filter.toLowerCase();
      people = people.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          displayName(p).toLowerCase().includes(q),
      );
    }

    let groups = groupPeople(people, groupBy, basePlaceMap, allPlaces);
    if (!showEmpty) {
      groups = groups.filter((g) => g.people.length > 0);
    }

    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
      useSensor(TouchSensor, {
        activationConstraint: { delay: 200, tolerance: 8 },
      }),
      useSensor(KeyboardSensor),
    );

    const handleDragStart = (event: DragStartEvent) => {
      setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;

      const dragData = active.data.current as {
        personId?: string;
        sourceGroupKey?: string;
        type?: string;
      };
      const overData = over.data.current as {
        targetGroupKey?: string;
        sourceGroupKey?: string;
        type?: string;
      };

      if (dragData?.type !== "person-card") return;

      const targetGroupKey =
        overData?.targetGroupKey ?? overData?.sourceGroupKey;
      if (!targetGroupKey || !dragData.personId) return;
      if (targetGroupKey === dragData.sourceGroupKey) return;

      applyDragGroupChange(dragData.personId, groupBy, targetGroupKey);
    };

    const activePerson = activeId ? allPeople[activeId] : null;

    return (
      <>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto px-4 py-4 h-full snap-x snap-mandatory scroll-smooth">
            {groups.map((g) => (
              <PeopleColumn
                key={g.key}
                groupKey={g.key}
                label={g.label}
                people={g.people}
                onAddPerson={() =>
                  openPersonFormCreate({
                    tag:
                      groupBy === "tag" && g.key !== NONE_KEY
                        ? g.key
                        : undefined,
                  })
                }
              />
            ))}

            {groupBy === "tag" && (
              <EmptyTagColumn
                onCreateTag={(name) => openPersonFormCreate({ tag: name })}
              />
            )}
          </div>

          <DragOverlay>
            {activePerson ? (
              <div
                className="flex items-center gap-2 px-3 py-3 rounded-md bg-stone-100 dark:bg-stone-800 border border-stone-300 dark:border-stone-600 opacity-90"
                style={{ width: "22.5rem" }}
              >
                <span className="text-lg w-6 text-center">
                  {activePerson.emoji || (
                    <InitialMark name={displayName(activePerson)} />
                  )}
                </span>
                <span className="text-sm font-mono font-semibold text-stone-800 dark:text-stone-200 truncate">
                  {displayName(activePerson)}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <PersonFormDialog
          onSave={(props) => {
            const formState = personFormState$.peek();
            const name = props.name.trim();
            if (!name) return;
            const key = slugify(name);
            const aliases = normalizeAliases(props.aliases, name);

            let personId: string;
            if (formState.mode === "edit" && formState.editingPersonId) {
              personId = formState.editingPersonId;
              const existing = people$[personId].peek();
              people$[personId].set({
                ...existing,
                name,
                key,
                aliases: aliases.length > 0 ? aliases : undefined,
                emoji: props.emoji,
                tags: props.tags,
                cadence: props.cadence,
                updatedAt: new Date().toISOString(),
              });
            } else {
              const person = createPerson({
                name,
                key,
                emoji: props.emoji,
                aliases,
                tags: props.tags,
                cadence: props.cadence,
              });
              personId = person.id;
              people$[personId].set(person);
            }

            syncBasedInRelationship(personId, props.basePlaceId);
            closePersonForm();
          }}
          onDelete={() => {
            const formState = personFormState$.peek();
            if (formState.editingPersonId) {
              people$[formState.editingPersonId].delete();
              closePersonForm();
            }
          }}
        />
      </>
    );
  },
);
