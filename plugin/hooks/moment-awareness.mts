#!/usr/bin/env node
/**
 * moment-awareness: the garden's intention reporter.
 *
 * Fires on SessionStart. Reports the garden's intention as context for Claude: the active moment, or that none is set and what is planted this phase. It proposes nothing; the gardener picks in the moment band.
 *
 * Fail open, silently.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { staleReason, wakingDayKey } from "../domain/attention/ActiveMoment.ts";
import { spendLine } from "./spend-line.ts";
import { refreshSpendInBackground } from "./spend-refresh.ts";

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

/** The cycle's spend line, from the cache; empty when there is none. */
function cycleLine(): string {
  refreshSpendInBackground(VAULT); // detached; this run prints the cache as it is
  try {
    const line = spendLine(
      readJSON(join(VAULT, "cache", "cycle-spend.json")),
      new Date().toISOString().slice(0, 10),
    );
    return line ? ` Cycle: ${line}.` : "";
  } catch {
    return "";
  }
}

/** The one zenborg line: the intention, then the cycle. */
function say(body: string): never {
  process.stdout.write(`<zenborg-intention: ${body}${cycleLine()}>`);
  process.exit(0);
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
  const momentsMap = readJSON(join(VAULT, "moments.json")) as Record<
    string,
    Moment
  >;
  const areasMap = readJSON(join(VAULT, "areas.json")) as Record<string, Area>;
  const phaseCfgsMap = readJSON(join(VAULT, "phaseConfigs.json")) as Record<
    string,
    PhaseConfig
  >;

  const phases = Object.values(phaseCfgsMap);
  const phase = currentPhase(phases);
  if (!phase) {
    const line = cycleLine();
    if (line) process.stdout.write(`<zenborg-intention:${line}>`);
    silent();
  }

  const today = wakingDayKey();
  const phaseMoments = Object.values(momentsMap).filter(
    (m) => m.day?.startsWith(today) && m.phase === phase!.phase,
  );

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
      const areaLabel = area
        ? ` (${area.emoji ?? ""} ${area.name})`.trim()
        : "";
      const phaseChanged = active.phase && active.phase !== phase!.phase;
      const stale = ago > 120;

      if (phaseChanged || stale) {
        const why = phaseChanged
          ? `phase changed (was ${active.phase}, now ${phase!.label})`
          : `set ${ago}m ago`;
        say(`stale active "${active.name}"${areaLabel}: ${why}.`);
      } else {
        say(
          `active "${active.name}"${areaLabel}, ` +
            `set ${ago}m ago. Phase: ${phase!.label}. ` +
            `Clear on /close-up or when the gardener switches.`,
        );
      }
    }
  }

  // ── No active moment → the facts. The gardener picks in the moment band.
  const planted = phaseMoments
    .map((m) => {
      const area = m.areaId ? areasMap[m.areaId] : null;
      return `"${m.name}"${area ? ` (${area.name})` : ""}`;
    })
    .join(", ");
  say(
    `${released}No active intention. ` +
      `Phase: ${phase!.label} (${phase!.startHour}:00–${phase!.endHour}:00). ` +
      (planted
        ? `Planted this phase: ${planted}.`
        : "Nothing planted this phase."),
  );
}

main().catch(() => process.exit(0));
