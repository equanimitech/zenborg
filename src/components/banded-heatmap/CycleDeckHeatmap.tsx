"use client";

import { useValue } from "@legendapp/state/react";
import { useCallback } from "react";
import { CycleService } from "@/application/services/CycleService";
import type { CreateCycleProps } from "@/domain/entities/Cycle";
import {
  areas$,
  cycles$,
  moments$,
  phaseConfigs$,
} from "@/infrastructure/state/store";
import {
  cycleDeckSelectedCycleId$,
  selectedDay$,
} from "@/infrastructure/state/ui-store";
import { getTodayISO } from "@/lib/dates";
import { BandedHeatmap } from "./BandedHeatmap";

const cycleService = new CycleService();

export function CycleDeckHeatmap() {
  const allCycles = useValue(() => cycles$.get());
  const allMoments = useValue(() => moments$.get());
  const allAreas = useValue(() => areas$.get());
  const allPhaseConfigs = useValue(() => phaseConfigs$.get());
  const selectedCycleId = useValue(cycleDeckSelectedCycleId$);
  const selectedDay = useValue(selectedDay$);

  // Re-derive arrays each render. Legend State may return a stable record
  // reference across in-place child mutations (e.g. cycles$[id].set(...)),
  // which would make `useMemo` cache stale arrays. Recomputing is cheap and
  // guarantees the BandedHeatmap re-derives its viewmodel on every commit.
  const cycles = Object.values(allCycles);
  const moments = Object.values(allMoments);
  const areas = Object.values(allAreas);
  const phaseConfigs = Object.values(allPhaseConfigs);

  const today = getTodayISO();

  const handleCycleSelect = useCallback((cycleId: string) => {
    cycleDeckSelectedCycleId$.set(cycleId);
  }, []);

  const handleCycleCreate = useCallback((props: CreateCycleProps) => {
    const result = cycleService.planCycle(
      props.name,
      undefined,
      props.startDate,
      props.endDate ?? undefined,
      props.intention ?? null,
    );
    if ("error" in result) {
      console.warn("[heatmap] cycle create failed:", result.error);
      return;
    }
    cycleDeckSelectedCycleId$.set(result.id);
    selectedDay$.set(result.startDate);
  }, []);

  const handleDaySelect = useCallback(
    (date: string) => {
      if (selectedDay$.peek() !== date) selectedDay$.set(date);
      const containing = cycles.find(
        (c) => date >= c.startDate && date <= (c.endDate ?? "9999-12-31"),
      );
      const nextCycleId = containing?.id ?? null;
      if (cycleDeckSelectedCycleId$.peek() !== nextCycleId) {
        cycleDeckSelectedCycleId$.set(nextCycleId);
      }
    },
    [cycles],
  );

  return (
    <BandedHeatmap
      cycles={cycles}
      moments={moments}
      areas={areas}
      phaseConfigs={phaseConfigs}
      today={today}
      selectedCycleId={selectedCycleId}
      selectedDay={selectedDay}
      onCycleSelect={handleCycleSelect}
      onDaySelect={handleDaySelect}
      onCycleCreate={handleCycleCreate}
    />
  );
}
