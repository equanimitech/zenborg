import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionFenceRule } from "../src/domain/intervention/rules/sessionFence.ts";
import {
  expandHome,
  fencesPath,
  fencesStatePath,
  readCrossingTally,
  readFenceRecords,
  readFencesFile,
  readOpenings,
  readPassAllowance,
  removeOpening,
  writeFencesFile,
  writeOpening,
  writePassAllowance,
} from "./fences.js";
import { buildOpening } from "../src/domain/intervention/Opening.ts";
// The extension's own reader, so the record shape cannot drift between the two.
import { parseFences } from "../extension/modules/fence/parse.ts";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-fences-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const fence = sessionFenceRule({
  id: "rule-1",
  label: "Themia data",
  description: "only Themia data this afternoon",
  serves: { cycleId: "cycle-1", areaId: "area-themia" },
  paths: ["/Users/rafa/Developer/themia"],
  encloses: ["area-themia"],
});

describe("fences collection I/O", () => {
  it("round-trips records keyed by id", () => {
    writeFencesFile(root, { "rule-1": fence });
    expect(readFencesFile(root)).toEqual({ "rule-1": fence });
  });

  it("an absent or empty file is an empty collection, not an error", () => {
    expect(readFencesFile(root)).toEqual({});
    fs.writeFileSync(fencesPath(root), "  \n");
    expect(readFencesFile(root)).toEqual({});
  });

  it("throws on malformed JSON — the writer must not fail soft to {} and clobber", () => {
    fs.writeFileSync(fencesPath(root), "{ not json");
    expect(() => readFencesFile(root)).toThrow(
      /Malformed JSON in fences\.json/,
    );
  });

  it("leaves no temp files behind — the write is rename-atomic", () => {
    writeFencesFile(root, { "rule-1": fence });
    expect(fs.readdirSync(root)).toEqual(["fences.json"]);
  });

  it("creates the vault root if it does not exist yet", () => {
    const fresh = path.join(root, "nested", "vault");
    writeFencesFile(fresh, {});
    expect(readFencesFile(fresh)).toEqual({});
  });
});

describe("openings and the pass allowance in fences.json", () => {
  // Local wall-clock: "20:00 to 01:00" is the window whatever the zone.
  const now = new Date(2026, 9, 24, 17, 0);
  const plan = () => {
    const built = buildOpening(
      { hosts: ["youtube.com"], from: "20:00", until: "01:00", reason: "friends over" },
      now,
    );
    if (!("record" in built)) throw new Error(built.problems.join("; "));
    return built.record;
  };

  it("set_opening writes a record the extension's parseFences reads as that window", () => {
    writeOpening(root, plan(), now);
    const parsed = parseFences(readFenceRecords(root), now.getTime());
    expect(parsed?.refused).toEqual([]);
    expect(parsed?.openings).toHaveLength(1);
    expect(parsed?.openings[0]).toMatchObject({
      hosts: ["youtube.com"],
      from: new Date(2026, 9, 24, 20, 0).getTime(),
      until: new Date(2026, 9, 25, 1, 0).getTime(),
      reason: "friends over",
    });
  });

  it("rule readers never meet an opening, and rule writes carry it through", () => {
    writeFencesFile(root, { "rule-1": fence });
    writeOpening(root, plan(), now);
    writePassAllowance(root, { id: "pass-allowance", kind: "pass-allowance", perMonth: 2, hours: 1 });
    expect(readFencesFile(root)).toEqual({ "rule-1": fence });
    writeFencesFile(root, {}); // clear_fence { all }
    expect(readOpenings(root, now).map((o) => o.reason)).toEqual(["friends over"]);
    expect(readPassAllowance(root)).toMatchObject({ perMonth: 2, hours: 1 });
  });

  it("clears one opening early, and drops expired ones on the next write", () => {
    const first = plan();
    writeOpening(root, first, now);
    expect(removeOpening(root, first.id)?.id).toBe(first.id);
    expect(removeOpening(root, first.id)).toBeNull();
    writeOpening(root, first, now);
    const later = new Date(2026, 9, 26, 12, 0);
    expect(readOpenings(root, later)).toEqual([]);
    const next = buildOpening(
      { hosts: ["chess.com"], from: "20:00", until: "22:00", reason: "a match" },
      later,
    );
    if (!("record" in next)) throw new Error("bad");
    writeOpening(root, next.record, later);
    expect(Object.keys(readFenceRecords(root))).toEqual([next.record.id]);
  });
});

describe("crossing tally (plugin-owned, read-only, fail-soft)", () => {
  function writeState(value: unknown): void {
    const file = fencesStatePath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }

  it("reads what the hook writes", () => {
    writeState({ "rule-1": { crossings: 2, at: 1_700_000_000_000 } });
    expect(readCrossingTally(root)).toEqual({
      "rule-1": { crossings: 2, at: 1_700_000_000_000 },
    });
  });

  it("an absent tally is no crossings, never an error", () => {
    expect(readCrossingTally(root)).toEqual({});
  });

  it("garbled state means no crossings — a reader must not throw on someone else's file", () => {
    fs.mkdirSync(path.dirname(fencesStatePath(root)), { recursive: true });
    fs.writeFileSync(fencesStatePath(root), "{ nope");
    expect(readCrossingTally(root)).toEqual({});
  });

  it("drops entries without a usable count instead of coercing them", () => {
    writeState({
      good: { crossings: 1, at: 5 },
      bad: { crossings: "many" },
      negative: { crossings: -2, at: 5 },
    });
    expect(readCrossingTally(root)).toEqual({ good: { crossings: 1, at: 5 } });
  });
});

describe("expandHome", () => {
  it("expands a leading ~ to the home directory", () => {
    expect(expandHome("~/Developer/themia")).toBe(
      path.join(os.homedir(), "Developer/themia"),
    );
  });

  it("leaves absolute paths and interior tildes alone", () => {
    expect(expandHome("/w/themia")).toBe("/w/themia");
    expect(expandHome("/w/~backup")).toBe("/w/~backup");
  });
});
