import { describe, expect, it } from "vitest";
import type { Allocation } from "../../entities/Allocation";
import {
  attribute,
  computeSpend,
  dayOf,
  dayStartMs,
  type LinearJoin,
  type SessionFacts,
} from "../CycleSpend";

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
  appetiteDays: 5,
  aim: kind === "lane" ? "aim" : undefined,
});
const rente = alloc("rente", P);
const bugs = alloc(
  "bugs",
  "https://linear.app/themia-sas/project/ops",
  "lane",
  "Bugs & ops",
);
const zen = alloc("zen", "/Users/me/Developer/equanimitech/zenborg");
const table = [rente, bugs, zen];

const join: LinearJoin = {
  issues: {
    "DEV-1": { project: { url: P } },
    "DEV-2": { project: { url: P }, labels: ["Bug"] },
    "DEV-3": { title: "Run: backfill X", project: { url: P } },
  },
  prs: { "https://github.com/o/r/pull/9": "dev-1-feature" },
};

const MIN = 60_000;
const T0 = Date.parse("2026-10-27T08:00:00Z");
const at = (...mins: number[]) => mins.map((m) => T0 + m * MIN);
const session = (o: Partial<SessionFacts>): SessionFacts => ({
  id: "s",
  prUrls: [],
  turns: [],
  main: [],
  agent: [],
  ...o,
});
const W = { fromMs: T0 - 3600_000, toMs: T0 + 24 * 3600_000 };

describe("merged hours", () => {
  it("does not double-count parallel sessions", () => {
    // Both sessions active minutes 0..4 (one record a minute): merged = 4 min, not 8.
    const a = session({ id: "a", branch: "dev-1-x", main: at(0, 1, 2, 3, 4) });
    const b = session({ id: "b", branch: "dev-1-y", main: at(0, 1, 2, 3, 4) });
    const spend = computeSpend([a, b], table, join, W);
    expect(spend.totalHours * 60).toBeCloseTo(4);
    expect(spend.days[dayOf(T0)].hours * 60).toBeCloseTo(4);
  });

  it("caps a gap at 5 minutes", () => {
    const s = session({ branch: "dev-1-x", main: at(0, 60) });
    expect(computeSpend([s], table, join, W).totalHours * 60).toBeCloseTo(5);
  });

  it("charges interleaved sessions to whoever acts next, totals unchanged", () => {
    const a = session({ id: "a", branch: "dev-1-x", main: at(0, 2, 4) });
    const b = session({
      id: "b",
      cwd: "/Users/me/Developer/equanimitech/zenborg",
      main: at(1, 3),
    });
    const r = computeSpend([a, b], table, join, W, "/Users/me");
    expect(r.totalHours * 60).toBeCloseTo(4);
    // gaps: 0->1 b, 1->2 a, 2->3 b, 3->4 a
    expect(r.allocations.find((x) => x.id === "rente")!.hours * 60).toBeCloseTo(
      2,
    );
    expect(r.allocations.find((x) => x.id === "zen")!.hours * 60).toBeCloseTo(
      2,
    );
    expect(r.unattributed.hours).toBe(0);
  });

  it("reports unattributed share, agent hours apart, turns", () => {
    const s = session({
      main: at(0, 1, 2, 3),
      agent: [at(0, 10)],
      turns: [{ ts: at(0)[0], text: "hello" }],
    });
    const r = computeSpend([s], table, join, W);
    expect(r.unattributed.pct).toBe(100);
    expect(r.totalHours * 60).toBeCloseTo(3);
    expect(r.agentHours * 60).toBeCloseTo(5); // capped, not charged
    expect(r.turns).toBe(1);
  });

  it("keeps only records inside the window", () => {
    const s = session({ main: at(0, 1, 2) });
    const r = computeSpend([s], table, join, {
      fromMs: T0 + MIN,
      toMs: T0 + 10 * MIN,
    });
    expect(r.totalHours * 60).toBeCloseTo(1);
  });

  it("turns the day over at 03:00 Paris", () => {
    expect(dayOf(Date.parse("2026-10-27T01:30:00Z"))).toBe("2026-10-26"); // 02:30 Paris
    expect(dayOf(Date.parse("2026-10-27T02:30:00Z"))).toBe("2026-10-27"); // 03:30 Paris
    expect(dayStartMs("2026-10-27")).toBe(Date.parse("2026-10-27T02:00:00Z")); // CET
    expect(dayStartMs("2026-10-20")).toBe(Date.parse("2026-10-20T01:00:00Z")); // CEST until the 25th
  });
});

