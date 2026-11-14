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

test("an imported storm plays over the map and reaches the locations on its path", async () => {
  await page.getByRole("button", { name: /^Ebenen/ }).click();
  await page.getByRole("button", { name: "Hagel-Replay" }).click();
  // The radar archive depends on what DWD has right now; not checked here.

  await page.locator('input[type="file"][accept*="geojson"]').setInputFiles({
    name: "Teststurm.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(footprint()),
  });
  await expect(page.getByText("„Teststurm“ importiert.")).toBeVisible();

  // West and east lie on the path, north does not.
  const panel = page.getByRole("list", { name: "Erreichte Standorte" });
  await expect(page.getByText("2 Standorte", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Autohaus West/ }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Autohaus Ost/ }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Autohaus Nord/ }),
  ).toHaveCount(0);

  // At the start the storm has reached nobody; playing it reaches both.
  await expect(page.getByText(/^0 Standorte erreicht/)).toBeVisible();
  await page.getByRole("button", { name: "Abspielen" }).click();
  await page.waitForTimeout(1_200);
  await shot("hail-replay-playing");
  await expect(page.getByText(/^2 Standorte erreicht/)).toBeVisible({
    timeout: 15_000,
  });
  await shot("hail-replay-done");

  // 30 km south takes the storm off both sites (30 km north would put it
  // over the north site).
  const north = page.getByLabel(/Nord\/Süd/);
  await north.fill("-30");
  await expect(page.getByText("0 Standorte", { exact: true })).toBeVisible();
  await shot("hail-replay-shifted");
});
