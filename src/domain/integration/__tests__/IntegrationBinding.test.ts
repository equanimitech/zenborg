import { describe, expect, it } from "vitest";
import { findBinding, parseIntegrationConfig } from "../IntegrationBinding.ts";

describe("parseIntegrationConfig", () => {
  it("parses a valid config", () => {
    const config = parseIntegrationConfig({
      version: 1,
      bindings: [
        { source: "garmin.sleep", areaId: "area-1", habitId: "habit-1" },
      ],
    });
    expect(config.bindings).toHaveLength(1);
    expect(config.bindings[0].source).toBe("garmin.sleep");
  });

  it("fails soft to empty on null", () => {
    expect(parseIntegrationConfig(null).bindings).toHaveLength(0);
  });

  it("fails soft to empty on a non-object", () => {
    expect(parseIntegrationConfig("garbage").bindings).toHaveLength(0);
  });

  it("fails soft to empty on missing bindings", () => {
    expect(parseIntegrationConfig({ version: 1 }).bindings).toHaveLength(0);
  });

  it("drops bindings with missing required fields", () => {
    const config = parseIntegrationConfig({
      version: 1,
      bindings: [
        { source: "garmin.sleep", areaId: "area-1" },
        { source: "garmin.sleep", areaId: "area-1", habitId: "habit-1" },
        { areaId: "area-1", habitId: "habit-1" },
      ],
    });
    expect(config.bindings).toHaveLength(1);
    expect(config.bindings[0].habitId).toBe("habit-1");
  });

  it("preserves extra fields for forward compatibility", () => {
    const config = parseIntegrationConfig({
      version: 1,
      bindings: [
        {
          source: "garmin.sleep",
          areaId: "area-1",
          habitId: "habit-1",
          note: "rest area",
        },
      ],
    });
    expect(config.bindings[0].source).toBe("garmin.sleep");
  });
});

describe("findBinding", () => {
  const config = parseIntegrationConfig({
    version: 1,
    bindings: [
      { source: "garmin.sleep", areaId: "area-rest", habitId: "habit-sleep" },
      {
        source: "garmin.activity.yoga",
        areaId: "area-mind",
        habitId: "habit-yoga",
      },
    ],
  });

  it("finds a binding by source", () => {
    const binding = findBinding(config, "garmin.sleep");
    expect(binding).not.toBeNull();
    expect(binding!.areaId).toBe("area-rest");
    expect(binding!.habitId).toBe("habit-sleep");
  });

  it("returns null for an unbound source", () => {
    expect(findBinding(config, "garmin.activity.running")).toBeNull();
  });
});
