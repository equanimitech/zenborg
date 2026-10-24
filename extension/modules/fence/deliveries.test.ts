import { describe, expect, it } from "vitest";
import { tallyDeliveries } from "./deliveries";

const dp = (ruleId: string, delivered: boolean) => ({ kind: "decision_point", payload: { ruleId, delivered } });
const ev = (kind: string, ruleId: string) => ({ kind, payload: { ruleId } });

describe("tallyDeliveries", () => {
  it("counts points, shown, withheld, continued, left per rule", () => {
    const rows = tallyDeliveries([
      dp("a", true),
      ev("intervention_shown", "a"),
      ev("intervention_clicked_through", "a"),
      dp("a", false),
      dp("b", true),
      ev("intervention_dismissed", "b"),
    ]);
    expect(rows).toEqual([
      { ruleId: "a", points: 2, shown: 1, withheld: 1, continued: 1, left: 0 },
      { ruleId: "b", points: 1, shown: 1, withheld: 0, continued: 0, left: 1 },
    ]);
  });
  it("omits rules with no decision point", () => {
    expect(tallyDeliveries([ev("intervention_dismissed", "x")])).toEqual([]);
  });
});
