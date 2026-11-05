import { test } from "node:test";
import assert from "node:assert/strict";

const { reading } = await import("./garden.ts");
const { parseStudy } = await import("./suggest.ts");

// Proposals: the session's directory or a study run diverges from the active moment.
const TODAY = "2026-10-27";
const at = (h, m = 0) => new Date(2026, 9, 27, h, m);
const phases = {
  m: { phase: "MORNING", label: "Morning", startHour: 7, endHour: 13 },
  a: { phase: "AFTERNOON", label: "Afternoon", startHour: 13, endHour: 19 },
};
const areas = {
  fun: { id: "fun", name: "Leisure", emoji: "🍿" },
  th: { id: "th", name: "Themia" },
  eq: { id: "eq", name: "equanimitech" },
};
const moment = (id, name, phase, extra = {}) => ({ id, name, day: TODAY, phase, ...extra });
const film = moment("n", "film", "MORNING", { areaId: "fun" });
const MINERVA = "/Users/r/Developer/themia/minerva/src";
const ZENBORG = "/Users/r/Developer/equanimitech/zenborg/plugin";
const vault = (over = {}) => ({
  active: { momentId: "n", at: at(8, 30).toISOString() },
  moments: { n: film },
  habits: {},
  areas,
  phases,
  cycles: {},
  ...over,
});

test("a fresh active moment in another area proposes that area's planted moments, status unchanged", () => {
  const r = reading(
    vault({
      moments: {
        n: film,
        t2: moment("t2", "later", "AFTERNOON", { areaId: "th", order: 1 }),
        t1: moment("t1", "bugs", "MORNING", { areaId: "th", order: 2 }),
      },
    }),
    at(9),
    MINERVA,
  );
  assert.equal(r.status, "≋ 🍿 film · 30m");
  assert.equal(r.band.line, "≋ In Themia · the intention is film");
  // Only this phase's moment is tended; the standalone afternoon one has no habit and is dropped.
  assert.deepEqual(r.band.taps.map((t) => t.momentId), ["t1"]);
  assert.ok(r.band.laterKey);
});

test("a target-area moment planted in another phase offers + habit, never a tend tap", () => {
  const habits = { a: { id: "a", name: "api", areaId: "th" } };
  const r = reading(
    vault({
      habits,
      moments: {
        n: film,
        t2: moment("t2", "api", "AFTERNOON", { habitId: "a", areaId: "th" }),
        t3: moment("t3", "api", "AFTERNOON", { habitId: "a", areaId: "th" }),
      },
    }),
    at(9),
    MINERVA,
  );
  assert.deepEqual(r.band.taps, [{ kind: "plant", habitId: "a", label: "+ api" }]);
});

test("the same area stays quiet; an active moment with no area gives no cwd proposal", () => {
  const habits = { h: { id: "h", name: "api", areaId: "th" } };
  const same = vault({ habits, moments: { n: { ...film, areaId: "th" } } });
  assert.equal(reading(same, at(9), MINERVA).band, null);
  const nowhere = vault({ habits, moments: { n: moment("n", "film", "MORNING") } });
  assert.equal(reading(nowhere, at(9), MINERVA).band, null);
});

test("a cwd segment naming a habit offers + habit, unless its moment is already a tap", () => {
  const habits = { z: { id: "z", name: "zenborg", areaId: "eq" } };
  const r = reading(vault({ habits }), at(9), ZENBORG);
  assert.deepEqual(r.band.taps, [{ kind: "plant", habitId: "z", label: "+ zenborg" }]);
  const planted = vault({ habits, moments: { n: film, p: moment("p", "zenborg", "MORNING", { habitId: "z", areaId: "eq" }) } });
  assert.deepEqual(reading(planted, at(9), ZENBORG).band.taps.map((t) => t.kind), ["tend"]);
});

