import { describe, expect, it } from "vitest";
import { checkIntentions, keyPeople, resolveIntentions } from "./intentions.js";

const known = new Set(["a1", "a2"]);
const twelve = "one two three four five six seven eight nine ten eleven twelve";

describe("checkIntentions", () => {
  it("accepts 1 to 12 words and trims", () => {
    expect(
      checkIntentions("area", { a1: "  settle in slowly " }, known, false),
    ).toEqual({ ok: true, value: { a1: "settle in slowly" } });
  });
  it("accepts exactly 12 words", () => {
    expect(checkIntentions("area", { a1: twelve }, known, false).ok).toBe(true);
  });
  it("rejects 13 words", () => {
    const r = checkIntentions("area", { a1: `${twelve} thirteen` }, known, false);
    expect(r.ok).toBe(false);
  });
  it("rejects an unknown id, naming it", () => {
    expect(checkIntentions("person", { zzz: "hi" }, known, true)).toEqual({
      ok: false,
      error: "Unknown person id: zzz",
    });
  });
  it("rejects empty text for an area but allows it for a person", () => {
    expect(checkIntentions("area", { a1: " " }, known, false).ok).toBe(false);
    expect(checkIntentions("person", { a1: "" }, known, true)).toEqual({
      ok: true,
      value: { a1: "" },
    });
  });
});

describe("resolveIntentions", () => {
  it("resolves names and tolerates a deleted entity", () => {
    expect(
      resolveIntentions({ a1: "grow", gone: "" }, { a1: { name: "Garden" } }),
    ).toEqual([
      { id: "a1", name: "Garden", text: "grow" },
      { id: "gone", name: null, text: "" },
    ]);
  });
  it("returns [] when absent", () => {
    expect(resolveIntentions(undefined, {})).toEqual([]);
  });
});

describe("keyPeople", () => {
  const people = { p1: { id: "uuid-1", key: "ada" } };
  it("keeps a key and normalises a record id to the key", () => {
    expect(keyPeople({ ada: "call" }, people)).toEqual({ ada: "call" });
    expect(keyPeople({ "uuid-1": "" }, people)).toEqual({ ada: "" });
  });
  it("leaves an unknown value so validation can name it", () => {
    const keyed = keyPeople({ nobody: "" }, people);
    expect(
      checkIntentions("person", keyed, new Set(["ada"]), true),
    ).toEqual({ ok: false, error: "Unknown person id: nobody" });
  });
});
