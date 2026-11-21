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
 * A point inside `locator` where the element itself is hit, not a sticky
 * header or tab bar lying over it; searched from its middle outwards.
 */
async function hitPoint(locator: Locator): Promise<{ x: number; y: number }> {
  const point = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    const mid = (top + bottom) / 2;
    for (let d = 0; d <= (bottom - top) / 2; d += 8) {
      for (const y of [mid - d, mid + d]) {
        const hit = document.elementFromPoint(x, y);
        if (hit && el.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("element is covered or outside the window");
  return point;
}

/**
 * Drags `source` onto `target` with the mouse, in small steps. Playwright's
 * `dragTo` jumps to the target in one move; in Electron the browser then
 * sometimes never starts the drag (no `dragstart`), about once in twelve
 * runs. A short first move picks the element up, the rest carries it over.
 * Both ends are brought into view together where they fit, and each is
 * grabbed or hit where nothing lies over it: in a small window (the Windows
 * runner's) the target otherwise ended up under the sticky tab bar.
 */
export async function dragOnto(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  const [a, b] = [await source.boundingBox(), await target.boundingBox()];
  if (a && b) {
    await (a.y <= b.y ? source : target).evaluate((el) =>
      el.scrollIntoView({ block: "start" }),
    );
  }
  await source.scrollIntoViewIfNeeded();
  const start = await hitPoint(source);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 6, { steps: 3 });
  // Measured after the pick-up: the page may have scrolled or re-laid out.
  const to = await hitPoint(target);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
