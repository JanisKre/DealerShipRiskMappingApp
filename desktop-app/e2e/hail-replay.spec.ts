import { expect, test, type Page } from "@playwright/test";
import type { DrmApi } from "../src/preload";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";

/**
 * Hail event replay end to end: a made-up portfolio near Dresden
 * and an imported GeoJSON footprint of a storm moving east over it. Checks
 * that the event plays, that the locations it reaches are counted as the
 * clock passes them, and that moving the event changes who it reaches.
 * Set DRM_E2E_SCREENSHOTS to a folder to keep screenshots of the replay.
 */

const START = Date.parse("2024-06-20T14:00:00Z");
const STEP = 5 * 60 * 1000;

/** A storm moving east along 51.02° N, 10 steps of 5 minutes. */
function footprint(): string {
  const features = Array.from({ length: 10 }, (_, i) => {
    const lon = 12.8 + 0.05 * i;
    const lat = 51.02;
    const h = 0.03;
    return {
      type: "Feature",
      properties: {
        time: new Date(START + i * STEP).toISOString(),
        track: "a",
        hail_size_cm: i >= 4 && i <= 6 ? 4 : 2,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon - h, lat - h],
            [lon + h, lat - h],
            [lon + h, lat + h],
            [lon - h, lat + h],
            [lon - h, lat - h],
          ],
        ],
      },
    };
  });
  return JSON.stringify({ type: "FeatureCollection", features });
}

function site(id: string, name: string, lat: number, lon: number): unknown {
  return {
    id,
    name,
    lat,
    lon,
    hailZone: 3,
    insured: true,
    detection: { vehicleCount: 100, confidence: 0.8, model: "yolo" },
    risk: {
      overallScore: 40,
      perils: [],
      eal: 1_000,
      exposureEur: 2_000_000,
      computedAt: "2026-11-14T00:00:00Z",
    },
  };
}

let launched: LaunchedApp;
let page: Page;

async function shot(name: string): Promise<void> {
  const dir = process.env.DRM_E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  // A desktop-sized window, so the map is wider than the hail panel.
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000),
  );
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.evaluate(
    async (dealerships) => {
      const api = (window as unknown as { api: DrmApi }).api;
      await api.saveSession({
        id: "e2e-hail",
        name: "Hagel-Testportfolio",
        createdAt: "2026-11-14T00:00:00Z",
        updatedAt: "2026-11-14T00:00:00Z",
        dealerships,
      } as never);
    },
    [
      site("w", "Autohaus West", 51.02, 12.85),
      site("e", "Autohaus Ost", 51.02, 13.2),
      site("n", "Autohaus Nord", 51.3, 13.0),
    ],
  );
  await page.reload();
  await dismissModelWizard(page);
});

test.afterAll(async () => {
  await launched?.close();
});

const result = (): ReturnType<Page["getByTestId"]> =>
  page.getByTestId("hail-result");
const reached = (): ReturnType<Page["getByRole"]> =>
  page.getByRole("list", { name: "Erreichte Standorte" });

test("storms generated on the portfolio play and reach its locations", async () => {
  await page.getByRole("button", { name: "Hagel-Simulation" }).click();
  await expect(page.getByTestId("hail-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "Unwetter auf mein Portfolio" })
    .click();
  // The replay runs with the panel folded to the player and key figures.
  await expect(result().getByText(/^Simuliert ·/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Archiv" })).toHaveCount(0);
  await page.waitForTimeout(4_000);
  await shot("hail-sim-portfolio");
  // Unfolded: aimed at the locations, all three are reached.
  await page
    .getByTestId("hail-panel")
    .getByRole("button", { name: "Ausklappen" })
    .click();
  await expect(reached().getByRole("button")).toHaveCount(3);

  // Saved as a scenario, it appears in the archive tab.
  await page.getByRole("button", { name: "Als Szenario speichern" }).click();
  await expect(
    page.getByText(/„Unwetter auf Portfolio #\d+“ gespeichert\./),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Archiv" }).click();
  await expect(
    page.getByRole("button", { name: /Unwetter auf Portfolio #\d+/ }),
  ).toBeVisible();
});

test("a drawn track becomes a storm that moves along it", async () => {
  await page.getByRole("tab", { name: "Zeichnen" }).click();
  await page.getByRole("button", { name: "Zugbahn einzeichnen" }).click();
  const map = page.locator(".leaflet-container");
  const box = (await map.boundingBox())!;
  // The panel shrinks to a strip; points in the free lower half of the map,
  // a double click on the last one finishes.
  const x = box.x + box.width * 0.3;
  await page.mouse.click(x, box.y + box.height * 0.5);
  await page.mouse.click(x + 60, box.y + box.height * 0.6);
  await expect(
    page.getByRole("button", { name: "Fertig (2 Punkte)" }),
  ).toBeVisible();
  await page.mouse.dblclick(x + 120, box.y + box.height * 0.7);
  await expect(result().getByText(/^Gezeichnet ·/)).toBeVisible();
  await page.waitForTimeout(2_000);
  await shot("hail-sim-drawn");
  await page
    .getByTestId("hail-panel")
    .getByRole("button", { name: "Ausklappen" })
    .click();
});

test("an imported storm reaches the locations on its path and can be moved off them", async () => {
  await page.getByRole("tab", { name: "Archiv" }).click();
  await page.locator('input[type="file"][accept*="geojson"]').setInputFiles({
    name: "Teststurm.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(footprint()),
  });
  await expect(page.getByText("„Teststurm“ importiert.")).toBeVisible();
  await page
    .getByTestId("hail-panel")
    .getByRole("button", { name: "Ausklappen" })
    .click();

  // West and east lie on the path, north does not.
  await expect(
    reached().getByRole("button", { name: /Autohaus West/ }),
  ).toBeVisible();
  await expect(
    reached().getByRole("button", { name: /Autohaus Ost/ }),
  ).toBeVisible();
  await expect(
    reached().getByRole("button", { name: /Autohaus Nord/ }),
  ).toHaveCount(0);

  // Playing it reaches both, one after the other.
  await expect(page.getByText(/^Bisher 2 Standorte/)).toBeVisible({
    timeout: 20_000,
  });
  await shot("hail-replay-done");

  // 10 km south takes the storm off both sites; the panel says how close it came.
  await page.getByLabel(/Nord\/Süd/).fill("-10");
  await expect(reached()).toHaveCount(0);
  await expect(result().getByText(/Kein Standort getroffen/)).toBeVisible();
  // A wider reach brings the sites back.
  await page.getByLabel(/Wirkradius/).fill("10");
  await expect(reached().getByRole("button")).toHaveCount(2);
  await shot("hail-replay-shifted");
});
