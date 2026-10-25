#!/usr/bin/env node
/**
 * moment-awareness — the garden's intention proposer.
 *
 * Fires on SessionStart. Reads the garden state and proposes activating
 * a moment that matches the current context (phase + working directory).
 *
 * If an active moment is already set, reports it as session context.
 * If not, finds the best match among today's planted moments and proposes it.
 * If nothing is planted for the current phase, suggests planting from habits.
 *
 * Fail open, silently.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { staleReason, wakingDayKey } from "../domain/attention/ActiveMoment.ts";

const VAULT =
  process.env.ZENBORG_HOME ||
  process.env.KAIROS_HOME ||
  join(homedir(), ".zenborg");

const silent = (): never => process.exit(0);

interface PhaseConfig {
  phase: string;
  label: string;
  startHour: number;
  endHour: number;
}

interface Moment {
  id: string;
  name: string;
  day?: string;
  phase?: string;
  habitId?: string;
  areaId?: string;
}

interface Area {
  id: string;
  name: string;
  emoji?: string;
}

interface Habit {
  id: string;
  name: string;
  areaId?: string;
  archivedAt?: string;
}

function readJSON(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function currentPhase(configs: PhaseConfig[]): PhaseConfig | null {
  const hour = new Date().getHours();
  for (const cfg of configs) {
    const { startHour, endHour } = cfg;
    if (endHour <= startHour) {
      if (hour >= startHour || hour < endHour) return cfg;
    } else {
      if (hour >= startHour && hour < endHour) return cfg;
    }
  }
  return null;
}

/** Fuzzy match cwd path segments against area names. */
function matchArea(cwd: string, areas: Area[]): Area | null {
  const segments = cwd.split("/");
  const devIdx = segments.indexOf("Developer");
  if (devIdx < 0) return null;
  const relevant = segments
    .slice(devIdx + 1)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ""));

  for (const area of areas) {
    const norm = area.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm.length < 2) continue;
    if (relevant.some((s) => s === norm || s.includes(norm) || norm.includes(s)))
      return area;
  }
  return null;
}

function minutesAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

function drainStdin(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.on("data", () => {});
    process.stdin.on("end", resolve);
    process.stdin.on("error", resolve);
  });
}

async function main(): Promise<void> {
  await drainStdin();

  const activeMoment = readJSON(join(VAULT, "activeMoment.json")) as {
    momentId?: string;
    at?: string;
  };
  const momentsMap = readJSON(join(VAULT, "moments.json")) as Record<string, Moment>;
  const areasMap = readJSON(join(VAULT, "areas.json")) as Record<string, Area>;
  const habitsMap = readJSON(join(VAULT, "habits.json")) as Record<string, Habit>;
  const phaseCfgsMap = readJSON(join(VAULT, "phaseConfigs.json")) as Record<
    string,
    PhaseConfig
  >;

  const phases = Object.values(phaseCfgsMap);
  const phase = currentPhase(phases);
  if (!phase) silent();

  const areas = Object.values(areasMap);
  const cwd = process.cwd();
  const matchedArea = matchArea(cwd, areas);

  const today = wakingDayKey();
  const todayMoments = Object.values(momentsMap).filter((m) =>
    m.day?.startsWith(today),
  );
  const phaseMoments = todayMoments.filter((m) => m.phase === phase!.phase);

  // ── Active moment is set → report context. A pointer to a moment that is
  // not on today's board is released: read as none, never written (one writer).
  let released = "";
  if (activeMoment.momentId) {
    const active = momentsMap[activeMoment.momentId];
    const reason = staleReason(active, today);
    if (reason) {
      released = `Stale active moment${active ? ` "${active.name}"` : ""} released (${reason}). `;
    } else if (active) {
      const area = active.areaId ? areasMap[active.areaId] : null;
      const ago = activeMoment.at ? minutesAgo(activeMoment.at) : 0;
      const areaLabel = area ? ` (${area.emoji ?? ""} ${area.name})`.trim() : "";
      const phaseChanged = active.phase && active.phase !== phase!.phase;
      const stale = ago > 120;

      if (phaseChanged || stale) {
        const why = phaseChanged
          ? `phase changed (was ${active.phase}, now ${phase!.label})`
          : `set ${ago}m ago`;
        process.stdout.write(
          `<zenborg-intention: stale active "${active.name}"${areaLabel} — ` +
            `${why}. Propose picking a ${phase!.label} moment ` +
            `(set_active_moment overwrites it), or ask the gardener.>`,
        );
      } else {
        process.stdout.write(
          `<zenborg-intention: active "${active.name}"${areaLabel}, ` +
            `set ${ago}m ago. Phase: ${phase!.label}. ` +
            `Clear on /close-up or when the gardener switches.>`,
        );
      }
      process.exit(0);
    }
  }

  // ── No active moment → propose one ─────────────────────────────────
  const lines: string[] = [];
  lines.push(
    `${released}No active intention. Phase: ${phase!.label} (${phase!.startHour}:00–${phase!.endHour}:00).`,
  );

  let bestMatch: Moment | null = null;
  if (matchedArea) {
    bestMatch = phaseMoments.find((m) => m.areaId === matchedArea.id) ?? null;
  }
  if (!bestMatch && phaseMoments.length > 0) {
    bestMatch = phaseMoments[0];
  }

  if (bestMatch) {
    const area = bestMatch.areaId ? areasMap[bestMatch.areaId] : null;
    const areaLabel = area ? ` (${area.emoji ?? ""} ${area.name})`.trim() : "";
    lines.push(`Best match: "${bestMatch.name}"${areaLabel} [${bestMatch.id}].`);
    if (phaseMoments.length > 1) {
      const others = phaseMoments
        .filter((m) => m.id !== bestMatch!.id)
        .map((m) => {
          const a = m.areaId ? areasMap[m.areaId] : null;
          return `"${m.name}"${a ? ` (${a.name})` : ""}`;
        })
        .join(", ");
      lines.push(`Also planted: ${others}.`);
    }
    lines.push(
      `Propose activating "${bestMatch.name}" for this session. ` +
        `Use set_active_moment with momentId ${bestMatch.id}.`,
    );
  } else if (matchedArea) {
    const areaHabits = Object.values(habitsMap).filter(
      (h) => h.areaId === matchedArea.id && !h.archivedAt,
    );
    if (areaHabits.length > 0) {
      const names = areaHabits
        .slice(0, 3)
        .map((h) => `"${h.name}"`)
        .join(", ");
      lines.push(
        `No ${phase!.label} moments for ${matchedArea.name}. Habits: ${names}.`,
      );
      lines.push(
        `Propose planting a moment from one of these. ` +
          `Use spawn_spontaneous_from_habit or add_moment.`,
      );
    }
  } else {
    if (todayMoments.length > 0) {
      lines.push(
        `${todayMoments.length} moment(s) today, none in ${phase!.label}.`,
      );
    } else {
      lines.push(`No moments planted today.`);
    }
    lines.push(`Propose setting an intention for this session.`);
  }

  process.stdout.write(`<zenborg-intention: ${lines.join(" ")}>`);
  process.exit(0);
}

main().catch(() => process.exit(0));
