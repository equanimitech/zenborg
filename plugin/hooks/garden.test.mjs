import { test } from "node:test";
import assert from "node:assert/strict";

const { reading } = await import("./garden.ts");

const TODAY = "2026-10-27";
const at = (h, m = 0) => new Date(2026, 9, 27, h, m);
const phases = {
  m: { phase: "MORNING", label: "Morning", startHour: 7, endHour: 13 },
  a: { phase: "AFTERNOON", label: "Afternoon", startHour: 13, endHour: 19 },
};
const areas = { fun: { id: "fun", name: "Leisure", emoji: "🍿" } };
const vault = (over = {}) => ({ active: {}, moments: {}, habits: {}, areas, phases, ...over });
const moment = (id, name, phase, extra = {}) => ({ id, name, day: TODAY, phase, ...extra });
const filmMoment = (phase) => moment("n", "film", phase, { areaId: "fun" });

test("a fresh active moment: status only, no band", () => {
  const r = reading(
    vault({ active: { momentId: "n", at: at(8).toISOString() }, moments: { n: filmMoment("MORNING") } }),
    at(9),
  );
  assert.deepEqual(r, { status: "≋ 🍿 film", band: null });
});

test("an active moment from another phase offers three of this phase's moments, in order", () => {
  const r = reading(
    vault({
      active: { momentId: "n", at: at(8).toISOString() },
      moments: {
        n: filmMoment("AFTERNOON"),
        d: moment("d", "read", "MORNING", { order: 4 }),
        b: moment("b", "tea", "MORNING", { emoji: "🥐", order: 2 }),
        a: moment("a", "sit", "MORNING", { emoji: "🧘", order: 1 }),
        c: moment("c", "walk", "MORNING", { emoji: "🟰", order: 3 }),
      },
    }),
    at(9),
  );
  assert.equal(r.status, "≋ 🍿 film · from the afternoon");
  assert.deepEqual(r.band, {
    day: TODAY,
    phase: "MORNING",
    line: "≋ film is from the afternoon",
    taps: [
      { kind: "tend", momentId: "a", label: "🧘 sit" },
      { kind: "tend", momentId: "b", label: "🥐 tea" },
      { kind: "tend", momentId: "c", label: "🟰 walk" },
    ],
  });
});

test("an active moment set over two hours ago is stale, and is not offered to itself", () => {
  const r = reading(
    vault({
      active: { momentId: "n", at: at(7).toISOString() },
      moments: { n: filmMoment("MORNING"), a: moment("a", "sit", "MORNING", { emoji: "🧘" }) },
    }),
    at(10),
  );
  assert.equal(r.status, "≋ 🍿 film · set 3h ago");
  assert.equal(r.band.line, "≋ film was set 3h ago");
  assert.deepEqual(r.band.taps, [{ kind: "tend", momentId: "a", label: "🧘 sit" }]);
});

test("nothing planted: habits of this phase, unarchived, in order, as plant taps", () => {
  const r = reading(
    vault({
      habits: {
        h2: { id: "h2", name: "run", phase: "MORNING", order: 2 },
        h1: { id: "h1", name: "sit", phase: "MORNING", emoji: "🧘", order: 1 },
        h0: { id: "h0", name: "old", phase: "MORNING", order: 0, isArchived: true },
        h4: { id: "h4", name: "nap", phase: "AFTERNOON", order: 0 },
      },
    }),
    at(9),
  );
  assert.equal(r.status, "≋ Morning");
  assert.equal(r.band.line, "≋ Nothing planted this morning");
  assert.deepEqual(r.band.taps, [
    { kind: "plant", habitId: "h1", label: "+ 🧘 sit" },
    { kind: "plant", habitId: "h2", label: "+ run" },
  ]);
});

test("a pointer to a moment off today's board reads as none", () => {
  const r = reading(
    vault({
      active: { momentId: "n", at: at(8).toISOString() },
      moments: { n: { ...filmMoment("MORNING"), day: "2026-10-20" }, a: moment("a", "sit", "MORNING") },
    }),
    at(9),
  );
  assert.equal(r.status, "≋ Morning");
  assert.equal(r.band.line, "≋ No intention this morning");
});

test("nothing to offer: status only", () => {
  assert.deepEqual(reading(vault(), at(9)), { status: "≋ Morning", band: null });
});

test("outside every phase: nothing at all", () => {
  assert.equal(reading(vault(), at(22)), null);
});
