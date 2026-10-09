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
 * WeekReadbackView — the week, read back. Harvest's week scale.
 *
 * Gross → subtle. The surface layer reads complete on its own: per area, what
 * was planted beside where attention went; then each surface on one line with
 * what it could see. The subtle layer waits behind a press (native
 * `<details>`): a surface's areas and unmapped minutes, and the board day by
 * day. Every number sits beside last week's as a second plain number. There
 * is no score and no room for one: no ratio, no arrow, no bar against a plan.
 * Reading the gap is the gardener's job.
 *
 * Design (`../DESIGN.md`): stone tones; the area swatch is the only colour.
 * Sans says what a thing is; mono carries labels and numbers. Hairlines, not
 * boxes. Flat, square, no modals.
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

/** "seen 62 h · 0 m through idle · 24 h 34 m unmapped". Coverage rides with every surface. */
export function coverageLine(c: Coverage): string {
  return `seen ${c.seenHours} h · ${formatMinutes(c.idleCreditedMin)} through idle · ${formatMinutes(c.unmappedMin)} unmapped`;
}

const label =
  "font-mono text-xs uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400";
const ink = "text-stone-900 dark:text-stone-100";
const muted = "text-stone-600 dark:text-stone-400";
const faint = "text-stone-400 dark:text-stone-500";
const number = "font-mono text-sm tabular-nums text-right";
const rule = "border-stone-200 dark:border-stone-800";
/** The disclosure row. The default triangle is hidden; `Marker` draws + and −. */
const summary =
  "flex cursor-pointer list-none items-baseline gap-3 py-2 [&::-webkit-details-marker]:hidden";

function Marker() {
  return (
    <span
      aria-hidden="true"
      className={`w-3 shrink-0 font-mono text-xs ${faint}`}
    >
      <span className="group-open:hidden">+</span>
      <span className="hidden group-open:inline">−</span>
    </span>
  );
}

