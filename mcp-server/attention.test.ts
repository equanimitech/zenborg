import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { getDayTrace } from "./attention.js";

describe("getDayTrace", () => {
  // Regression: getDayTrace referenced getAttention's local `traceSurfaces`
  // and threw ReferenceError on every call.
  it("runs on an empty vault without throwing", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-trace-"));
    const result = getDayTrace(vault, {}, {}, {}, { day: "2026-09-23" });
    expect(result.coverage.map((c) => c.surface)).toEqual(["desktop", "agent", "browser"]);
  });
});
