"use client";

import { useValue } from "@legendapp/state/react";
import { useCallback, useMemo, useState } from "react";
import { CycleService } from "@/application/services/CycleService";
import { BandedHeatmap } from "@/components/banded-heatmap/BandedHeatmap";
import { SeasonReadback } from "@/components/harvest/SeasonReadback";
import { HarvestWeek } from "@/components/week/HarvestWeek";
import {
  deriveHarvestSeason,
  resolveHarvestCycle,
} from "@/infrastructure/state/harvestViewModel";
import {
  areas$,
  cycles$,
  moments$,
  phaseConfigs$,
} from "@/infrastructure/state/store";
import { harvestSelectedCycleId$ } from "@/infrastructure/state/ui-store";
import { getTodayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Zenborg — Harvest
 *
 * What grew, read back at two scales. It opens on the **week** (Monday →
 * Sunday): what was planted beside where attention went, each surface with
 * what it could see, then the board. Zoom out to the **season**: what it
 * intended, what it held, and what was planted in it. Everything here comes
 * from the vault and the activity log the app already holds — no network, no
 * model, no photo permission. A garden with nothing yet gets an empty state,
 * never an error.
 *
 * The season index is the banded heatmap, not a new timeline: the seasons are
 * already drawn there, so navigating them is picking one. The season scale
 * opens on the most recently closed season until you pick another.
 *
 * "No network, no model" holds without qualification again. Slice C briefly
 * made this page the composition root that handed the readback a library
 * port, so harvest could read the journal; that came out with the penceive
 * dependency in 8f5c9aa and is meant to come back. This is a removal with a
 * revert target, not a feature that was never built: `git revert 8f5c9aa`
 * restores the seam whole, and what it then needs is a credential for the
 * private penceive remote rather than any code.
 */
type Scale = "week" | "season";

export default function HarvestPage() {
  const [scale, setScale] = useState<Scale>("week");

  return (
    <div className="h-full bg-background transition-colors flex flex-col overflow-hidden">
      <div className="flex flex-shrink-0 justify-end border-b border-stone-200 px-4 py-2 dark:border-stone-800">
        <fieldset className="flex gap-4">
          <legend className="sr-only">Scale</legend>
          {(["week", "season"] as const).map((s) => (
            <button
              aria-pressed={scale === s}
              className={cn(
                "border-b py-0.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors duration-150",
                scale === s
                  ? "border-stone-900 text-stone-900 dark:border-stone-100 dark:text-stone-100"
                  : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
              )}
              key={s}
              onClick={() => setScale(s)}
              type="button"
            >
              {s}
            </button>
          ))}
        </fieldset>
      </div>

      {scale === "week" ? (
        <main className="flex-1 overflow-y-auto">
          <HarvestWeek />
        </main>
      ) : (
        <HarvestSeason />
      )}
    </div>
  );
}

function HarvestSeason() {
  const cycles = useValue(cycles$);
  const moments = useValue(moments$);
  const areas = useValue(areas$);
  const phaseConfigs = useValue(phaseConfigs$);
  const selectedCycleId = useValue(harvestSelectedCycleId$);

  const today = getTodayISO();

  const cycleList = useMemo(() => Object.values(cycles), [cycles]);
  const momentList = useMemo(() => Object.values(moments), [moments]);
  const areaList = useMemo(() => Object.values(areas), [areas]);
  const phaseConfigList = useMemo(
    () => Object.values(phaseConfigs),
    [phaseConfigs],
  );

  const cycle = useMemo(
    () => resolveHarvestCycle(cycleList, selectedCycleId, today),
    [cycleList, selectedCycleId, today],
  );

  const season = useMemo(() => {
    if (!cycle) {
      return null;
    }

    return deriveHarvestSeason({
      cycle,
      moments: momentList,
      areas: areaList,
      phaseConfigs: phaseConfigList,
    });
  }, [cycle, momentList, areaList, phaseConfigList]);

  const cycleService = useMemo(() => new CycleService(), []);

  // An edit here is a person writing, so the service stamps it "human" and a
  // summarizer re-run will leave it alone from then on.
  const handleEditReflection = useCallback(
    (reflection: string | null) => {
      if (!cycle) {
        return;
      }

      cycleService.updateCycle(cycle.id, { reflection });
    },
    [cycle, cycleService],
  );

  return (
    <>
      <div className="flex-shrink-0 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <BandedHeatmap
          areas={areaList}
          cycles={cycleList}
          moments={momentList}
          onCycleSelect={(id) => harvestSelectedCycleId$.set(id)}
          phaseConfigs={phaseConfigList}
          selectedCycleId={cycle?.id ?? null}
          today={today}
        />
      </div>

      <main className="flex-1 overflow-y-auto">
        <SeasonReadback
          onEditReflection={handleEditReflection}
          season={season}
        />
      </main>
    </>
  );
}
