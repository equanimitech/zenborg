import type { NextConfig } from "next";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT_MODE === "export" ? { output: "export" } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  // Tests import across package boundaries (extension/); the build skips them.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
