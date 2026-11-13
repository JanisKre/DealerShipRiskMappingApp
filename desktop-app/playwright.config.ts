import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against the built Electron app (`npm run build` first).
 * Each test file launches the app with a fresh, temporary profile.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
