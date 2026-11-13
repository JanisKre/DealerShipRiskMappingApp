import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

/** Starts the built app on a temporary profile (see DRM_E2E_USER_DATA). */
export async function launchApp(): Promise<LaunchedApp> {
  const userData = mkdtempSync(join(tmpdir(), "drm-e2e-"));
  const args = ["out/main/index.cjs", "--disable-gpu"];
  // GitHub's Linux runners lack the setuid chrome-sandbox helper (see the
  // smoke test); packaged builds keep the sandbox.
  if (process.platform === "linux" && process.env.CI) args.push("--no-sandbox");
  // ELECTRON_RUN_AS_NODE would start Node instead of the app; the renderer
  // URL would point the build at a dev server.
  const env = Object.fromEntries(
    Object.entries({ ...process.env, DRM_E2E_USER_DATA: userData }).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        entry[0] !== "ELECTRON_RUN_AS_NODE" &&
        entry[0] !== "ELECTRON_RENDERER_URL",
    ),
  );
  const app = await electron.launch({ args, env });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return {
    app,
    page,
    close: async () => {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/**
 * Without the detection model (as in CI) the install wizard opens at some
 * point after start-up and hides the rest of the window. It is not under
 * test: close it whenever it shows up before an action or assertion.
 */
export async function dismissModelWizard(page: Page): Promise<void> {
  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "Fahrzeugerkennungsmodell installieren" }),
    async (wizard) => {
      await wizard.getByRole("button", { name: "Schließen" }).click();
    },
  );
}
