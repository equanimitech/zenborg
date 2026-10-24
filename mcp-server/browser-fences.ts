/**
 * get_fence, browser side: what each browser rule is and what it did today.
 *
 * Pure over the fence records and the day's browser events, so the handler
 * only does I/O. Counts come from the extension's own log: `decision_point`
 * (delivered or withheld by the rule's draw), and the two answers a shown
 * gate can get. The log writes some lines twice; events dedupe by id.
 */
import type { ActivityEvent } from "../src/domain/attention/ActivityEvent.ts";
import { decisionPointsOf } from "../src/domain/intervention/browserEfficacy.ts";
import type {
  GateSpec,
  Primitive,
} from "../src/domain/intervention/Primitive.ts";
import type { RuleSpec } from "../src/domain/intervention/RuleSpec.ts";

export type BrowserFenceKind = "block" | "gate" | "ladder" | "transform";

export interface BrowserFenceToday {
  readonly delivered: number;
  readonly withheld: number;
  readonly clickedThrough: number;
  readonly dismissed: number;
}

export interface BrowserFenceLine {
  readonly id: string;
  readonly name: string;
  readonly state: "enabled" | "paused";
  readonly kind: BrowserFenceKind | "other";
  readonly hosts: readonly string[];
  /** One per rung: `trigger → friction`. Gates and ladders only. */
  readonly rungs?: readonly string[];
  /** `from→to` local hours (restricted inside; wraps when to <= from), plus weekdays. */
  readonly schedule?: string;
  /** Blocks only: `all` / `navigation` in the browser, else where it is enforced. */
  readonly reach?: string;
  readonly today: BrowserFenceToday;
}

const unwrap = (p: Primitive): Primitive =>
  p.kind === "schedule" ? p.wraps : p;

function rungLine(g: GateSpec): string {
  const t = g.trigger;
  const f = g.frictionType;
  const trigger = t.type === "dwell" ? `dwell ${t.everyMinutes}m` : t.type;
  const friction =
    f.type === "delay"
      ? `delay ${f.seconds}s`
      : f.type === "breath"
        ? `breath ×${f.cycles}`
        : f.type === "intention"
          ? "question"
          : "confirm";
  return `${trigger} → ${friction}`;
}

function describe(rule: RuleSpec): Omit<BrowserFenceLine, "today"> {
  const first = rule.primitives[0];
  const inner = first ? unwrap(first) : undefined;
  const gates = rule.primitives
    .map(unwrap)
    .filter((p): p is GateSpec => p.kind === "gate");
  const scope = rule.scope as { domain: string | readonly string[] };
  const kind: BrowserFenceLine["kind"] =
    inner?.kind === "cooldown"
      ? "block"
      : inner?.kind === "transform"
        ? "transform"
        : inner?.kind === "gate"
          ? gates.length > 1
            ? "ladder"
            : "gate"
          : "other";
  const window = first?.kind === "schedule" ? first.window : undefined;
  return {
    id: rule.id,
    name: rule.name,
    state: rule.defaultEnabled === false ? "paused" : "enabled",
    kind,
    hosts:
      typeof scope.domain === "string" ? [scope.domain] : [...scope.domain],
    ...(gates.length > 0 ? { rungs: gates.map(rungLine) } : {}),
    ...(window
      ? {
          schedule: `${window.fromHour}→${window.toHour}${
            window.weekdays?.length ? ` ${window.weekdays.join(",")}` : ""
          }`,
        }
      : {}),
    ...(inner?.kind === "cooldown"
      ? {
          reach:
            (inner.enforcement?.at ?? "browser") === "browser"
              ? ((inner.enforcement as { reach?: string } | undefined)?.reach ??
                "all")
              : (inner.enforcement?.at as string),
        }
      : {}),
  };
}

export function browserFenceReport(
  fences: Readonly<Record<string, RuleSpec>>,
  events: readonly ActivityEvent[],
): BrowserFenceLine[] {
  const today = new Map<string, BrowserFenceToday>();
  const bump = (ruleId: string, key: keyof BrowserFenceToday) => {
    const t = today.get(ruleId) ?? {
      delivered: 0,
      withheld: 0,
      clickedThrough: 0,
      dismissed: 0,
    };
    today.set(ruleId, { ...t, [key]: t[key] + 1 });
  };

  for (const point of decisionPointsOf(events)) {
    bump(point.ruleId, point.delivered ? "delivered" : "withheld");
  }
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const ruleId = e.payload.ruleId;
    if (typeof ruleId !== "string") continue;
    if (e.kind === "intervention_clicked_through")
      bump(ruleId, "clickedThrough");
    if (e.kind === "intervention_dismissed") bump(ruleId, "dismissed");
  }

  return Object.values(fences)
    .filter((rule) => rule.scope.surface === "browser")
    .map((rule) => ({
      ...describe(rule),
      today: today.get(rule.id) ?? {
        delivered: 0,
        withheld: 0,
        clickedThrough: 0,
        dismissed: 0,
      },
    }));
}

/**
 * Concise: a watering policy's per-host browser rules collapse into one line
 * (they are one declaration), zero counts drop, and `today` goes when empty.
 */
export function conciseBrowserFences(
  lines: readonly BrowserFenceLine[],
): unknown[] {
  const out: Record<string, unknown>[] = [];
  const policies = new Map<string, Record<string, unknown>>();
  for (const line of lines) {
    const counts = Object.fromEntries(
      Object.entries(line.today).filter(([, n]) => n > 0),
    );
    const policy = /^watering:([^:]+):browser:/.exec(line.id)?.[1];
    const key = policy && `${policy}|${line.state}`;
    const grouped = key ? policies.get(key) : undefined;
    if (grouped) {
      (grouped.hosts as string[]).push(...line.hosts);
      const sum = { ...(grouped.today as Record<string, number> | undefined) };
      for (const [k, n] of Object.entries(counts)) sum[k] = (sum[k] ?? 0) + n;
      if (Object.keys(sum).length > 0) grouped.today = sum;
      continue;
    }
    const { today: _t, ...rest } = line;
    const entry: Record<string, unknown> = {
      ...rest,
      hosts: [...line.hosts],
      ...(policy ? { id: `watering:${policy}:browser:*`, policy } : {}),
      ...(Object.keys(counts).length > 0 ? { today: counts } : {}),
    };
    if (key) policies.set(key, entry);
    out.push(entry);
  }
  return out;
}
