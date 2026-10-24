import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleSpec } from "../src/domain/intervention/RuleSpec.ts";
import { browserGateRule } from "../src/domain/intervention/rules/browserGate.ts";
import { browserTransformRule } from "../src/domain/intervention/rules/browserTransform.ts";
import { sessionFenceRule } from "../src/domain/intervention/rules/sessionFence.ts";
import { wateringHoursRules } from "../src/domain/intervention/rules/wateringHours.ts";
import { readActivityLog } from "./activity-log.js";
import { browserFenceReport, conciseBrowserFences } from "./browser-fences.js";

const serves = { cycleId: "c", areaId: "a" };
const click = {
  type: "click" as const,
  selectors: { primary: "button.new-game" },
};

const ladder = browserGateRule({
  id: "chess-ladder",
  host: "chess.com",
  name: "chess ladder",
  description: "",
  serves,
  returnsTo: ["a"],
  rungs: [
    { trigger: click, friction: { type: "intention", prompt: "Another?" } },
    { trigger: click, friction: { type: "delay", seconds: 15 } },
    { trigger: click, friction: { type: "breath", cycles: 3 } },
  ],
});

const pausedGate: RuleSpec = {
  ...browserGateRule({
    id: "yt-gate",
    host: "youtube.com",
    name: "yt",
    description: "",
    serves,
    returnsTo: ["a"],
    rungs: [
      {
        trigger: { type: "dwell", everyMinutes: 20 },
        friction: { type: "intention", prompt: "Still it?" },
      },
    ],
  }),
  defaultEnabled: false,
};

const watering = wateringHoursRules({
  policyName: "chess-afternoon",
  mode: "dry",
  window: { fromHour: 16, toHour: 13 },
  serves,
  returnsTo: ["a"],
  restricts: { hosts: ["chess.com", "lichess.org"] },
  unlockNote: "afternoon",
  reach: "navigation",
});

const transform = browserTransformRule({
  id: "yt-home",
  host: "youtube.com",
  name: "No home feed",
  description: "",
  serves,
  returnsTo: ["a"],
  targets: { primary: "ytd-rich-grid-renderer" },
});

const session = sessionFenceRule({
  id: "s",
  label: "Themia",
  description: "",
  serves,
  paths: ["/x"],
  encloses: ["a"],
});

const FENCES: Record<string, RuleSpec> = Object.fromEntries(
  [ladder, pausedGate, ...watering, transform, session].map((r) => [r.id, r]),
);

/** Today's browser log, with every line written twice as the real one is. */
function fixtureLog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-log-"));
  const start = new Date();
  start.setHours(9, 0, 0, 0);
  const t = start.getTime();
  const day = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  const point = (id: string, ts: number, delivered: boolean) => ({
    id,
    kind: "decision_point",
    surface: "browser",
    sessionId: "s",
    ts,
    payload: {
      ruleId: "chess-ladder",
      domain: "chess.com",
      trigger: "click",
      delivered,
      p: 0.7,
      draw: 0.5,
      windowMs: 600_000,
    },
  });
  const answer = (id: string, ts: number, kind: string) => ({
    id,
    kind,
    surface: "browser",
    sessionId: "s",
    ts,
    payload: { domain: "chess.com", primitive: "gate", ruleId: "chess-ladder" },
  });
  const events = [
    point("p1", t, true),
    answer("c1", t + 1000, "intervention_clicked_through"),
    point("p2", t + 60_000, true),
    answer("d1", t + 61_000, "intervention_dismissed"),
    point("p3", t + 120_000, false),
  ];
  const lines = events.flatMap((e) => [JSON.stringify(e), JSON.stringify(e)]);
  fs.writeFileSync(
    path.join(dir, `${day}.browser.jsonl`),
    `${lines.join("\n")}\n`,
  );
  return dir;
}

describe("browserFenceReport", () => {
  const dir = fixtureLog();
  const now = Date.now() + 24 * 60 * 60_000;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const events = readActivityLog(dir, midnight.getTime(), now, ["browser"]);
  const report = browserFenceReport(FENCES, events);
  const byId = Object.fromEntries(report.map((l) => [l.id, l]));

  it("lists browser rules only, each with kind, state, hosts and rungs", () => {
    expect(report.map((l) => l.id).sort()).toEqual(
      [
        "chess-ladder",
        "yt-gate",
        "watering:chess-afternoon:browser:chess.com",
        "watering:chess-afternoon:browser:lichess.org",
        "yt-home",
      ].sort(),
    );
    expect(byId["chess-ladder"]).toMatchObject({
      kind: "ladder",
      state: "enabled",
      hosts: ["chess.com"],
      rungs: ["click → question", "click → delay 15s", "click → breath ×3"],
    });
    expect(byId["yt-gate"]).toMatchObject({
      kind: "gate",
      state: "paused",
      rungs: ["dwell 20m → question"],
    });
    expect(byId["yt-home"]).toMatchObject({ kind: "transform" });
    expect(byId["watering:chess-afternoon:browser:chess.com"]).toMatchObject({
      kind: "block",
      schedule: "16→13",
      reach: "navigation",
    });
  });

  it("counts today's decision points and answers once each, despite doubled lines", () => {
    expect(byId["chess-ladder"].today).toEqual({
      delivered: 2,
      withheld: 1,
      clickedThrough: 1,
      dismissed: 1,
    });
    expect(byId["yt-home"].today).toEqual({
      delivered: 0,
      withheld: 0,
      clickedThrough: 0,
      dismissed: 0,
    });
  });

  it("concise groups a watering policy's hosts and drops zero counts", () => {
    const concise = conciseBrowserFences(report) as Record<string, unknown>[];
    const policy = concise.find((l) => l.policy === "chess-afternoon");
    expect(policy).toMatchObject({
      id: "watering:chess-afternoon:browser:*",
      hosts: ["chess.com", "lichess.org"],
    });
    expect(concise).toHaveLength(4);
    expect(concise.find((l) => l.id === "yt-home")).not.toHaveProperty("today");
    expect(concise.find((l) => l.id === "chess-ladder")?.today).toEqual({
      delivered: 2,
      withheld: 1,
      clickedThrough: 1,
      dismissed: 1,
    });
  });
});
