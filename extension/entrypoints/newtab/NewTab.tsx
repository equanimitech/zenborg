import { useEffect, useState } from "react";
import { fenceCache } from "@/modules/fence/store";
import { cooldownNextLapse } from "@/modules/friction/cooldown/store";
import { areaMap as areaMapStore, areas as areasStore, type AreaInfo } from "@/modules/friction/policy/store";
import { queryEvents, queryActiveMoment, queryTodayMoments, type ActiveMoment, type TodayBoard, type TodayMoment } from "@/modules/relay/client";
import { setArea } from "@/modules/relay/client";
import { runs, type Run } from "@/modules/domain";
import { startOfLocalDay } from "@/modules/activity/events";

interface DomainStats {
  readonly domain: string;
  readonly dwellMs: number;
  readonly audibleDwellMs: number;
  readonly areaId?: string;
  readonly videos: number;
  readonly posts: number;
  readonly games: number;
}

interface AreaGroup {
  readonly area: AreaInfo | null;
  readonly areaId: string;
  readonly domains: readonly DomainStats[];
  readonly totalDwell: number;
}

function phaseName(): string {
  const h = new Date().getHours();
  if (h < 12) { return "morning"; }
  if (h < 17) { return "afternoon"; }
  if (h < 21) { return "evening"; }
  return "night";
}

function dayOfWeek(): string {
  return new Date().toLocaleDateString(undefined, { weekday: "long" });
}

function formatDwell(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) { return `${minutes}m`; }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatUntil(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function computeStats(
  domainRuns: readonly Run[],
  events: readonly { kind?: string; payload?: { domain?: string } }[],
  areaMap: Record<string, string>,
): readonly DomainStats[] {
  const byDomain = new Map<string, { dwellMs: number; audibleDwellMs: number; videos: number; posts: number; games: number }>();

  for (const run of domainRuns) {
    const d = run.domain as string;
    const existing = byDomain.get(d) ?? { dwellMs: 0, audibleDwellMs: 0, videos: 0, posts: 0, games: 0 };
    existing.dwellMs += run.dwellMs as number;
    existing.audibleDwellMs += run.audibleDwellMs as number;
    byDomain.set(d, existing);
  }

  for (const e of events) {
    const d = (e.payload?.domain as string) ?? "";
    if (!d) { continue; }
    const existing = byDomain.get(d) ?? { dwellMs: 0, audibleDwellMs: 0, videos: 0, posts: 0, games: 0 };
    if (e.kind === "video_ended") { existing.videos += 1; }
    if (e.kind === "post_seen") { existing.posts += 1; }
    if (e.kind === "game_finished") { existing.games += 1; }
    byDomain.set(d, existing);
  }

  const result: DomainStats[] = [];
  for (const [domain, stats] of byDomain) {
    const totalDwell = stats.dwellMs + stats.audibleDwellMs;
    if (totalDwell < 60_000 && stats.videos === 0 && stats.posts === 0 && stats.games === 0) {
      continue;
    }
    result.push({
      domain,
      dwellMs: stats.dwellMs,
      audibleDwellMs: stats.audibleDwellMs,
      areaId: areaMap[domain],
      videos: stats.videos,
      posts: stats.posts,
      games: stats.games,
    });
  }

  return result.sort((a, b) => (b.dwellMs + b.audibleDwellMs) - (a.dwellMs + a.audibleDwellMs));
}

function groupByArea(stats: readonly DomainStats[], allAreas: readonly AreaInfo[]): readonly AreaGroup[] {
  const groups = new Map<string, DomainStats[]>();

  for (const s of stats) {
    const key = s.areaId ?? "__uncategorized__";
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const result: AreaGroup[] = [];
  for (const [areaId, domains] of groups) {
    const area = areaId === "__uncategorized__" ? null : allAreas.find((a) => a.id === areaId) ?? null;
    const totalDwell = domains.reduce((sum, d) => sum + d.dwellMs + d.audibleDwellMs, 0);
    result.push({ area, areaId, domains, totalDwell });
  }

  return result.sort((a, b) => {
    if (a.area === null && b.area !== null) { return 1; }
    if (a.area !== null && b.area === null) { return -1; }
    return b.totalDwell - a.totalDwell;
  });
}

function actionSummary(s: DomainStats): string {
  const parts: string[] = [];
  if (s.videos > 0) { parts.push(`${s.videos} video${s.videos === 1 ? "" : "s"}`); }
  if (s.posts > 0) { parts.push(`${s.posts} post${s.posts === 1 ? "" : "s"}`); }
  if (s.games > 0) { parts.push(`${s.games} game${s.games === 1 ? "" : "s"}`); }
  return parts.join(", ");
}

function circleSize(dwellMs: number, maxDwell: number): number {
  const min = 24;
  const max = 64;
  const ratio = Math.sqrt(dwellMs / Math.max(maxDwell, 1));
  return Math.round(min + ratio * (max - min));
}

const PHASE_ORDER: Record<string, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2, NIGHT: 3 };

function groupByPhase(moments: readonly TodayMoment[]): [string, readonly TodayMoment[]][] {
  const groups = new Map<string, TodayMoment[]>();
  for (const m of moments) {
    const phase = m.phase || "OTHER";
    const list = groups.get(phase) ?? [];
    list.push(m);
    groups.set(phase, list);
  }
  return [...groups.entries()].sort(([a], [b]) => (PHASE_ORDER[a] ?? 99) - (PHASE_ORDER[b] ?? 99));
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "MORNING": return "morning";
    case "AFTERNOON": return "afternoon";
    case "EVENING": return "evening";
    case "NIGHT": return "night";
    default: return phase.toLowerCase();
  }
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  return `${parseInt(h, 10)}:${m}`;
}