test("a craft repo with nothing planted and no named habit offers the area's most-planted habit", () => {
  const habits = {
    a: { id: "a", name: "api", areaId: "th" },
    r: { id: "r", name: "review", areaId: "th" },
    p: { id: "p", name: "old", areaId: "th", attitude: "PRUNING" },
  };
  const past = (id, habitId, day) => [id, moment(id, habitId, "MORNING", { habitId, day })];
  const moments = Object.fromEntries([
    ["n", film],
    past("1", "r", "2026-10-20"),
    past("2", "r", "2026-10-21"),
    past("3", "p", "2026-10-21"),
    past("4", "p", "2026-10-22"),
    past("5", "p", "2026-10-23"),
  ]);
  const r = reading(vault({ habits, moments }), at(9), MINERVA);
  assert.deepEqual(r.band.taps, [{ kind: "plant", habitId: "r", label: "+ review" }]);
});

test("Later's key for a proposal includes the active moment, so a hop raises it again", () => {
  const habits = { a: { id: "a", name: "api", areaId: "th" } };
  const tv = { ...film, id: "o", name: "tv" };
  const k1 = reading(vault({ habits }), at(9), MINERVA).band.laterKey;
  const k2 = reading(
    vault({ habits, active: { momentId: "o", at: at(8, 30).toISOString() }, moments: { n: film, o: tv } }),
    at(9),
    MINERVA,
  ).band.laterKey;
  assert.notEqual(k1, k2);
});

test("study beats cwd and, while held, silences it, even after the switch", () => {
  const habits = {
    i: { id: "i", name: "spanish lessons", areaId: "fun" },
    z: { id: "z", name: "zenborg", areaId: "eq" },
  };
  const study = { day: TODAY, phase: "MORNING", topic: "spanish", habitId: "i" };
  const build = moment("n", "build", "MORNING", { areaId: "eq" });
  const r = reading(vault({ habits, moments: { n: build } }), at(9), ZENBORG, study);
  assert.equal(r.band.line, "≋ Studying spanish · the intention is build");
  assert.deepEqual(r.band.taps, [{ kind: "plant", habitId: "i", label: "+ 🍿 spanish lessons" }]);
  // Tapped: the active moment is the studied habit's; no cwd proposal back to zenborg.
  const after = vault({
    habits,
    moments: { n: build, s: moment("s", "spanish lessons", "MORNING", { habitId: "i", areaId: "fun" }) },
    active: { momentId: "s", at: at(9).toISOString() },
  });
  assert.equal(reading(after, at(9, 5), ZENBORG, study).band, null);
  // A study from another phase no longer holds, and the cwd signal returns.
  const stale = reading(after, at(9, 5), ZENBORG, { ...study, phase: "AFTERNOON" });
  assert.equal(stale.band.line, "≋ In equanimitech · the intention is spanish lessons");
});

test("no active moment: the proposal's taps come first, deduped, capped, under the usual line", () => {
  const v = vault({
    active: {},
    habits: { a: { id: "a", name: "api", areaId: "th", phase: "MORNING" }, s: { id: "s", name: "sit", phase: "MORNING", order: 0 } },
    moments: { t: moment("t", "bugs", "MORNING", { areaId: "th" }), w: moment("w", "walk", "MORNING", { order: 5 }) },
  });
  const r = reading(v, at(9), MINERVA);
  assert.equal(r.band.line, "≋ No intention this morning");
  assert.deepEqual(r.band.taps.map((t) => t.momentId ?? t.habitId), ["t", "w"]);
  assert.equal(r.band.laterKey, undefined);
});

test("parseStudy keeps only an offerable habit id of the vault", () => {
  const v = vault({ habits: { i: { id: "i", name: "x" }, o: { id: "o", name: "y", isArchived: true } } });
  assert.equal(parseStudy(v, 'sure: {"habitId":"i"}'), "i");
  assert.equal(parseStudy(v, '{"habitId":"nope"}'), null);
  assert.equal(parseStudy(v, '{"habitId":"o"}'), null);
  assert.equal(parseStudy(v, '{"habitId":null}'), null);
  assert.equal(parseStudy(v, "no json"), null);
});
