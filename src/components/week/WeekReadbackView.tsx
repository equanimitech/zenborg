"use client";

import type {
  Coverage,
  Footprint,
  ReadingSurface,
  WeekReadback,
} from "@/domain/readback/WeekReadback";
import type { Phase } from "@/domain/value-objects/Phase";
import { PhaseIcon } from "@/domain/value-objects/phaseStyles";
import { formatCycleDateRange, getDateLabel } from "@/lib/dates";

/**
 * WeekReadbackView — the week, read back.
 *
 * Gross → subtle: per area first (what was planted, where attention went),
 * then each surface, then what each surface could see, then the board day by
 * day. Every number sits beside last week's as a second plain number. There
 * is no score and no room for one: no ratio, no arrow, no bar against a plan.
 * Reading the gap is the gardener's job.
 *
 * Design: stone tones throughout; the one coloured thing is the area swatch.
 * Flat, square, no modals (`../DESIGN.md`).
 */

export interface AreaStyle {
  readonly name: string;
  readonly color: string;
  readonly order: number;
}

const SURFACE_LABEL: Record<ReadingSurface, string> = {
  body: "Body",
  screen: "Screen",
  work: "Work",
  journal: "Journal",
  comms: "Comms",
};

/** "45 m", "7 h", "7 h 20 m". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

interface AreaRow {
  readonly areaId: string;
  readonly planted: number;
  readonly plantedLast: number;
  readonly minutes: number;
  readonly minutesLast: number;
}

/**
 * Per area, planted counts beside footprint minutes summed over the drawn
 * surfaces. Surfaces can overlap (an agent run while its terminal is in
 * front), which is why each one is also read back on its own below.
 */
export function areaRows(readback: WeekReadback): AreaRow[] {
  const rows = new Map<
    string,
    {
      planted: number;
      plantedLast: number;
      minutes: number;
      minutesLast: number;
    }
  >();
  const row = (id: string) => {
    const existing = rows.get(id);
    if (existing) return existing;
    const created = { planted: 0, plantedLast: 0, minutes: 0, minutesLast: 0 };
    rows.set(id, created);
    return created;
  };
  for (const p of readback.planted) {
    const r = row(p.areaId);
    r.planted = p.thisWeek;
    r.plantedLast = p.lastWeek;
  }
  for (const f of readback.footprints) {
    if (f.status !== "drawn") continue;
    for (const a of f.thisWeek.byArea) row(a.areaId).minutes += a.minutes;
    for (const a of f.lastWeek.byArea) row(a.areaId).minutesLast += a.minutes;
  }
  return [...rows.entries()].map(([areaId, r]) => ({ areaId, ...r }));
}

function Swatch({ area }: { area?: AreaStyle }) {
  if (!area) return <span aria-hidden="true" className="h-2 w-2 shrink-0" />;
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0"
      data-area-swatch
      style={{ backgroundColor: area.color }}
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs uppercase tracking-wider text-stone-400 dark:text-stone-500">
      {children}
    </h2>
  );
}

const num = "tabular-nums text-right";
const faint = "text-stone-400 dark:text-stone-500";

