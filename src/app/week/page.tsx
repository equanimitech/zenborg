"use client";

import { useValue } from "@legendapp/state/react";
import { useEffect, useMemo, useState } from "react";
import { WeekReadbackView } from "@/components/week/WeekReadbackView";
import type { ActivityEvent } from "@/domain/attention/ActivityEvent";
import {
  localDate,
  wakingDay,
  wakingDayWindow,
} from "@/domain/attention/GardenClock";
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

/**
 * Zenborg — the week, read back.
 *
 * The same `weekReadback` the MCP `get_footprints` tool returns, computed
 * here from the vault the app already holds and the activity log read
 * through one Tauri command. No network, no model. You visit it; it does not
 * visit you.
 */
export default function WeekPage() {
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
        console.error("[week] activity log unreadable:", error);
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
          now: new Date(),
        },
        week.from,
        week.to,
      ),
    [
      events,
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
    <div className="h-full overflow-y-auto bg-background">
      <WeekReadbackView
        areas={areaStyles}
        logReadable={logReadable}
        onNext={isThisWeek ? undefined : nextWeek}
        onPrevious={() => setWeek(previousWindow(week.from, week.to))}
        onThisWeek={isThisWeek ? undefined : () => setWeek(thisWeek)}
        readback={readback}
      />
    </div>
  );
}
