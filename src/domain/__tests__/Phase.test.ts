import { describe, expect, it } from "vitest";
import {
  getCurrentPhase,
  getDefaultPhaseConfigs,
  getPhaseConfig,
  getVisiblePhases,
  isHourInPhase,
  Phase,
  type PhaseConfig,
} from "../value-objects/Phase";

describe("Phase", () => {
  describe("getDefaultPhaseConfigs", () => {
    it("should create 4 default phase configs", () => {
      const configs = getDefaultPhaseConfigs();
      expect(configs).toHaveLength(4);
    });

    it("should have correct phases", () => {
      const configs = getDefaultPhaseConfigs();
      const phases = configs.map((c) => c.phase);
      expect(phases).toEqual([
        Phase.MORNING,
        Phase.AFTERNOON,
        Phase.EVENING,
        Phase.NIGHT,
      ]);
    });

    it("should have correct labels and no default emoji", () => {
      const configs = getDefaultPhaseConfigs();
      expect(configs[0].label).toBe("Morning");
      expect(configs[0].emoji).toBe("");
      expect(configs[1].label).toBe("Afternoon");
      expect(configs[1].emoji).toBe("");
      expect(configs[2].label).toBe("Evening");
      expect(configs[2].emoji).toBe("");
      expect(configs[3].label).toBe("Night");
      expect(configs[3].emoji).toBe("");
    });

    it("should have correct time boundaries", () => {
      const configs = getDefaultPhaseConfigs();
      expect(configs[0].startHour).toBe(6);
      expect(configs[0].endHour).toBe(12);
      expect(configs[1].startHour).toBe(12);
      expect(configs[1].endHour).toBe(18);
      expect(configs[2].startHour).toBe(18);
      expect(configs[2].endHour).toBe(22);
      expect(configs[3].startHour).toBe(22);
      expect(configs[3].endHour).toBe(6); // Wrap-around
    });

    it("should mark NIGHT as hidden by default", () => {
      const configs = getDefaultPhaseConfigs();
      expect(configs[0].isVisible).toBe(true);
      expect(configs[1].isVisible).toBe(true);
      expect(configs[2].isVisible).toBe(true);
      expect(configs[3].isVisible).toBe(false); // NIGHT hidden
    });

    it("should have sequential order", () => {
      const configs = getDefaultPhaseConfigs();
      configs.forEach((config, index) => {
        expect(config.order).toBe(index);
      });
    });

    it("should have unique IDs", () => {
      const configs = getDefaultPhaseConfigs();
      const ids = configs.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(4);
    });
  });

  describe("isHourInPhase", () => {
    const configs = getDefaultPhaseConfigs();
    const morningConfig = configs[0];
    const afternoonConfig = configs[1];
    const eveningConfig = configs[2];
    const nightConfig = configs[3];

    describe("normal phases (no wrap-around)", () => {
      it("should detect hour at start boundary", () => {
        expect(isHourInPhase(6, morningConfig)).toBe(true);
        expect(isHourInPhase(12, afternoonConfig)).toBe(true);
        expect(isHourInPhase(18, eveningConfig)).toBe(true);
      });

      it("should detect hour in middle of phase", () => {
        expect(isHourInPhase(9, morningConfig)).toBe(true);
        expect(isHourInPhase(15, afternoonConfig)).toBe(true);
        expect(isHourInPhase(20, eveningConfig)).toBe(true);
      });

      it("should not include end boundary", () => {
        expect(isHourInPhase(12, morningConfig)).toBe(false);
        expect(isHourInPhase(18, afternoonConfig)).toBe(false);
        expect(isHourInPhase(22, eveningConfig)).toBe(false);
      });

      it("should detect hours outside phase", () => {
        expect(isHourInPhase(5, morningConfig)).toBe(false);
        expect(isHourInPhase(13, morningConfig)).toBe(false);
        expect(isHourInPhase(11, afternoonConfig)).toBe(false);
        expect(isHourInPhase(19, afternoonConfig)).toBe(false);
      });
    });

    describe("wrap-around phase (NIGHT)", () => {
      it("should detect hour at start boundary", () => {
        expect(isHourInPhase(22, nightConfig)).toBe(true);
      });

      it("should detect late night hours", () => {
        expect(isHourInPhase(23, nightConfig)).toBe(true);
      });

      it("should detect early morning hours (before end)", () => {
        expect(isHourInPhase(0, nightConfig)).toBe(true);
        expect(isHourInPhase(1, nightConfig)).toBe(true);
        expect(isHourInPhase(5, nightConfig)).toBe(true);
      });

      it("should not include end boundary", () => {
        expect(isHourInPhase(6, nightConfig)).toBe(false);
      });

      it("should detect hours outside night phase", () => {
        expect(isHourInPhase(7, nightConfig)).toBe(false);
        expect(isHourInPhase(12, nightConfig)).toBe(false);
        expect(isHourInPhase(18, nightConfig)).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should throw error for invalid hour < 0", () => {
        expect(() => isHourInPhase(-1, morningConfig)).toThrow(
          "Hour must be between 0 and 23",
        );
      });

      it("should throw error for invalid hour > 23", () => {
        expect(() => isHourInPhase(24, morningConfig)).toThrow(
          "Hour must be between 0 and 23",
        );
      });
    });
  });

  describe("getCurrentPhase", () => {
    const configs = getDefaultPhaseConfigs();

    describe("with all phases visible", () => {
      const visibleConfigs = configs.map((c) => ({ ...c, isVisible: true }));

      it("should detect MORNING phase", () => {
        expect(getCurrentPhase(6, visibleConfigs)).toBe(Phase.MORNING);
        expect(getCurrentPhase(9, visibleConfigs)).toBe(Phase.MORNING);
        expect(getCurrentPhase(11, visibleConfigs)).toBe(Phase.MORNING);
      });

      it("should detect AFTERNOON phase", () => {
        expect(getCurrentPhase(12, visibleConfigs)).toBe(Phase.AFTERNOON);
        expect(getCurrentPhase(15, visibleConfigs)).toBe(Phase.AFTERNOON);
        expect(getCurrentPhase(17, visibleConfigs)).toBe(Phase.AFTERNOON);
      });

      it("should detect EVENING phase", () => {
        expect(getCurrentPhase(18, visibleConfigs)).toBe(Phase.EVENING);
        expect(getCurrentPhase(20, visibleConfigs)).toBe(Phase.EVENING);
        expect(getCurrentPhase(21, visibleConfigs)).toBe(Phase.EVENING);
      });

      it("should detect NIGHT phase", () => {
        expect(getCurrentPhase(22, visibleConfigs)).toBe(Phase.NIGHT);
        expect(getCurrentPhase(23, visibleConfigs)).toBe(Phase.NIGHT);
        expect(getCurrentPhase(0, visibleConfigs)).toBe(Phase.NIGHT);
        expect(getCurrentPhase(5, visibleConfigs)).toBe(Phase.NIGHT);
      });
    });

    describe("with NIGHT phase hidden (default)", () => {
      it("should return null for night hours", () => {
        expect(getCurrentPhase(22, configs)).toBe(null);
        expect(getCurrentPhase(23, configs)).toBe(null);
        expect(getCurrentPhase(0, configs)).toBe(null);
        expect(getCurrentPhase(5, configs)).toBe(null);
      });

      it("should still detect other phases", () => {
        expect(getCurrentPhase(9, configs)).toBe(Phase.MORNING);
        expect(getCurrentPhase(15, configs)).toBe(Phase.AFTERNOON);
        expect(getCurrentPhase(20, configs)).toBe(Phase.EVENING);
      });
    });

    describe("with custom visibility", () => {
      it("should skip hidden phases", () => {
        const customConfigs = configs.map((c) => ({
          ...c,
          isVisible: c.phase !== Phase.AFTERNOON,
        }));

        expect(getCurrentPhase(9, customConfigs)).toBe(Phase.MORNING);
        expect(getCurrentPhase(15, customConfigs)).toBe(null); // AFTERNOON hidden
        expect(getCurrentPhase(20, customConfigs)).toBe(Phase.EVENING);
      });

      it("should return null when all phases are hidden", () => {
        const hiddenConfigs = configs.map((c) => ({ ...c, isVisible: false }));
        expect(getCurrentPhase(12, hiddenConfigs)).toBe(null);
      });
    });

    describe("edge cases", () => {
      it("should throw error for invalid hour < 0", () => {
        expect(() => getCurrentPhase(-1, configs)).toThrow(
          "Hour must be between 0 and 23",
        );
      });

      it("should throw error for invalid hour > 23", () => {
        expect(() => getCurrentPhase(24, configs)).toThrow(
          "Hour must be between 0 and 23",
        );
      });
    });
  });

  describe("getPhaseConfig", () => {
    const configs = getDefaultPhaseConfigs();

    it("should find MORNING config", () => {
      const config = getPhaseConfig(Phase.MORNING, configs);
      expect(config).toBeDefined();
      expect(config?.phase).toBe(Phase.MORNING);
    });

    it("should find AFTERNOON config", () => {
      const config = getPhaseConfig(Phase.AFTERNOON, configs);
      expect(config).toBeDefined();
      expect(config?.phase).toBe(Phase.AFTERNOON);
    });

    it("should find EVENING config", () => {
      const config = getPhaseConfig(Phase.EVENING, configs);
      expect(config).toBeDefined();
      expect(config?.phase).toBe(Phase.EVENING);
    });

    it("should find NIGHT config", () => {
      const config = getPhaseConfig(Phase.NIGHT, configs);
      expect(config).toBeDefined();
      expect(config?.phase).toBe(Phase.NIGHT);
    });

    it("should return undefined for non-existent phase", () => {
      const emptyConfigs: PhaseConfig[] = [];
      const config = getPhaseConfig(Phase.MORNING, emptyConfigs);
      expect(config).toBeUndefined();
    });
  });

  describe("getVisiblePhases", () => {
    const configs = getDefaultPhaseConfigs();

    it("should return only visible phases", () => {
      const visible = getVisiblePhases(configs);
      expect(visible).toHaveLength(3); // MORNING, AFTERNOON, EVENING
      expect(visible.map((c) => c.phase)).toEqual([
        Phase.MORNING,
        Phase.AFTERNOON,
        Phase.EVENING,
      ]);
    });

    it("should sort by order", () => {
      const shuffledConfigs = [...configs].reverse();
      const visible = getVisiblePhases(shuffledConfigs);
      expect(visible.map((c) => c.order)).toEqual([0, 1, 2]);
    });

    it("should handle all visible", () => {
      const allVisible = configs.map((c) => ({ ...c, isVisible: true }));
      const visible = getVisiblePhases(allVisible);
      expect(visible).toHaveLength(4);
    });

    it("should handle all hidden", () => {
      const allHidden = configs.map((c) => ({ ...c, isVisible: false }));
      const visible = getVisiblePhases(allHidden);
      expect(visible).toHaveLength(0);
    });

    it("should handle custom order", () => {
      const customOrder = configs.map((c, i) => ({
        ...c,
        isVisible: true,
        order: 3 - i, // Reverse order
      }));
      const visible = getVisiblePhases(customOrder);
      expect(visible.map((c) => c.order)).toEqual([0, 1, 2, 3]);
    });
  });
});
