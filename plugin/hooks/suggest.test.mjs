import { test } from "node:test";
import assert from "node:assert/strict";

const { rhythmRow, quietIntentions, parseMatches, matchPrompt, runningCycle } = await import("./suggest.ts");

const TODAY = "2026-10-27"; // a Tuesday
const habit = (id, extra = {}) => [id, { id, name: id, areaId: "a", ...extra }];
const plant = (list) =>
  Object.fromEntries(list.map(([habitId, day, phase = "MORNING"], i) => [`m${i}`, { id: `m${i}`, name: habitId, habitId, day, phase }]));
const vault = (habits, moments, cycleIntentions) => ({
  active: {},
  areas: { a: { id: "a", name: "Body" }, b: { id: "b", name: "Mind" } },
  phases: {},
  habits: Object.fromEntries(habits),
  moments: plant(moments),
  cycles: cycleIntentions
    ? { c: { id: "c", startDate: "2026-10-20", endDate: "2026-11-10", areaIntentions: cycleIntentions } }
    : {},
});
const view = { day: TODAY, phase: "MORNING" };
const ids = (r) => r.map((s) => s.habitId);

test("rhythm: pruned, archived and already-planted habits are never offered", () => {
  const v = vault(
    [habit("run"), habit("wine", { attitude: "PRUNING" }), habit("old", { isArchived: true }), habit("sit")],
    [["run", "2026-10-26"], ["wine", "2026-10-26"], ["old", "2026-10-26"], ["sit", "2026-10-26"], ["sit", TODAY]],
  );
  assert.deepEqual(ids(rhythmRow(v, view, TODAY)), ["run"]);
});

test("rhythm: only the shown phase counts, only the 56 days before today, top 3", () => {
  const hs = ["a", "b", "c", "d"].map((h) => habit(h));
  const v = vault(hs, [
    ["a", "2026-10-26"], ["b", "2026-10-26"], ["c", "2026-10-26"], ["d", "2026-10-26"],
    ["a", "2026-10-25"], // a twice: first
    ["d", "2026-10-26", "EVENING"], // wrong phase
    ["d", "2026-08-01"], // outside the window
  ]);
  assert.deepEqual(ids(rhythmRow(v, view, TODAY)), ["a", "b", "c"]);
  assert.deepEqual(ids(rhythmRow(v, view, TODAY, { limit: 5 })), ["a", "b", "c", "d"]);
});

test("rhythm: the shown day's weekday weighs x4; recency halves every 21 days", () => {
  // x is two Tuesdays ago (14d); y is yesterday (1d). Viewing a Tuesday, x wins; viewing a Wednesday, y wins.
  const v = vault([habit("x"), habit("y")], [["x", "2026-10-13"], ["y", "2026-10-26"]]);
  assert.deepEqual(ids(rhythmRow(v, view, TODAY)), ["x", "y"]);
  assert.deepEqual(ids(rhythmRow(v, { day: "2026-10-28", phase: "MORNING" }, TODAY)), ["y", "x"]);
  // Half-life: two plantings ~3 weeks ago (1.01) edge out one yesterday (0.97), which beats one 3 weeks ago (0.52).
  const w = vault(
    [habit("p"), habit("q"), habit("r")],
    [["p", "2026-10-07"], ["q", "2026-10-26"], ["r", "2026-10-07"], ["r", "2026-10-08"]],
  );
  assert.deepEqual(ids(rhythmRow(w, view, TODAY)), ["r", "q", "p"]);
});

test("rhythm: skip leaves a habit out and the next takes its place", () => {
  const v = vault([habit("a"), habit("b")], [["a", "2026-10-26"], ["a", "2026-10-25"], ["b", "2026-10-26"]]);
  assert.deepEqual(ids(rhythmRow(v, view, TODAY, { skip: new Set(["a"]) })), ["b"]);
});

test("rhythm: the label carries the habit's emoji, else its area's", () => {
  const v = vault([habit("run", { emoji: "🏃" })], [["run", "2026-10-26"]]);
  assert.equal(rhythmRow(v, view, TODAY)[0].label, "🏃 run");
});

