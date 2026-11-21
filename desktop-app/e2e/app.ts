import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

/**
 * Starts the built app on a temporary profile (see DRM_E2E_USER_DATA).
 * With `userData`, it starts on that profile and `close` keeps it, so a test
 * can restart the app on the same data (the caller removes it).
 */
export async function launchApp(
  options: { userData?: string } = {},
): Promise<LaunchedApp> {
  const keepProfile = options.userData != null;
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), "drm-e2e-"));
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
      if (!keepProfile) rmSync(userData, { recursive: true, force: true });
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

/**
 * GitHub's macOS runners deliver Playwright's mouse drags to Electron
 * without effect (no HTML5 `dragstart`, no Leaflet marker drag), while the
 * same tests pass on Linux CI and on a Mac with a display. Mouse-drag
 * checks are skipped there only; keyboard paths are still tested.
 */
export const NO_MOUSE_DRAG =
  process.platform === "darwin" && process.env.CI != null;
export const NO_MOUSE_DRAG_REASON =
  "mouse drags have no effect on GitHub's macOS runners (checked on Linux CI)";

/**
 * Drags `source` onto `target` with the mouse, in small steps. Playwright's
 * `dragTo` jumps to the target in one move; in Electron the browser then
 * sometimes never starts the drag (no `dragstart`), about once in twelve
 * runs. A short first move picks the element up, the rest carries it over.
 */
export async function dragOnto(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  if (!from) throw new Error("drag source is not visible");
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 6, { steps: 3 });
  // Measured after the pick-up: the page may have scrolled or re-laid out.
  const to = await target.boundingBox();
  if (!to) throw new Error("drag target is not visible");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}