function Swatch({ area }: { area?: AreaStyle }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0"
      data-area-swatch={area ? "" : undefined}
      style={area ? { backgroundColor: area.color } : undefined}
    />
  );
}

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
  const plantedCount = readback.board.reduce(
    (n, d) => n + d.phases.reduce((m, p) => m + p.moments.length, 0),
    0,
  );
  const navButton = `${label} hover:text-stone-900 dark:hover:text-stone-100`;

  return (
    <article className="mx-auto max-w-3xl px-6 py-12">
      <header
        className={`flex flex-wrap items-baseline justify-between gap-4 border-b pb-6 ${rule}`}
      >
        <div>
          <h1 className={`text-2xl font-medium tracking-tight ${ink}`}>
            The week
          </h1>
          <p className={`mt-1 ${label}`}>
            {formatCycleDateRange(readback.window.from, readback.window.to)}
          </p>
        </div>
        <nav aria-label="Weeks" className="flex gap-4">
          <button className={navButton} onClick={onPrevious} type="button">
            Previous
          </button>
          {onThisWeek && (
            <button className={navButton} onClick={onThisWeek} type="button">
              This week
            </button>
          )}
          {onNext && (
            <button className={navButton} onClick={onNext} type="button">
              Next
            </button>
          )}
        </nav>
      </header>

      {!logReadable && (
        <p className={`mt-6 max-w-[62ch] text-sm ${muted}`}>
          Footprints live in the desktop app's activity log. Here only what you
          planted reads back.
        </p>
      )}

      <section className="pt-10">
        <h2 className={label}>Planted and walked</h2>
        {rows.length === 0 ? (
          <p className={`mt-4 text-sm ${muted}`}>
            Nothing planted and no footprints this week or last.
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr>
                <th className={`pb-2 text-left font-normal ${label}`}>Area</th>
                <th className={`pb-2 text-right font-normal ${label}`}>
                  Planted
                </th>
                <th className={`pb-2 text-right font-normal ${label}`}>
                  Last week
                </th>
                {/* Unseen is not zero: without the log, no footprint column at all. */}
                {logReadable && (
                  <>
                    <th className={`pb-2 pl-6 text-right font-normal ${label}`}>
                      Footprints
                    </th>
                    <th className={`pb-2 text-right font-normal ${label}`}>
                      Last week
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className={`border-t ${rule}`} key={r.areaId}>
                  <td className="py-2">
                    <span className={`flex items-center gap-2 ${ink}`}>
                      <Swatch area={areas[r.areaId]} />
                      {name(r.areaId)}
                    </span>
                  </td>
                  <td className={`py-2 ${number} ${ink}`}>{r.planted}</td>
                  <td className={`py-2 ${number} ${faint}`}>{r.plantedLast}</td>
                  {logReadable && (
                    <>
                      <td className={`py-2 pl-6 ${number} ${ink}`}>
                        {formatMinutes(r.minutes)}
                      </td>
                      <td className={`py-2 ${number} ${faint}`}>
                        {formatMinutes(r.minutesLast)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {readback.wilting.length > 0 && (
        <section className="pt-10">
          <h2 className={label}>Wilting at the week's close</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {readback.wilting.map((w) => (
              <li
                className={`flex items-center gap-2 ${muted}`}
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
        <h2 className={label}>By surface</h2>
        <div className={`mt-3 border-t ${rule}`}>
          {readback.footprints.map((f) =>
            f.status === "not drawn" ? (
              <div
                className={`flex items-baseline gap-3 border-b py-2 ${rule}`}
                key={f.surface}
              >
                <span className="w-3 shrink-0" />
                <span className={`w-20 text-sm ${muted}`}>
                  {SURFACE_LABEL[f.surface]}
                </span>
                <span className={`font-mono text-xs ${faint}`}>
                  not drawn · no spring feeds it yet
                </span>
              </div>
            ) : (
              <details className={`group border-b ${rule}`} key={f.surface}>
                <summary className={summary}>
                  <Marker />
                  <span className={`w-20 text-sm ${ink}`}>
                    {SURFACE_LABEL[f.surface]}
                  </span>
                  <span className={`font-mono text-xs ${muted}`}>
                    {logReadable
                      ? coverageLine(f.thisWeek.coverage)
                      : "not readable in this build"}
                  </span>
                </summary>
                {logReadable && (
                  <SurfaceDetail
                    areas={areas}
                    byOrder={byOrder}
                    last={f.lastWeek}
                    name={name}
                    thisWeek={f.thisWeek}
                  />
                )}
              </details>
            ),
          )}
        </div>
      </section>

      <section className="pt-10">
        <details className={`group border-y ${rule}`}>
          <summary className={summary}>
            <Marker />
            <span className={label}>The board</span>
            <span className={`font-mono text-xs ${faint}`}>
              {plantedCount === 1 ? "1 moment" : `${plantedCount} moments`}
            </span>
          </summary>
          <div className="space-y-5 pb-6 pl-6 pt-2">
            {readback.board.map((day) => (
              <div key={day.day}>
                <h3 className={label}>{getDateLabel(day.day)}</h3>
                {day.phases.length === 0 ? (
                  <p className={`mt-1 text-sm ${faint}`}>Nothing planted.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {day.phases.flatMap((p) =>
                      p.moments.map((m) => (
                        <li
                          className="flex items-baseline gap-2 text-sm"
                          key={m.id}
                        >
                          <span className={`w-4 shrink-0 ${faint}`}>
                            <PhaseIcon
                              className="h-3 w-3"
                              phase={p.phase as Phase}
                            />
                          </span>
                          <Swatch area={areas[m.areaId]} />
                          <span className={ink}>{m.name}</span>
                          {!m.traceable && (
                            <span
                              className={`font-mono text-xs ${faint}`}
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
        </details>
      </section>
    </article>
  );
}

function SurfaceDetail({
  thisWeek,
  last,
  areas,
  byOrder,
  name,
}: {
  thisWeek: Footprint;
  last: Footprint;
  areas: Readonly<Record<string, AreaStyle>>;
  byOrder: (a: { areaId: string }, b: { areaId: string }) => number;
  name: (id: string, fallback?: string) => string;
}) {
  const thisByArea = new Map(thisWeek.byArea.map((a) => [a.areaId, a]));
  const lastByArea = new Map(last.byArea.map((a) => [a.areaId, a.minutes]));
  const ids = [...new Set([...thisByArea.keys(), ...lastByArea.keys()])]
    .map((areaId) => ({ areaId }))
    .sort(byOrder);
  return (
    <div className="pb-4 pl-6">
      {ids.length > 0 && (
        <ul className="space-y-1 text-sm">
          {ids.map(({ areaId }) => (
            <li className="flex items-center gap-2" key={areaId}>
              <Swatch area={areas[areaId]} />
              <span className={`flex-1 ${muted}`}>
                {name(areaId, thisByArea.get(areaId)?.areaName)}
              </span>
              <span className={`w-24 ${number} ${ink}`}>
                {formatMinutes(thisByArea.get(areaId)?.minutes ?? 0)}
              </span>
              <span className={`w-24 ${number} ${faint}`}>
                {formatMinutes(lastByArea.get(areaId) ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {thisWeek.unmapped.length > 0 && (
        <p className={`mt-3 font-mono text-xs ${muted}`}>
          unmapped:{" "}
          {thisWeek.unmapped
            .map((u) => `${u.locator} ${formatMinutes(u.minutes)}`)
            .join(" · ")}
        </p>
      )}
      <p className={`mt-1 font-mono text-xs ${faint}`}>
        last week: {coverageLine(last.coverage)}
      </p>
    </div>
  );
}
