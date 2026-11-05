import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { wakingDayKey } from "../src/domain/attention/ActiveMoment.ts";
import {
  reflect,
  reflectionLine,
  runGateCommand,
  switchMoment,
  withReflection,
} from "./intention-gate.ts";
import { activeMomentPath, readActiveMoment, writeActiveMoment } from "./vault.ts";

const NOW = new Date(2026, 9, 31, 21, 0);
const TODAY = wakingDayKey(NOW);

function vault(moments: Record<string, unknown>, notes: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-gate-"));
  fs.writeFileSync(path.join(root, "moments.json"), JSON.stringify(moments));
  fs.writeFileSync(path.join(root, "dayNotes.json"), JSON.stringify(notes));
  return root;
}
const m = (id: string, name: string, day = TODAY) => ({ id, name, day });
const rawPointer = (root: string) =>
  JSON.parse(fs.readFileSync(activeMomentPath(root), "utf8"));

describe("activeMoment.json round trip", () => {
  it("an old pointer without the new fields still reads", () => {
    const root = vault({});
    fs.writeFileSync(activeMomentPath(root), JSON.stringify({ momentId: "a", at: NOW.toISOString() }));
    expect(readActiveMoment(root)?.momentId).toBe("a");
  });

  it("a timed switch writes until + returnTo, keeps unknown fields, and returns on expiry", () => {
    const root = vault({ work: m("work", "Themia"), yt: m("yt", "YouTube") });
    const before = new Date(NOW.getTime() - 3_600_000).toISOString();
    fs.writeFileSync(activeMomentPath(root), JSON.stringify({ momentId: "work", at: before, future: "kept" }));

    const r = switchMoment(root, "yt", 30, NOW);
    expect(r.ok).toBe(true);
    const raw = rawPointer(root);
    expect(raw).toMatchObject({
      momentId: "yt",
      future: "kept",
      returnTo: { momentId: "work", at: before },
      until: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    });
    expect(readActiveMoment(root, NOW.getTime() + 29 * 60_000)?.momentId).toBe("yt");
    expect(readActiveMoment(root, NOW.getTime() + 30 * 60_000)?.momentId).toBe("work");
  });

  it("a plain set drops a previous timer", () => {
    const root = vault({ yt: m("yt", "YouTube") });
    switchMoment(root, "yt", 15, NOW);
    writeActiveMoment(root, "yt", NOW.toISOString());
    expect(rawPointer(root)).toEqual({ momentId: "yt", at: NOW.toISOString() });
  });

  it("refuses a moment that is not on today's board, or a silly duration", () => {
    const root = vault({ old: m("old", "Chess", "2026-10-01"), yt: m("yt", "YouTube") });
    expect(switchMoment(root, "old", 15, NOW).ok).toBe(false);
    expect(switchMoment(root, "yt", 0, NOW).ok).toBe(false);
    expect(switchMoment(root, "yt", 999, NOW).ok).toBe(false);
    expect(fs.existsSync(activeMomentPath(root))).toBe(false);
  });
});

describe("reflection", () => {
  it("appends to an existing day note body", () => {
    const notes = { [TODAY]: { date: TODAY, title: "Rest", body: "slow day", createdAt: "x", updatedAt: "x" } };
    const root = vault({ yt: m("yt", "YouTube") }, notes);
    expect(reflect(root, "yt", "a good talk", "chess lecture", NOW).ok).toBe(true);
    const stored = JSON.parse(fs.readFileSync(path.join(root, "dayNotes.json"), "utf8"));
    expect(stored[TODAY].title).toBe("Rest");
    expect(stored[TODAY].body).toBe("slow day\n- YouTube · chess lecture — a good talk");
  });

  it("creates a note titled with the weekday when the day has none", () => {
    const next = withReflection({}, "2026-10-31", "- YouTube — fun", "t");
    expect(next["2026-10-31"]).toMatchObject({ title: "Saturday", body: "- YouTube — fun" });
  });

  it("does not repeat the intention when it is just the moment's name", () => {
    expect(reflectionLine("YouTube", "YouTube", "ok")).toBe("- YouTube — ok");
  });

  it("refuses an empty reflection", () => {
    expect(reflect(vault({ yt: m("yt", "YouTube") }), "yt", "  ", "", NOW).ok).toBe(false);
  });
});

describe("runGateCommand", () => {
  it("ignores argv that is not a gate command", () => {
    expect(runGateCommand("/nowhere", [])).toBeNull();
    expect(runGateCommand("/nowhere", ["refresh-spend"])).toBeNull();
  });
  it("reads the intention flag", () => {
    const root = vault({ yt: m("yt", "YouTube") });
    // Real clock: today's board is whatever today is, so plant there.
    const today = wakingDayKey();
    fs.writeFileSync(path.join(root, "moments.json"), JSON.stringify({ yt: m("yt", "YouTube", today) }));
    const r = runGateCommand(root, ["reflect", "yt", "fine", "--intention", "one talk", "--vault", root]);
    expect(r).toMatchObject({ ok: true, value: { line: "- YouTube · one talk — fine" } });
  });
});
