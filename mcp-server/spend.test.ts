import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Allocation } from "../src/domain/entities/Allocation.ts";
import { getCycleSpend, spendCachePath, writeSpendCache } from "./spend.js";

const P = "https://linear.app/themia-sas/project/rente";
const alloc = (
  id: string,
  link: string,
  kind: "bet" | "lane" = "bet",
  name = id,
): Allocation => ({
  id,
  kind,
  name,
  area: "x",
  link,
  appetiteDays: 1,
  aim: kind === "lane" ? "aim" : undefined,
});
const table = [
  alloc("rente", P),
  alloc("bugs", "https://linear.app/x/ops", "lane", "Bugs & ops"),
];

const T0 = Date.parse("2026-10-27T08:00:00Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const line = (o: object) => JSON.stringify(o);
const userRec = (min: number, text: unknown, extra: object = {}) =>
  line({
    type: "user",
    timestamp: iso(min),
    entrypoint: "cli",
    message: { content: text },
    ...extra,
  });
const asstRec = (min: number, extra: object = {}) =>
  line({ type: "assistant", timestamp: iso(min), entrypoint: "cli", ...extra });

let tmp: string;
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function fixture() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spend-"));
  const projects = path.join(tmp, ".claude", "projects");
  const vault = path.join(tmp, "vault");
  fs.mkdirSync(path.join(vault, "cache"), { recursive: true });
  const put = (dir: string, id: string, lines: string[]) => {
    fs.mkdirSync(path.join(projects, dir), { recursive: true });
    fs.writeFileSync(path.join(projects, dir, `${id}.jsonl`), lines.join("\n"));
  };
  fs.writeFileSync(
    path.join(vault, "cache", "linear-join.json"),
    JSON.stringify({
      issues: {
        "DEV-1": { project: { url: P } },
        "DEV-7": { labels: ["Bug"] },
      },
      prs: { "https://github.com/o/r/pull/9": "dev-7-fix" },
    }),
  );
  // A: workspace-root session (HEAD), only a PR link says which issue. Minutes 0..4.
  put("-w", "a", [
    userRec(0, "go"),
    line({
      type: "pr-link",
      prUrl: "https://github.com/o/r/pull/9",
      timestamp: iso(1),
    }),
    asstRec(1, { gitBranch: "HEAD" }),
    asstRec(2),
    asstRec(3),
    asstRec(4),
  ]);
  // B: parallel, same minutes; a typed issue id; MEMORY.md reminder mentions DEV-7 (must be ignored).
  put("-w", "b", [
    userRec(0, [
      {
        type: "text",
        text: "<system-reminder>MEMORY DEV-7</system-reminder>Fix DEV-1 now",
      },
    ]),
    asstRec(1),
    asstRec(2),
    asstRec(3),
    asstRec(4),
    // headless run: dropped
    line({ type: "assistant", timestamp: iso(500), entrypoint: "sdk-cli" }),
    // tool result: not a turn
    userRec(4, [{ type: "tool_result", content: "DEV-7" }]),
  ]);
  // C: no evidence, cwd nowhere. Minutes 10..12 (own time). Subagent file beside it.
  put("-w", "c", [userRec(10, "hello", { cwd: "/nowhere" }), asstRec(12)]);
  fs.mkdirSync(path.join(projects, "-w", "c", "subagents"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(projects, "-w", "c", "subagents", "x.jsonl"),
    [
      asstRec(10, { isSidechain: true }),
      asstRec(13, { isSidechain: true }),
    ].join("\n"),
  );
  return { projects, vault };
}

describe("getCycleSpend on transcripts", () => {
  it("merges parallel sessions, attributes by PR/typed id, ignores reminders, keeps agents apart", () => {
    const { projects, vault } = fixture();
    const r = getCycleSpend(
      vault,
      table,
      { from: "2026-10-27", to: "2026-10-27" },
      { projectsDir: projects, home: tmp },
    );
    // A and B share minutes 0..4 -> 4 min once; gap 4->10 capped 5; 10->12 2 min => 11 min
    expect(r.totalHours).toBeCloseTo(11 / 60, 1);
    const day = Object.values(r.days)[0];
    expect(day.turns).toBe(3); // go, Fix DEV-1 now, hello. Not the tool result.
    const bugs = r.allocations.find((a) => a.id === "bugs")!;
    const rente = r.allocations.find((a) => a.id === "rente")!;
    expect(bugs.turns).toBe(1); // A: pr-link -> dev-7 -> Bug
    expect(rente.turns).toBe(1); // B: typed DEV-1 (the reminder's DEV-7 ignored)
    expect(r.unattributed.turns).toBe(1);
    expect(r.agentHours).toBeCloseTo(0.1, 1); // 10->13 = 3 min of agent time
    expect(r.linearJoin).toMatch(/^loaded/);
  });

  it("reports a missing join instead of pretending", () => {
    const { projects, vault } = fixture();
    fs.rmSync(path.join(vault, "cache", "linear-join.json"));
    const r = getCycleSpend(
      vault,
      table,
      { from: "2026-10-27", to: "2026-10-27" },
      { projectsDir: projects, home: tmp },
    );
    expect(r.linearJoin).toMatch(/^missing/);
    expect(r.allocations.every((a) => a.hours === 0)).toBe(true);
    expect(r.unattributed.pct).toBe(100);
  });

  it("caches the result where hooks read it", () => {
    const { projects, vault } = fixture();
    const r = getCycleSpend(
      vault,
      table,
      { from: "2026-10-27", to: "2026-10-27" },
      { projectsDir: projects, home: tmp },
    );
    writeSpendCache(vault, "cyc", r);
    const cached = JSON.parse(fs.readFileSync(spendCachePath(vault), "utf8"));
    expect(cached.cycleId).toBe("cyc");
    expect(cached.allocations).toHaveLength(2);
  });
});
