"use client";

import { useValue } from "@legendapp/state/react";
import { useEffect, useMemo, useState } from "react";
import type { ActivityEvent } from "@/domain/attention/ActivityEvent";
import {
  localDate,
  wakingDay,
  wakingDayWindow,
} from "@/domain/attention/GardenClock";
import type { GarminHabitMap } from "@/domain/garmin/GarminHabitMap";
import {
  previousWindow,
  readbackSpan,
  weekOf,
  weekReadback,
} from "@/domain/readback/WeekReadback";
import {
  areas$,
  cyclePlans$,
  cycles$,
  habits$,
  moments$,
  phaseConfigs$,
} from "@/infrastructure/state/store";
import {
  canReadActivity,
  tauriActivityLog,
} from "@/infrastructure/vault/activity-log";
import { readGarminHabitMap } from "@/infrastructure/vault/garmin-habit-map";
import { WeekReadbackView } from "./WeekReadbackView";

/**
 * Harvest at the week's scale: the same `weekReadback` the MCP
 * `get_footprints` tool returns, computed from the store, the activity log
 * (one Tauri command) and the Garmin habit map (another). No network, no
 * model. The log is only read while this scale is on screen.
 */
export function HarvestWeek() {
  const areas = useValue(areas$);
  const habits = useValue(habits$);
  const moments = useValue(moments$);
  const phaseConfigs = useValue(phaseConfigs$);
  const cycles = useValue(cycles$);
  const cyclePlans = useValue(cyclePlans$);

  const thisWeek = weekOf(wakingDay());
  const [week, setWeek] = useState(thisWeek);
  const logReadable = canReadActivity();

  const [events, setEvents] = useState<readonly ActivityEvent[]>([]);
  const [habitMap, setHabitMap] = useState<GarminHabitMap | undefined>();

  useEffect(() => {
    if (!logReadable) return;
    let live = true;
    readGarminHabitMap().then((map) => {
      if (live) setHabitMap(map);
    });
    return () => {
      live = false;
    };
  }, [logReadable]);

  useEffect(() => {
    if (!logReadable) return;
    let live = true;
    const span = readbackSpan(week.from, week.to);
    tauriActivityLog
      .read(span.from, span.to)
      .then((read) => {
        if (live) setEvents(read);
      })
      .catch((error) => {
        console.error("[harvest] activity log unreadable:", error);
        if (live) setEvents([]);
      });
    return () => {
      live = false;
    };
  }, [week.from, week.to, logReadable]);

  const readback = useMemo(
    () =>
      weekReadback(
        {
          events,
          moments: Object.values(moments),
          habits: Object.values(habits),
          areas: Object.values(areas),
          phaseConfigs: Object.values(phaseConfigs),
          cycles: Object.values(cycles),
          cyclePlans: Object.values(cyclePlans),
          ...(habitMap ? { garminHabitMap: habitMap } : {}),
          now: new Date(),
        },
        week.from,
        week.to,
      ),
    [
      events,
      habitMap,
      moments,
      habits,
      areas,
      phaseConfigs,
      cycles,
      cyclePlans,
      week.from,
      week.to,
    ],
  );

  const areaStyles = useMemo(
    () =>
      Object.fromEntries(
        Object.values(areas).map((a) => [
          a.id,
          { name: a.name, color: a.color, order: a.order },
        ]),
      ),
    [areas],
  );

  const isThisWeek = week.from === thisWeek.from;
  // Sunday's waking day ends at Monday 04:00, so its end names the next Monday.
  const nextWeek = () =>
    setWeek(weekOf(localDate(wakingDayWindow(week.to).to)));

  return (
    <WeekReadbackView
      areas={areaStyles}
      logReadable={logReadable}
      onNext={isThisWeek ? undefined : nextWeek}
      onPrevious={() => setWeek(previousWindow(week.from, week.to))}
      onThisWeek={isThisWeek ? undefined : () => setWeek(thisWeek)}
      readback={readback}
    />
  );
}
