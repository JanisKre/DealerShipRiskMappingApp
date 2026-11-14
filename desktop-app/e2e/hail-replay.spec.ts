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

async function openDetails(): Promise<void> {
  const toggle = result().getByRole("button", { name: /^Details/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
}

test("storms generated on the portfolio play and reach its locations", async () => {
  // The simulation is a section of the layer panel.
  await page.getByRole("button", { name: /^Ebenen/ }).click();
  await page.getByRole("button", { name: "Hagel-Simulation" }).click();
  await page
    .getByRole("button", { name: "Unwetter auf mein Portfolio" })
    .click();
  // The event card on the map plays the storm.
  await expect(result().getByText(/^Simuliert ·/)).toBeVisible();
  await expect(result().getByRole("button", { name: "Pause" })).toBeVisible();
  await page.waitForTimeout(4_000);
  await shot("hail-sim-portfolio");
  // Aimed at the locations: all three are reached.
  await openDetails();
  await expect(reached().getByRole("button")).toHaveCount(3);
  await shot("hail-sim-details");

  // Saved as a scenario, it appears in the archive.
  await result()
    .getByRole("button", { name: "Als Szenario speichern" })
    .click();
  await expect(
    page.getByText(/„Unwetter auf Portfolio #\d+“ gespeichert\./),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Archiv" }).click();
  await expect(
    page
      .getByTestId("hail-section")
      .getByRole("button", { name: /Unwetter auf Portfolio #\d+/ }),
  ).toBeVisible();
});

test("a drawn track becomes a storm that moves along it", async () => {
  await page.getByRole("radio", { name: "Zeichnen" }).click();
  await page.getByRole("button", { name: "Zugbahn einzeichnen" }).click();
  await expect(page.getByTestId("hail-hint")).toBeVisible();
  const map = page.locator(".leaflet-container");
  const box = (await map.boundingBox())!;
  // Points below the hint card, clear of the pins and the layer panel;
  // a double click finishes.
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.32);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.38);
  await expect(
    page.getByRole("button", { name: "Fertig (2 Punkte)" }),
  ).toBeVisible();
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.44);
  await expect(result().getByText(/^Gezeichnet ·/)).toBeVisible();
  await page.waitForTimeout(2_000);
  await shot("hail-sim-drawn");
});

test("an imported storm reaches the locations on its path and can be dragged off them", async () => {
  await page.getByRole("radio", { name: "Archiv" }).click();
  await page.locator('input[type="file"][accept*="geojson"]').setInputFiles({
    name: "Teststurm.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(footprint()),
  });
  await expect(page.getByText("„Teststurm“ importiert.")).toBeVisible();
  await openDetails();

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
  // It plays to the end.
  await expect(
    result().getByRole("button", { name: "Von vorn abspielen" }),
  ).toBeVisible({ timeout: 30_000 });
  await shot("hail-replay-done");

  // Dragging the handle south takes the storm off both sites; the card says
  // how close it came, and "reset" brings it back.
  const handle = page.locator(".leaflet-marker-draggable");
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 150, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(reached()).toHaveCount(0);
  await expect(result().getByText(/Kein Standort getroffen/)).toBeVisible();
  await expect(result().getByText(/^Verschoben:/)).toBeVisible();
  await shot("hail-replay-shifted");
  await result().getByRole("button", { name: "Zurück" }).click();
  await expect(reached().getByRole("button")).toHaveCount(2);
});
