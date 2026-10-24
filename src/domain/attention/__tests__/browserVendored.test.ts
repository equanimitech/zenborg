import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The extension cannot be imported across the package boundary (its dev server
// serves only its own root) and the MCP server cannot import from extension/,
// so the bout methodology lives twice. Pin the copies here, where the
// pre-commit hook runs, so there is still only one methodology.
describe("vendored browser domain", () => {
  const root = join(__dirname, "../../../..");
  for (const file of ["activity.ts", "value-objects.ts", "bouts.ts"]) {
    it(`extension/modules/domain/${file} is byte-identical to src/domain/attention/browser`, () => {
      expect(
        readFileSync(join(root, "extension/modules/domain", file), "utf8"),
      ).toBe(
        readFileSync(join(root, "src/domain/attention/browser", file), "utf8"),
      );
    });
  }
});
