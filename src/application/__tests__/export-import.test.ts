import { describe, expect, it } from "vitest";
import type { Area } from "@/domain/entities/Area";
import type { Cycle } from "@/domain/entities/Cycle";
import type { CyclePlan } from "@/domain/entities/CyclePlan";
import type { DayNote } from "@/domain/entities/DayNote";
import type { Habit } from "@/domain/entities/Habit";
import type { MetricLog } from "@/domain/entities/MetricLog";
import type { Moment } from "@/domain/entities/Moment";
import type { Phase, PhaseConfig } from "@/domain/value-objects/Phase";
import {
  EXPORT_SCHEMA_VERSION,
  exportData,
  importDataWithStrategy,
  validateImportData,
  type ZenborgExportData,
} from "../use-cases/export-import";

describe("Export/Import System", () => {
  // Sample test data
  const sampleMoments: Record<string, Moment> = {
    "moment-1": {
      id: "moment-1",
      name: "Morning Run",
      areaId: "area-1",
      habitId: null,
      cycleId: null,
      cyclePlanId: null,
      phase: "MORNING" as Phase,
      day: "2025-01-15",
      order: 0,
      tags: null,
      createdAt: "2025-01-15T08:00:00.000Z",
      updatedAt: "2025-01-15T08:00:00.000Z",
    },
    "moment-2": {
      id: "moment-2",
      name: "Deep Work",
      areaId: "area-2",
      habitId: null,
      cycleId: null,
      cyclePlanId: null,
      phase: null,
      day: null,
      order: 0,
      tags: null,
      createdAt: "2025-01-15T09:00:00.000Z",
      updatedAt: "2025-01-15T09:00:00.000Z",
    },
  };

  const sampleAreas: Record<string, Area> = {
    "area-1": {
      id: "area-1",
      name: "Wellness",
      attitude: null,
      tags: [],
      color: "#10b981",
      emoji: "🧘",
      isDefault: true,
      isArchived: false,
      order: 0,
      createdAt: "2025-01-15T08:00:00.000Z",
      updatedAt: "2025-01-15T08:00:00.000Z",
    },
    "area-2": {
      id: "area-2",
      name: "Craft",
      attitude: null,
      tags: [],
      color: "#3b82f6",
      emoji: "🎨",
      isDefault: true,
      isArchived: false,
      order: 1,
      createdAt: "2025-01-15T08:00:00.000Z",
      updatedAt: "2025-01-15T08:00:00.000Z",
    },
  };

  const sampleCycles: Record<string, Cycle> = {
    "cycle-1": {
      id: "cycle-1",
      name: "Q1 2025",
      startDate: "2025-01-01",
      endDate: "2025-03-31",
      intention: null,
      reflection: null,
      createdAt: "2025-01-15T08:00:00.000Z",
      updatedAt: "2025-01-15T08:00:00.000Z",
    },
  };

  const samplePhaseConfigs: Record<string, PhaseConfig> = {
    "phase-1": {
      id: "phase-1",
      phase: "MORNING" as Phase,
      label: "Morning",
      emoji: "☕",
      color: "#f59e0b",
      startHour: 6,
      endHour: 12,
      isVisible: true,
      order: 0,
      createdAt: "2025-01-15T08:00:00.000Z",
      updatedAt: "2025-01-15T08:00:00.000Z",
    },
  };

  const sampleHabits: Record<string, Habit> = {};
  const sampleCyclePlans: Record<string, CyclePlan> = {};
  const sampleMetricLogs: Record<string, MetricLog> = {};
  const sampleDayNotes: Record<string, DayNote> = {};

  describe("exportData", () => {
    it("should create a valid export structure", () => {
      const exported = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      expect(exported.version).toBe(EXPORT_SCHEMA_VERSION);
      expect(exported.exportedAt).toBeDefined();
      expect(new Date(exported.exportedAt).getTime()).toBeGreaterThan(0);
      expect(exported.data).toBeDefined();
      expect(exported.metadata).toBeDefined();
    });

    it("should include all data in export", () => {
      const exported = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      expect(exported.data.moments).toEqual(sampleMoments);
      expect(exported.data.areas).toEqual(sampleAreas);
      expect(exported.data.habits).toEqual(sampleHabits);
      expect(exported.data.cycles).toEqual(sampleCycles);
      expect(exported.data.phaseConfigs).toEqual(samplePhaseConfigs);
      expect(exported.data.metricLogs).toEqual(sampleMetricLogs);
    });

    it("should include correct metadata counts", () => {
      const exported = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      expect(exported.metadata.totalMoments).toBe(2);
      expect(exported.metadata.totalAreas).toBe(2);
      expect(exported.metadata.totalHabits).toBe(0);
      expect(exported.metadata.totalCycles).toBe(1);
      expect(exported.metadata.totalCyclePlans).toBe(0);
      expect(exported.metadata.totalPhaseConfigs).toBe(1);
      expect(exported.metadata.totalMetricLogs).toBe(0);
    });

    it("should handle empty data", () => {
      const exported = exportData({}, {}, {}, {}, {}, {}, {}, {});

      expect(exported.metadata.totalMoments).toBe(0);
      expect(exported.metadata.totalAreas).toBe(0);
      expect(exported.metadata.totalHabits).toBe(0);
      expect(exported.metadata.totalCycles).toBe(0);
      expect(exported.metadata.totalCyclePlans).toBe(0);
      expect(exported.metadata.totalPhaseConfigs).toBe(0);
      expect(exported.metadata.totalMetricLogs).toBe(0);
    });
  });

  describe("validateImportData", () => {
    it("should validate correct export data", () => {
      const validData = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      const validation = validateImportData(validData);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should reject non-object data", () => {
      const validation = validateImportData(null);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain(
        "Invalid data format: must be a JSON object",
      );
    });

    it("should reject data without version", () => {
      const invalidData = {
        exportedAt: new Date().toISOString(),
        data: {
          moments: {},
          areas: {},
          habits: {},
          cycles: {},
          cyclePlans: {},
          phaseConfigs: {},
          metricLogs: {},
          dayNotes: {},
        },
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Missing version field");
    });

    it("should reject data without exportedAt", () => {
      const invalidData = {
        version: EXPORT_SCHEMA_VERSION,
        data: {
          moments: {},
          areas: {},
          habits: {},
          cycles: {},
          cyclePlans: {},
          phaseConfigs: {},
          metricLogs: {},
          dayNotes: {},
        },
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Missing exportedAt field");
    });

    it("should reject data without data field", () => {
      const invalidData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Missing data field");
    });

    it("should reject data with missing moments", () => {
      const invalidData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          areas: {},
          cycles: {},
          phaseConfigs: {},
        },
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Invalid or missing moments data");
    });

    it("should reject data with missing areas", () => {
      const invalidData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          moments: {},
          cycles: {},
          phaseConfigs: {},
        },
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Invalid or missing areas data");
    });

    it("should warn about version mismatch", () => {
      const invalidData = {
        version: "99.0.0",
        exportedAt: new Date().toISOString(),
        data: {
          moments: {},
          areas: {},
          habits: {},
          cycles: {},
          cyclePlans: {},
          phaseConfigs: {},
          metricLogs: {},
          dayNotes: {},
        },
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(true);
      expect(validation.warnings).toContain(
        `Schema version mismatch: expected ${EXPORT_SCHEMA_VERSION}, got 99.0.0`,
      );
    });

    it("should detect mismatched moment IDs", () => {
      const invalidData: ZenborgExportData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          moments: {
            "moment-1": {
              ...sampleMoments["moment-1"],
              id: "different-id", // Mismatched ID
            },
          },
          areas: sampleAreas,
          habits: {},
          cycles: {},
          cyclePlans: {},
          phaseConfigs: {},
          metricLogs: {},
          dayNotes: {},
        },
        metadata: {
          totalMoments: 1,
          totalAreas: 2,
          totalHabits: 0,
          totalCycles: 0,
          totalCyclePlans: 0,
          totalPhaseConfigs: 0,
          totalMetricLogs: 0,
          totalDayNotes: 0,
        },
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("mismatched ID"))).toBe(
        true,
      );
    });

    it("should warn about missing area references", () => {
      const invalidData: ZenborgExportData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          moments: {
            "moment-1": {
              ...sampleMoments["moment-1"],
              areaId: "non-existent-area",
            },
          },
          areas: sampleAreas,
          habits: {},
          cycles: {},
          cyclePlans: {},
          phaseConfigs: {},
          metricLogs: {},
          dayNotes: {},
        },
        metadata: {
          totalMoments: 1,
          totalAreas: 2,
          totalHabits: 0,
          totalCycles: 0,
          totalCyclePlans: 0,
          totalPhaseConfigs: 0,
          totalMetricLogs: 0,
          totalDayNotes: 0,
        },
      };

      const validation = validateImportData(invalidData);

      expect(validation.valid).toBe(true);
      expect(
        validation.warnings.some((w) => w.includes("non-existent area")),
      ).toBe(true);
    });
  });

  describe("importDataWithStrategy - replace", () => {
    it("should replace all data", () => {
      const exportedData = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      const existingData = {
        moments: {
          "old-moment": {
            id: "old-moment",
            name: "Old Moment",
            areaId: "old-area",
            habitId: null,
            cycleId: null,
            cyclePlanId: null,
            phase: null,
            day: null,
            order: 0,
            tags: null,
            emoji: null,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        } as Record<string, Moment>,
        areas: {} as Record<string, Area>,
        habits: {} as Record<string, Habit>,
        cycles: {} as Record<string, Cycle>,
        cyclePlans: {} as Record<string, CyclePlan>,
        phaseConfigs: {} as Record<string, PhaseConfig>,
        metricLogs: {} as Record<string, MetricLog>,
        dayNotes: {} as Record<string, DayNote>,
      };

      const { moments, areas, cycles, phaseConfigs, result } =
        importDataWithStrategy(exportedData, "replace", existingData);

      expect(result.success).toBe(true);
      expect(moments).toEqual(sampleMoments);
      expect(areas).toEqual(sampleAreas);
      expect(cycles).toEqual(sampleCycles);
      expect(phaseConfigs).toEqual(samplePhaseConfigs);
      expect(moments["old-moment"]).toBeUndefined();
    });

    it("should report correct import counts for replace", () => {
      const exportedData = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      const existingData = {
        moments: {},
        areas: {},
        habits: {},
        cycles: {},
        cyclePlans: {},
        phaseConfigs: {},
        metricLogs: {},
        dayNotes: {},
      };

      const { result } = importDataWithStrategy(
        exportedData,
        "replace",
        existingData,
      );

      expect(result.imported.moments).toBe(2);
      expect(result.imported.areas).toBe(2);
      expect(result.imported.cycles).toBe(1);
      expect(result.imported.phaseConfigs).toBe(1);
    });
  });

  describe("importDataWithStrategy - merge", () => {
    it("should merge data without conflicts", () => {
      const newMoment: Moment = {
        id: "moment-3",
        name: "Evening Walk",
        areaId: "area-1",
        habitId: null,
        cycleId: null,
        cyclePlanId: null,
        phase: "EVENING" as Phase,
        day: "2025-01-15",
        order: 0,
        tags: null,
        createdAt: "2025-01-15T18:00:00.000Z",
        updatedAt: "2025-01-15T18:00:00.000Z",
      };

      const exportedData = exportData(
        { "moment-3": newMoment },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
      );

      const existingData = {
        moments: sampleMoments,
        areas: sampleAreas,
        habits: sampleHabits,
        cycles: sampleCycles,
        cyclePlans: sampleCyclePlans,
        phaseConfigs: samplePhaseConfigs,
        metricLogs: sampleMetricLogs,
        dayNotes: {},
      };

      const { moments, result } = importDataWithStrategy(
        exportedData,
        "merge",
        existingData,
      );

      expect(result.success).toBe(true);
      expect(Object.keys(moments)).toHaveLength(3);
      expect(moments["moment-1"]).toEqual(sampleMoments["moment-1"]);
      expect(moments["moment-2"]).toEqual(sampleMoments["moment-2"]);
      expect(moments["moment-3"]).toEqual(newMoment);
      expect(result.message).toContain("no conflicts");
    });

    it("should detect and handle conflicts", () => {
      const updatedMoment: Moment = {
        ...sampleMoments["moment-1"],
        name: "Updated Morning Run",
      };

      const exportedData = exportData(
        { "moment-1": updatedMoment },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
      );

      const existingData = {
        moments: sampleMoments,
        areas: sampleAreas,
        habits: sampleHabits,
        cycles: sampleCycles,
        cyclePlans: sampleCyclePlans,
        phaseConfigs: samplePhaseConfigs,
        metricLogs: sampleMetricLogs,
        dayNotes: {},
      };

      const { moments, result } = importDataWithStrategy(
        exportedData,
        "merge",
        existingData,
      );

      expect(result.success).toBe(true);
      expect(moments["moment-1"].name).toBe("Updated Morning Run");
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts?.moments).toContain("moment-1");
      expect(result.message).toContain("1 conflicts");
    });

    it("should preserve existing data when merging", () => {
      const exportedData = exportData({}, {}, {}, {}, {}, {}, {}, {});

      const existingData = {
        moments: sampleMoments,
        areas: sampleAreas,
        habits: sampleHabits,
        cycles: sampleCycles,
        cyclePlans: sampleCyclePlans,
        phaseConfigs: samplePhaseConfigs,
        metricLogs: sampleMetricLogs,
        dayNotes: {},
      };

      const { moments, areas, cycles, phaseConfigs } = importDataWithStrategy(
        exportedData,
        "merge",
        existingData,
      );

      expect(moments).toEqual(sampleMoments);
      expect(areas).toEqual(sampleAreas);
      expect(cycles).toEqual(sampleCycles);
      expect(phaseConfigs).toEqual(samplePhaseConfigs);
    });

    it("should report conflicts across all entity types", () => {
      const exportedData = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      const existingData = {
        moments: sampleMoments,
        areas: sampleAreas,
        habits: sampleHabits,
        cycles: sampleCycles,
        cyclePlans: sampleCyclePlans,
        phaseConfigs: samplePhaseConfigs,
        metricLogs: sampleMetricLogs,
        dayNotes: {},
      };

      const { result } = importDataWithStrategy(
        exportedData,
        "merge",
        existingData,
      );

      expect(result.success).toBe(true);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts?.moments).toHaveLength(2);
      expect(result.conflicts?.areas).toHaveLength(2);
      expect(result.conflicts?.cycles).toHaveLength(1);
      expect(result.conflicts?.phaseConfigs).toHaveLength(1);
      expect(result.message).toContain("6 conflicts");
    });
  });

  describe("referential integrity", () => {
    it("should validate moment area references", () => {
      const momentWithBadArea: Moment = {
        id: "moment-bad",
        name: "Bad Moment",
        areaId: "non-existent-area",
        habitId: null,
        cycleId: null,
        cyclePlanId: null,
        phase: null,
        day: null,
        order: 0,
        tags: null,
        createdAt: "2025-01-15T08:00:00.000Z",
        updatedAt: "2025-01-15T08:00:00.000Z",
      };

      const exportedData: ZenborgExportData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          moments: { "moment-bad": momentWithBadArea },
          areas: sampleAreas,
          habits: {},
          cycles: {},
          cyclePlans: {},
          phaseConfigs: {},
          metricLogs: {},
          dayNotes: {},
        },
        metadata: {
          totalMoments: 1,
          totalAreas: 2,
          totalHabits: 0,
          totalCycles: 0,
          totalCyclePlans: 0,
          totalPhaseConfigs: 0,
          totalMetricLogs: 0,
          totalDayNotes: 0,
        },
      };

      const validation = validateImportData(exportedData);

      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(
        validation.warnings.some((w) =>
          w.includes("non-existent area non-existent-area"),
        ),
      ).toBe(true);
    });

    it("should allow moments with valid area references", () => {
      const exportedData = exportData(
        sampleMoments,
        sampleAreas,
        sampleHabits,
        sampleCycles,
        sampleCyclePlans,
        samplePhaseConfigs,
        sampleMetricLogs,
        sampleDayNotes,
      );

      const validation = validateImportData(exportedData);

      expect(validation.valid).toBe(true);
      expect(
        validation.warnings.some((w) => w.includes("non-existent area")),
      ).toBe(false);
    });
  });

  describe("incomplete imports (backward compatibility)", () => {
    it("should accept imports missing optional collections", () => {
      // Simulate an old export file that doesn't have habits or metricLogs
      const incompleteData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          moments: sampleMoments,
          areas: sampleAreas,
          cycles: sampleCycles,
          phaseConfigs: samplePhaseConfigs,
          // Missing: habits, metricLogs
        },
        metadata: {
          totalMoments: 2,
          totalAreas: 2,
          totalHabits: 0,
          totalCycles: 1,
          totalCyclePlans: 0,
          totalPhaseConfigs: 1,
          totalMetricLogs: 0,
          totalDayNotes: 0,
        },
      };

      const validation = validateImportData(incompleteData);

      // Should be valid with warnings
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toContain(
        "Missing habits data - will import as empty",
      );
      expect(validation.warnings).toContain(
        "Missing metricLogs data - will import as empty",
      );
    });

    it("should import incomplete data with empty defaults", () => {
      // Simulate an old export file
      const incompleteData: ZenborgExportData = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          moments: sampleMoments,
          areas: sampleAreas,
          cycles: sampleCycles,
          phaseConfigs: samplePhaseConfigs,
          // These will be undefined in the actual import
        } as any,
        metadata: {
          totalMoments: 2,
          totalAreas: 2,
          totalHabits: 0,
          totalCycles: 1,
          totalCyclePlans: 0,
          totalPhaseConfigs: 1,
          totalMetricLogs: 0,
          totalDayNotes: 0,
        },
      };

      const existingData = {
        moments: {},
        areas: {},
        habits: {},
        cycles: {},
        cyclePlans: {},
        phaseConfigs: {},
        metricLogs: {},
        dayNotes: {},
      };

      const {
        moments,
        areas,
        habits,
        cycles,
        phaseConfigs,
        metricLogs,
        result,
      } = importDataWithStrategy(incompleteData, "replace", existingData);

      // Should succeed
      expect(result.success).toBe(true);

      // Core data should be imported
      expect(moments).toEqual(sampleMoments);
      expect(areas).toEqual(sampleAreas);
      expect(cycles).toEqual(sampleCycles);
      expect(phaseConfigs).toEqual(samplePhaseConfigs);

      // Optional collections should be empty objects (not undefined)
      expect(habits).toEqual({});
      expect(metricLogs).toEqual({});

      // Counts should reflect the import
      expect(result.imported.moments).toBe(2);
      expect(result.imported.areas).toBe(2);
      expect(result.imported.habits).toBe(0);
      expect(result.imported.cycles).toBe(1);
      expect(result.imported.phaseConfigs).toBe(1);
      expect(result.imported.metricLogs).toBe(0);
    });

    it("should silently drop legacy crystallizedRoutines field", () => {
      // Old 1.0.0 export files contain a crystallizedRoutines collection.
      // They were never used, so we drop them without migrating or failing.
      const legacyData = {
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        data: {
          moments: sampleMoments,
          areas: sampleAreas,
          habits: sampleHabits,
          cycles: sampleCycles,
          cyclePlans: sampleCyclePlans,
          phaseConfigs: samplePhaseConfigs,
          metricLogs: sampleMetricLogs,
          // Legacy field — should be ignored
          crystallizedRoutines: {
            "routine-1": {
              id: "routine-1",
              name: "Morning Routine",
              areaId: "area-1",
              description: "Automatic morning flow",
              tags: [],
              createdAt: "2025-01-15T08:00:00.000Z",
              updatedAt: "2025-01-15T08:00:00.000Z",
            },
          },
        },
        metadata: {
          totalMoments: 2,
          totalAreas: 2,
          totalHabits: 0,
          totalCycles: 1,
          totalCyclePlans: 0,
          totalPhaseConfigs: 1,
          totalMetricLogs: 0,
          totalDayNotes: 0,
        },
      };

      const validation = validateImportData(legacyData);

      // Legacy files are valid — warning surfaces the dropped field
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toContain(
        "Legacy field 'crystallizedRoutines' will be ignored (removed in schema 1.1.0)",
      );

      const existingData = {
        moments: {},
        areas: {},
        habits: {},
        cycles: {},
        cyclePlans: {},
        phaseConfigs: {},
        metricLogs: {},
        dayNotes: {},
      };

      const imported = importDataWithStrategy(
        legacyData as unknown as ZenborgExportData,
        "replace",
        existingData,
      );

      // Core data lands, legacy field is nowhere in the result
      expect(imported.result.success).toBe(true);
      expect(imported.habits).toEqual({});
      expect("crystallizedRoutines" in imported).toBe(false);
    });
  });
});
