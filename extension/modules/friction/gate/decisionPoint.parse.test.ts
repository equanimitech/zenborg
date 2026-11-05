import { describe, expect, it } from "vitest";
import { gatesFrom, parseFences } from "../../fence/parse";

describe("parseFences carries outcome.windowMs and serves.areaId", () => {
  it("onto the gate", () => {
    const rec = {
      c: {
        id: "c",
        scope: { surface: "browser", domain: "chess.com" },
        outcome: { windowMs: 120_000 },
        serves: { areaId: "area-1" },
        primitives: [
          {
            kind: "gate",
            trigger: { type: "entry" },
            frictionType: { type: "confirmation" },
            proceedAffordance: { label: "Go", action: { type: "continue" } },
          },
        ],
      },
    };
    const [g] = gatesFrom(parseFences(rec)!.fences);
    expect(g).toMatchObject({ windowMs: 120_000, servesAreaId: "area-1" });
  });
});
