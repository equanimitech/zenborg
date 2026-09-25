"use client";

import { useState } from "react";
import type { Phase } from "@/domain/value-objects/Phase";
import { PhaseIcon } from "@/domain/value-objects/phaseStyles";
import { composeReflection } from "@/domain/value-objects/Reflection";
import type {
  HarvestMoment,
  HarvestSeason,
} from "@/infrastructure/state/harvestViewModel";
import { formatCycleDateRange, getDateLabel } from "@/lib/dates";

/**
 * SeasonReadback — one closed season, read back.
 *
 * What it intended, what it held, and what was planted in it. In that order,
 * because the order is the point: intention first, then the record, and the
 * record never answers to the intention.
 *
 * Design: stone tones throughout. The single coloured thing on the page is
 * the area swatch beside a moment — area `color` is the one sanctioned colour
 * channel, and a viewer can always name the plot a colour belongs to
 * (`../DESIGN.md`). Phases are structural: an icon and a position, never a
 * hue. Flat at rest, square, no modals.
 *
 * There is no score here, and there is no room for one: no bar against a
 * budget, no percentage, no comparison with another season.
 *
 */
export function SeasonReadback({
  season,
  onEditReflection,
}: {
  season: HarvestSeason | null;
  /**
   * Save a reflection the person wrote. Omit to render read-only.
   * Receives the composed stored string, or null when both rungs are empty.
   */
  onEditReflection?: (reflection: string | null) => void;
}) {
  if (!season) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Your story will appear here after your first season ends.
        </p>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-2xl px-6 py-12">
      <header className="border-b border-stone-200 pb-6 dark:border-stone-800">
        <h1 className="text-2xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
          {season.name}
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {formatCycleDateRange(season.startDate, season.endDate)}
        </p>

        {season.intention && (
          <div className="mt-6">
            <h2 className="text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Intention
            </h2>
            <p className="mt-1 text-stone-700 dark:text-stone-300">
              {season.intention}
            </p>
          </div>
        )}
      </header>

      <ReflectionBlock onEdit={onEditReflection} season={season} />

      <section className="pt-8">
        <h2 className="text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500">
          {season.momentCount === 1
            ? "1 moment planted"
            : `${season.momentCount} moments planted`}
        </h2>

        {season.days.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">
            Nothing was planted in this season.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {season.days.map((day) => (
              <div key={day.date}>
                <h3 className="text-xs text-stone-400 dark:text-stone-500">
                  {getDateLabel(day.date)}
                </h3>
                <ul className="mt-2 space-y-1">
                  {day.moments.map((moment) => (
                    <PlantedMoment key={moment.id} moment={moment} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}

/**
 * The reflection, and who wrote it.
 *
 * Two things happen here that the pitch treats as the heart of the bet.
 *
 * **Provenance.** A machine draft is marked as drafted. Anything not stamped
 * as the person's own — including every reflection written before the field
 * existed — reads as a draft. The failure that matters is a draft passing as
 * your words, so the doubt resolves that way.
 *
 * **Editing as the expected act**, not a repair. The draft is a starting
 * point: the rungs open in place (no modal), and saving stamps the reflection
 * as yours, after which a summarizer re-run leaves it alone.
 */
function ReflectionBlock({
  season,
  onEdit,
}: {
  season: HarvestSeason;
  onEdit?: (reflection: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [l0, setL0] = useState("");
  const [l1, setL1] = useState("");

  const open = () => {
    setL0(season.reflection?.l0 ?? "");
    setL1(season.reflection?.l1 ?? "");
    setEditing(true);
  };

  const save = () => {
    onEdit?.(composeReflection(l0, l1));
    setEditing(false);
  };

  if (editing) {
    return (
      <section className="border-b border-stone-200 py-8 dark:border-stone-800">
        <label
          className="text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
          htmlFor="reflection-l0"
        >
          The line
        </label>
        <textarea
          className="mt-1 w-full resize-none border border-stone-200 bg-transparent p-2 text-lg leading-relaxed text-stone-900 focus:border-stone-400 focus:outline-none dark:border-stone-800 dark:text-stone-100"
          id="reflection-l0"
          onChange={(e) => setL0(e.target.value)}
          rows={2}
          value={l0}
        />

        <label
          className="mt-4 block text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500"
          htmlFor="reflection-l1"
        >
          Behind it
        </label>
        <textarea
          className="mt-1 w-full resize-none border border-stone-200 bg-transparent p-2 leading-relaxed text-stone-600 focus:border-stone-400 focus:outline-none dark:border-stone-800 dark:text-stone-400"
          id="reflection-l1"
          onChange={(e) => setL1(e.target.value)}
          rows={6}
          value={l1}
        />

        <div className="mt-3 flex gap-2">
          <button
            className="border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            onClick={save}
            type="button"
          >
            Save
          </button>
          <button
            className="px-3 py-1 text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
            onClick={() => setEditing(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  if (!season.reflection) {
    if (!onEdit) {
      return null;
    }

    return (
      <section className="border-b border-stone-200 py-8 dark:border-stone-800">
        <button
          className="text-sm text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
          onClick={open}
          type="button"
        >
          Write what this season held
        </button>
      </section>
    );
  }

  return (
    <section className="border-b border-stone-200 py-8 dark:border-stone-800">
      <p className="text-lg leading-relaxed text-stone-900 dark:text-stone-100">
        {season.reflection.l0}
      </p>

      {season.reflection.l1 && (
        <p className="mt-4 whitespace-pre-line leading-relaxed text-stone-600 dark:text-stone-400">
          {season.reflection.l1}
        </p>
      )}

      <div className="mt-4 flex items-baseline gap-3">
        {!season.reflectionIsHuman && (
          <span className="text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Drafted — not your words yet
          </span>
        )}

        {onEdit && (
          <button
            className="text-xs text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
            onClick={open}
            type="button"
          >
            Edit
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * One moment, as it was planted: when in the day, which plot, who was there.
 *
 * Every moment in the season renders.
 */
function PlantedMoment({ moment }: { moment: HarvestMoment }) {
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <span className="w-4 shrink-0 text-stone-300 dark:text-stone-600">
        {moment.phase && (
          <PhaseIcon className="h-3 w-3" phase={moment.phase as Phase} />
        )}
      </span>

      {moment.areaColor && (
        <span
          aria-hidden="true"
          className="mt-[1px] h-2 w-2 shrink-0"
          data-area-id={moment.areaId}
          data-area-swatch
          style={{ backgroundColor: moment.areaColor }}
          title={moment.areaName ?? undefined}
        />
      )}

      <span className="text-stone-800 dark:text-stone-200">{moment.name}</span>

      {moment.people.length > 0 && (
        <span className="text-stone-400 dark:text-stone-500">
          with {moment.people.join(", ")}
        </span>
      )}
    </li>
  );
}
