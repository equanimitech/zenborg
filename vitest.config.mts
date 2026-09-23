import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "mcp-server/**/*.test.ts",
      // The composition edge. `scripts/` is where one person's ids and lists
      // live so the domain does not have to hold them, which makes it exactly
      // the place that needs a test rather than exactly the place without one.
      "scripts/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/domain/**/*.ts"],
      exclude: [
        "node_modules/",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "**/*.d.ts",
        "**/*.config.*",
      ],
    },
  },
  // Match Next's automatic JSX runtime, so components need no `import React`.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
