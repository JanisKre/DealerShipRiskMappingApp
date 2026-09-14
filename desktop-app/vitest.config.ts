import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@renderer": resolve(__dirname, "src/renderer/src"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      exclude: [
        "src/**/*.d.ts",
        "src/renderer/src/components/ui/**",
        "src/renderer/src/main.tsx",
      ],
      // Raised with the boundary fusion work (measured 70.6/62.2/68.8/59.8).
      // Headroom is deliberate: these are a ratchet against regression, not a
      // target to sit exactly on.
      thresholds: {
        lines: 62,
        functions: 55,
        statements: 61,
        branches: 50,
      },
    },
  },
});