test("runningCycle is the one whose dates contain today", () => {
  assert.equal(runningCycle(vault([], [], { a: "x" }), TODAY).id, "c");
  assert.equal(runningCycle(vault([], [], { a: "x" }), "2026-11-11"), undefined);
});

// guitar planted every 7 days, last on 10-18 (9 days ago).
const GUITAR = [["g", "2026-10-18"], ["g", "2026-10-11"], ["g", "2026-10-04"]];

test("quiet: days since planting beyond the median gap offers the most-planted habit with neutral history", () => {
  const v = vault([habit("g", { emoji: "🎸", name: "guitar" }), habit("s")], [...GUITAR, ["s", "2026-10-18"]], { a: "play" });
  const r = quietIntentions(v, TODAY, { a: ["g", "s"] });
  assert.deepEqual(r, [{ habitId: "g", label: "🎸 guitar", note: "last planted 9 days ago" }]);
});

test("quiet: not quiet while within the median gap; floor of 1 day", () => {
  const v = vault([habit("g")], [...GUITAR, ["g", "2026-10-22"]], { a: "play" });
  assert.deepEqual(quietIntentions(v, TODAY, { a: ["g"] }), []); // 5 days ago, median gap 7 or less
  const daily = vault([habit("g")], [["g", "2026-10-26"], ["g", "2026-10-25"], ["g", TODAY]], { a: "play" });
  assert.deepEqual(quietIntentions(daily, TODAY, { a: ["g"] }), []); // planted today: 0 days
  const yesterday = vault([habit("g")], [["g", "2026-10-25"], ["g", "2026-10-24"]], { a: "play" });
  assert.equal(quietIntentions(yesterday, TODAY, { a: ["g"] }).length, 1); // 2 days > floor 1
});

test("quiet: pruned matches are ignored; no match gives no row; fallback is the area's most-planted offerable habit", () => {
  const v = vault(
    [habit("g"), habit("wine", { attitude: "PRUNING" }), habit("s")],
    [...GUITAR, ["wine", "2026-10-01"], ["wine", "2026-10-02"], ["wine", "2026-10-03"], ["wine", "2026-10-04"], ["s", "2026-10-02"]],
    { a: "play" },
  );
  assert.deepEqual(quietIntentions(v, TODAY, { a: ["wine"] }), []);
  assert.deepEqual(quietIntentions(v, TODAY, { a: [] }), []);
  assert.deepEqual(ids(quietIntentions(v, TODAY, {})), ["g"]);
});

test("quiet: top 2, quietest first; a habit already planted in the shown phase is left out", () => {
  const v = vault(
    [habit("g"), habit("r", { areaId: "b" }), habit("c", { areaId: "b" })],
    [...GUITAR, ["r", "2026-10-10"], ["r", "2026-10-03"], ["r", "2026-09-26"], ["c", "2026-10-17"], ["c", "2026-10-10"]],
    { a: "play", b: "move" },
  );
  assert.deepEqual(ids(quietIntentions(v, TODAY, { a: ["g"], b: ["r", "c"] })), ["r", "g"]);
  const withHere = { ...v, moments: { ...v.moments, h: { id: "h", name: "g", habitId: "g", day: TODAY, phase: "MORNING" } } };
  assert.deepEqual(ids(quietIntentions(withHere, TODAY, { a: ["g"], b: ["r"] }, { view })), ["r"]);
});

test("parseMatches reads the reply strictly against the vault; matchPrompt skips areas with no offerable habit", () => {
  const v = vault([habit("g"), habit("wine", { attitude: "PRUNING" }), habit("m", { areaId: "b" })], [], { a: "play", b: "sit" });
  const cycle = v.cycles.c;
  assert.deepEqual(parseMatches(v, cycle, 'sure: {"a":["g","wine","m","zz"],"b":"x"} done'), { a: ["g"], b: [] });
  assert.equal(parseMatches(v, cycle, "no json"), null);
  assert.equal(parseMatches(v, cycle, "{bad"), null);
  const prompt = JSON.parse(matchPrompt(v, cycle));
  assert.deepEqual(prompt.areas.map((x) => [x.areaId, x.habits.map((h) => h.id)]), [["a", ["g"]], ["b", ["m"]]]);
  assert.equal(matchPrompt(vault([], [], { a: "x" }), vault([], [], { a: "x" }).cycles.c), null);
});