export function NewTab() {
  const [fenceCount, setFenceCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [stats, setStats] = useState<readonly DomainStats[]>([]);
  const [allAreas, setAllAreas] = useState<readonly AreaInfo[]>([]);
  const [areaMap, setAreaMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeMoment, setActiveMoment] = useState<ActiveMoment | null>(null);
  const [board, setBoard] = useState<TodayBoard>({ moments: [], currentPhase: "" });
  const [assigningDomain, setAssigningDomain] = useState<string | null>(null);

  useEffect(() => {
    fenceCache.getValue().then((fences) => setFenceCount(Object.keys(fences).length));
    cooldownNextLapse().then(setCooldownUntil);
    queryActiveMoment().then(setActiveMoment);
    queryTodayMoments().then(setBoard);
    areasStore.getValue().then(setAllAreas);

    const now = Date.now();
    const dayStart = startOfLocalDay(now);

    Promise.all([
      queryEvents(dayStart),
      areaMapStore.getValue(),
    ]).then(([events, map]) => {
      setAreaMap(map);
      const domainRuns = runs(events);
      const computed = computeStats(domainRuns, events as readonly { kind?: string; payload?: { domain?: string } }[], map);
      setStats(computed);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleAssign = async (domain: string, areaId: string): Promise<void> => {
    const next = { ...areaMap };
    if (areaId === "") {
      delete next[domain];
    } else {
      next[domain] = areaId;
    }
    setAreaMap(next);
    setStats(stats.map((s) => s.domain === domain ? { ...s, areaId: areaId || undefined } : s));
    setAssigningDomain(null);
    await setArea(domain, areaId);
  };

  const maxDwell = stats.length > 0 ? stats[0].dwellMs + stats[0].audibleDwellMs : 1;
  const areaGroups = groupByArea(stats, allAreas);
  const phaseGroups = groupByPhase(board.moments);

  return (
    <div className="newtab-root">
      <div className="newtab-center">
        <p className="newtab-time">
          {dayOfWeek()} {phaseName()}
        </p>

        {/* Active moment */}
        <div className="newtab-intention">
          {activeMoment ? (
            <p className="newtab-intention-line">
              <span className="newtab-intention-marker">&#9673;</span>
              {activeMoment.emoji && <span className="newtab-intention-emoji">{activeMoment.emoji}</span>}
              <span className="newtab-intention-name">{activeMoment.name}</span>
              {activeMoment.area && <span className="newtab-intention-area">{activeMoment.area}</span>}
            </p>
          ) : (
            <p className="newtab-intention-none">what will I tend to today?</p>
          )}
        </div>

        {/* Today's moments by phase */}
        {board.moments.length > 0 && (
          <section className="newtab-moments">
            {phaseGroups.map(([phase, moments]) => (
              <div key={phase} className="newtab-phase-group">
                <p className={`newtab-phase-label ${phase === board.currentPhase ? "newtab-phase-current" : ""}`}>
                  {phaseLabel(phase)}
                </p>
                <ul className="newtab-moment-list">
                  {moments.map((m) => (
                    <li
                      key={m.id}
                      className={`newtab-moment ${m.active ? "newtab-moment-active" : ""} ${m.status === "DONE" ? "newtab-moment-done" : ""}`}
                    >
                      <span className="newtab-moment-indicator">{m.active ? "●" : m.status === "DONE" ? "✓" : "○"}</span>
                      {m.areaEmoji && <span className="newtab-moment-emoji">{m.areaEmoji}</span>}
                      <span className="newtab-moment-name">{m.name}</span>
                      {m.startTime && <span className="newtab-moment-time">{formatTime(m.startTime)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {/* Browser usage — circles grouped by area */}
        {loading ? (
          <p className="newtab-loading">loading…</p>
        ) : stats.length === 0 ? (
          <p className="newtab-empty">No browser activity today.</p>
        ) : (
          <section className="newtab-usage">
            {areaGroups.map((group) => (
              <div key={group.areaId} className="newtab-area-group">
                <div className="newtab-area-header">
                  <span className="newtab-area-label">
                    {group.area ? `${group.area.emoji} ${group.area.name}` : "uncategorized"}
                  </span>
                  <span className="newtab-area-dwell">{formatDwell(group.totalDwell)}</span>
                </div>
                <div className="newtab-circles">
                  {group.domains.map((s) => {
                    const totalDwell = s.dwellMs + s.audibleDwellMs;
                    const size = circleSize(totalDwell, maxDwell);
                    const actions = actionSummary(s);
                    const isAssigning = assigningDomain === s.domain;
                    const audibleNote = s.audibleDwellMs > 0 ? ` (${formatDwell(s.audibleDwellMs)} audible)` : "";
                    return (
                      <div key={s.domain} className="newtab-circle-wrap">
                        <button
                          className="newtab-circle"
                          style={{
                            width: `${size}px`,
                            height: `${size}px`,
                            backgroundColor: group.area?.color ?? "var(--quiet)",
                          }}
                          onClick={() => setAssigningDomain(isAssigning ? null : s.domain)}
                          title={`${s.domain} — ${formatDwell(totalDwell)}${audibleNote}${actions ? ` — ${actions}` : ""}`}
                        >
                          <img
                            src={`chrome-extension://${browser.runtime.id}/_favicon/?pageUrl=https://${s.domain}&size=16`}
                            alt=""
                            className="newtab-favicon"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </button>
                        <span className="newtab-circle-label">{s.domain.replace(/\.com$|\.org$|\.io$|\.tv$|\.net$/, "")}</span>
                        <span className="newtab-circle-dwell">{formatDwell(totalDwell)}</span>
                        {actions && <span className="newtab-circle-actions">{actions}</span>}

                        {/* Area assignment dropdown */}
                        {isAssigning && (
                          <div className="newtab-assign">
                            <select
                              autoFocus
                              value={s.areaId ?? ""}
                              onChange={(e) => void handleAssign(s.domain, e.target.value)}
                              onBlur={() => setAssigningDomain(null)}
                            >
                              <option value="">— no area —</option>
                              {allAreas.map((a) => (
                                <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {(fenceCount > 0 || cooldownUntil !== null) && (
          <p className="newtab-fence-summary">
            {fenceCount > 0 && `${fenceCount} fence${fenceCount === 1 ? "" : "s"}`}
            {fenceCount > 0 && cooldownUntil !== null && " · "}
            {cooldownUntil !== null && `cooldown until ${formatUntil(cooldownUntil)}`}
          </p>
        )}

        <button
          className="newtab-app-link"
          onClick={() => {
            window.location.href = "x-apple-application:tech.equanimi.zenborg";
          }}
        >
          open zenborg
        </button>
      </div>
    </div>
  );
}