export function WeekReadbackView({
  readback,
  areas,
  logReadable,
  onPrevious,
  onNext,
  onThisWeek,
}: {
  readback: WeekReadback;
  areas: Readonly<Record<string, AreaStyle>>;
  /** False in the web build: there is no activity log to read. */
  logReadable: boolean;
  onPrevious: () => void;
  /** Omit when the week shown is the current one: there is no next week to read. */
  onNext?: () => void;
  onThisWeek?: () => void;
}) {
  const byOrder = (a: { areaId: string }, b: { areaId: string }) =>
    (areas[a.areaId]?.order ?? Number.MAX_SAFE_INTEGER) -
    (areas[b.areaId]?.order ?? Number.MAX_SAFE_INTEGER);
  const rows = areaRows(readback).sort(byOrder);
  const name = (id: string, fallback?: string) =>
    areas[id]?.name ?? fallback ?? id;

  return (
    <article className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
            The week
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            {formatCycleDateRange(readback.window.from, readback.window.to)}
          </p>
        </div>
        <nav aria-label="Weeks" className="flex gap-3 text-sm">
          <button
            className="text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
            onClick={onPrevious}
            type="button"
          >
            Previous week
          </button>
          {onThisWeek && (
            <button
              className="text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
              onClick={onThisWeek}
              type="button"
            >
              This week
            </button>
          )}
          {onNext && (
            <button
              className="text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
              onClick={onNext}
              type="button"
            >
              Next week
            </button>
          )}
        </nav>
      </header>

      {!logReadable && (
        <p className="mt-6 text-sm text-stone-500 dark:text-stone-400">
          Footprints live in the desktop app's activity log. Here only what you
          planted reads back.
        </p>
      )}

      <section className="pt-8">
        <SectionTitle>Planted and walked</SectionTitle>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">
            Nothing planted and no footprints this week or last.
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className={faint}>
              <tr className="text-xs">
                <th className="pb-2 text-left font-normal">Area</th>
                <th className={`pb-2 font-normal ${num}`}>Planted</th>
                <th className={`pb-2 font-normal ${num}`}>last week</th>
                <th className={`pb-2 pl-6 font-normal ${num}`}>Footprints</th>
                <th className={`pb-2 font-normal ${num}`}>last week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  className="border-t border-stone-100 dark:border-stone-900"
                  key={r.areaId}
                >
                  <td className="py-1.5">
                    <span className="flex items-center gap-2 text-stone-800 dark:text-stone-200">
                      <Swatch area={areas[r.areaId]} />
                      {name(r.areaId)}
                    </span>
                  </td>
                  <td
                    className={`py-1.5 text-stone-800 dark:text-stone-200 ${num}`}
                  >
                    {r.planted}
                  </td>
                  <td className={`py-1.5 ${faint} ${num}`}>{r.plantedLast}</td>
                  <td
                    className={`py-1.5 pl-6 text-stone-800 dark:text-stone-200 ${num}`}
                  >
                    {formatMinutes(r.minutes)}
                  </td>
                  <td className={`py-1.5 ${faint} ${num}`}>
                    {formatMinutes(r.minutesLast)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {readback.wilting.length > 0 && (
        <section className="pt-10">
          <SectionTitle>Wilting at the week's close</SectionTitle>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {readback.wilting.map((w) => (
              <li
                className="flex items-center gap-2 text-stone-700 dark:text-stone-300"
                key={w.habitId}
              >
                <Swatch area={areas[w.areaId]} />
                {w.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pt-10">
        <SectionTitle>By surface</SectionTitle>
        <div className="mt-4 space-y-8">
          {readback.footprints.map((f) => (
            <div key={f.surface}>
              <h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">
                {SURFACE_LABEL[f.surface]}
              </h3>
              {f.status === "not drawn" ? (
                <p className={`mt-1 text-sm ${faint}`}>
                  Not drawn: no spring feeds this surface yet.
                </p>
              ) : (
                <SurfaceDetail
                  areas={areas}
                  byOrder={byOrder}
                  last={f.lastWeek}
                  logReadable={logReadable}
                  name={name}
                  thisWeek={f.thisWeek}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="pt-10">
        <SectionTitle>The board</SectionTitle>
        <div className="mt-4 space-y-5">
          {readback.board.map((day) => (
            <div key={day.day}>
              <h3 className={`text-xs ${faint}`}>{getDateLabel(day.day)}</h3>
              {day.phases.length === 0 ? (
                <p className="mt-1 text-sm text-stone-300 dark:text-stone-600">
                  Nothing planted.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {day.phases.flatMap((p) =>
                    p.moments.map((m) => (
                      <li
                        className="flex items-baseline gap-2 text-sm"
                        key={m.id}
                      >
                        <span className="w-4 shrink-0 text-stone-300 dark:text-stone-600">
                          <PhaseIcon
                            className="h-3 w-3"
                            phase={p.phase as Phase}
                          />
                        </span>
                        <Swatch area={areas[m.areaId]} />
                        <span className="text-stone-800 dark:text-stone-200">
                          {m.name}
                        </span>
                        {!m.traceable && (
                          <span
                            className={`text-xs ${faint}`}
                            title="No surface can see this area or habit"
                          >
                            untraceable
                          </span>
                        )}
                      </li>
                    )),
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

function coverageLine(c: Coverage): string {
  return `saw ${c.seenHours} h of the week · ${formatMinutes(c.idleCreditedMin)} credited through idle · ${formatMinutes(c.unmappedMin)} unmapped`;
}

function SurfaceDetail({
  thisWeek,
  last,
  areas,
  byOrder,
  name,
  logReadable,
}: {
  thisWeek: Footprint;
  last: Footprint;
  areas: Readonly<Record<string, AreaStyle>>;
  byOrder: (a: { areaId: string }, b: { areaId: string }) => number;
  name: (id: string, fallback?: string) => string;
  logReadable: boolean;
}) {
  if (!logReadable) {
    return (
      <p className={`mt-1 text-sm ${faint}`}>Not readable in this build.</p>
    );
  }
  const lastByArea = new Map(last.byArea.map((a) => [a.areaId, a.minutes]));
  const ids = [
    ...new Set([...thisWeek.byArea.map((a) => a.areaId), ...lastByArea.keys()]),
  ]
    .map((areaId) => ({ areaId }))
    .sort(byOrder);
  const thisByArea = new Map(thisWeek.byArea.map((a) => [a.areaId, a]));
  return (
    <div className="mt-1">
      {ids.length > 0 && (
        <ul className="space-y-0.5 text-sm">
          {ids.map(({ areaId }) => (
            <li className="flex items-center gap-2" key={areaId}>
              <Swatch area={areas[areaId]} />
              <span className="flex-1 text-stone-700 dark:text-stone-300">
                {name(areaId, thisByArea.get(areaId)?.areaName)}
              </span>
              <span className="w-24 tabular-nums text-right text-stone-800 dark:text-stone-200">
                {formatMinutes(thisByArea.get(areaId)?.minutes ?? 0)}
              </span>
              <span className={`w-24 tabular-nums text-right ${faint}`}>
                {formatMinutes(lastByArea.get(areaId) ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {thisWeek.unmapped.length > 0 && (
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          Unmapped:{" "}
          {thisWeek.unmapped
            .map((u) => `${u.locator} ${formatMinutes(u.minutes)}`)
            .join(", ")}
        </p>
      )}
      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
        This week {coverageLine(thisWeek.coverage)}.
      </p>
      <p className={`text-xs ${faint}`}>
        Last week {coverageLine(last.coverage)}.
      </p>
    </div>
  );
}