describe("attribution", () => {
  const a = (s: Partial<SessionFacts>) =>
    attribute(session(s), table, join, "/Users/me");

  it("branch dev-NNNN -> issue -> project -> allocation", () => {
    expect(a({ branch: "dev-1-add-thing" })).toBe("rente");
  });
  it("PR link -> head branch via the join (workspace-root sessions)", () => {
    expect(
      a({ branch: "HEAD", prUrls: ["https://github.com/o/r/pull/9"] }),
    ).toBe("rente");
  });
  it("issue id typed in a user turn", () => {
    expect(a({ turns: [{ ts: 0, text: "continue DEV-1 please" }] })).toBe(
      "rente",
    );
  });
  it("Bug label and Run: titles go to Bugs & ops, even inside a project", () => {
    expect(a({ branch: "dev-2-x" })).toBe("bugs");
    expect(a({ turns: [{ ts: 0, text: "DEV-3" }] })).toBe("bugs");
  });
  it("an issue named in a lane's aim goes to that lane, not Bugs & ops", () => {
    const trust = {
      ...alloc("trust", "https://linear.app/themia-sas/project/trust", "lane"),
      aim: "run verified + write bugs closed (dev-2653, DEV-95)",
    };
    const j: LinearJoin = {
      ...join,
      issues: {
        ...join.issues,
        "DEV-2653": { labels: ["Bug"] },
        "DEV-955": { labels: ["Backfill"] },
        "DEV-77": { labels: ["Bug"] },
      },
    };
    const t = [rente, bugs, trust];
    const of = (b: string) =>
      attribute(session({ branch: b }), t, j, "/Users/me");
    expect(of("dev-2653-x")).toBe("trust");
    expect(of("dev-77-x")).toBe("bugs"); // named in no aim
    expect(of("dev-955-x")).toBe("bugs"); // DEV-95 must not capture DEV-955
  });
  it("ignores issue ids that are not user turns (MEMORY.md trap) and P-DEV ids", () => {
    // facts only carry user turns; a reminder-laden turn is stripped by the reader.
    expect(a({ turns: [{ ts: 0, text: "see P-DEV-1" }] })).toBeNull();
    expect(a({})).toBeNull();
  });
  it("unknown issue stays unattributed, never Bugs & ops", () => {
    expect(a({ branch: "dev-999-x" })).toBeNull();
  });
  it("cwd under a repo link, worktrees included", () => {
    expect(a({ cwd: "/Users/me/Developer/equanimitech/zenborg/src" })).toBe(
      "zen",
    );
    expect(
      a({
        cwd: "/Users/me/Developer/equanimitech/zenborg/.claude/worktrees/x",
      }),
    ).toBe("zen");
    expect(a({ cwd: "/Users/me/Developer/equanimitech/other" })).toBeNull();
  });
  it("cwd at a repo holding exactly one pitch matches it; two is ambiguous", () => {
    const pitch = alloc("p1", "~/Developer/equanimitech/docs/pitches/x.md");
    const pitch2 = alloc("p2", "~/Developer/equanimitech/docs/pitches/y.md");
    const cwd = "/Users/me/Developer/equanimitech/docs";
    expect(attribute(session({ cwd }), [pitch], join, "/Users/me")).toBe("p1");
    expect(
      attribute(session({ cwd }), [pitch, pitch2], join, "/Users/me"),
    ).toBeNull();
  });
  const Z = "/Users/me/Developer/equanimitech/zenborg";
  it("subagent working in a zenborg worktree moves the parent to zen", () => {
    expect(
      a({
        cwd: "/Users/me/Developer/themia",
        subagents: [[`${Z}/.claude/worktrees/x/src/a.ts`]],
      }),
    ).toBe("zen");
  });
  it("main-loop tool paths vote weakly and are capped", () => {
    const many = Array(50).fill(`${Z}/src/a.ts`);
    expect(a({ paths: many })).toBe("zen");
    // cap: 50 tool paths = 3 votes, so one branch (3) + a typed issue (1) beats them
    expect(
      a({ paths: many, branch: "dev-1-x", turns: [{ ts: 0, text: "DEV-1" }] }),
    ).toBe("rente");
  });
  it("typed paths under a link: absolute, ~/ and trailing segments", () => {
    for (const text of [
      `look at ${Z}/src/x.ts`,
      "look at ~/Developer/equanimitech/zenborg/src/x.ts",
      "see equanimitech/zenborg/docs/a.md",
      "see zenborg/src/domain",
    ])
      expect(a({ turns: [{ ts: 0, text }] })).toBe("zen");
    expect(
      a({ turns: [{ ts: 0, text: "see zenborgish/src or other/zenborg2/x" }] }),
    ).toBeNull();
  });
  it("evidence beats cwd", () => {
    expect(
      a({ cwd: "/Users/me/Developer/equanimitech/zenborg", branch: "dev-1-x" }),
    ).toBe("rente");
  });
});
