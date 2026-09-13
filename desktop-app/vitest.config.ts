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
      thresholds: {
        lines: 50,
        functions: 45,
        statements: 48,
        branches: 35,
      },
    },
  },
});
