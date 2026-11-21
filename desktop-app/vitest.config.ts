import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@renderer": resolve(__dirname, "src/renderer/src"),
      "@studio": resolve(__dirname, "src/studio"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Every source file counts, also those no test loads: without this the
      // figure only described the files that already had tests.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/renderer/src/components/ui/**",
        "src/renderer/src/main.tsx",
        "src/studio/main.tsx",
      ],
      // A ratchet against regression, set just below what was measured over
      // all source files (see the CHANGELOG entry that set them): raise them
      // when coverage rises, never lower them to make a change pass.
      thresholds: {
        lines: 55,
        functions: 42,
        statements: 54,
        branches: 46,
      },
    },
  },
});
