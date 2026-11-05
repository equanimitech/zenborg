import { test } from "node:test";
import assert from "node:assert/strict";

const { orderOps, opCall, describe, parseProposal } = await import("./board.ts");

const moments = (orders) => Object.fromEntries(Object.entries(orders).map(([id, order]) => [id, { id, name: id, ...(order === undefined ? {} : { order }) }]));
const vault = (orders) => ({ active: {}, areas: {}, phases: {}, habits: {}, cycles: {}, moments: moments(orders) });

test("orderOps: tied or missing orders are renumbered, and only changed rows are written", () => {
  const v = vault({ a: 0, b: 0, c: undefined });
  assert.deepEqual(orderOps(v, ["a", "b", "c"], "a", 1), [
    { op: "order", id: "a", order: 1 },
    { op: "order", id: "c", order: 2 },
  ]);
});

test("orderOps: a clean sequence rewrites just the swapped pair; k swaps upward", () => {
  const v = vault({ a: 0, b: 1, c: 2 });
  assert.deepEqual(orderOps(v, ["a", "b", "c"], "b", -1), [
    { op: "order", id: "b", order: 0 },
    { op: "order", id: "a", order: 1 },
  ]);
});

test("orderOps: the group's edges, and a stranger, give nothing", () => {
  const v = vault({ a: 0, b: 1 });
  assert.deepEqual(orderOps(v, ["a", "b"], "a", -1), []);
  assert.deepEqual(orderOps(v, ["a", "b"], "b", 1), []);
  assert.deepEqual(orderOps(v, ["a", "b"], "x", 1), []);
});

test("an order op writes through update_moment and reads as a line", () => {
  const v = vault({ a: 0 });
  assert.deepEqual(opCall(v, { op: "order", id: "a", order: 3 }), { name: "update_moment", input: { id: "a", order: 3 } });
  assert.equal(describe(v, { op: "order", id: "a", order: 3 }), "a → #4");
});

test("Haiku's proposals never gain the order op", () => {
  const v = vault({ a: 0 });
  const p = parseProposal(v, '[{"op":"order","id":"a","order":2}]', "reorder a");
  assert.deepEqual(p.ops, []);
  assert.deepEqual(p.dropped, ['unknown op "order"']);
});
