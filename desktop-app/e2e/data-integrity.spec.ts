import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { DrmApi } from "../src/preload";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";

/**
 * Data integrity across a restart (UW-09) and import row accounting
 * (UW-07): a saved state ("Stand speichern") must never come back as the
 * active portfolio, and every ticked import row must be visible — on the
 * map list or as "not on the map yet" — instead of vanishing.
 */

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

const profile = mkdtempSync(join(tmpdir(), "drm-e2e-integrity-"));
let launched: LaunchedApp | undefined;

async function start(): Promise<Page> {
  launched = await launchApp({ userData: profile });
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000),
  );
  const page = launched.page;
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  return page;
}

test.afterAll(async () => {
  await launched?.close();
  rmSync(profile, { recursive: true, force: true });
});

test("a saved state never opens as the active portfolio after a restart", async () => {
  let page = await start();
  await page.evaluate(
    async (dealerships) => {
      const api = (window as unknown as { api: DrmApi }).api;
      await api.saveSession({
        id: "e2e-live",
        name: "Live-Portfolio",
        createdAt: "2026-11-14T00:00:00Z",
        updatedAt: "2026-11-14T00:00:00Z",
        dealerships,
      } as never);
    },
    [
      site("a", "Autohaus A", 51.05, 13.74),
      site("b", "Autohaus B", 51.1, 13.8),
    ],
  );
  await page.reload();
  await dismissModelWizard(page);
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  // Rarely used actions sit in the "…" menu since the November UX review.
  await page.getByRole("button", { name: "Weitere Aktionen" }).first().click();
  await page.getByRole("menuitem", { name: "Stand speichern" }).click();
  await expect(
    page.getByText(/Live-Portfolio – Stand .* gespeichert/),
  ).toBeVisible();

  await launched?.close();
  page = await start();
  const trigger = page.getByTitle(/^Portfolio wechseln/);
  await expect(trigger).toContainText("Live-Portfolio");
  await expect(trigger).not.toContainText("– Stand");

  // The saved state is listed apart, marked as such.
  await trigger.click();
  await expect(
    page.getByText("Gespeicherte Stände (Vergleichspunkte)"),
  ).toBeVisible();
  await expect(page.getByText(/Live-Portfolio – Stand/)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("every ticked import row stays visible", async () => {
  const page = launched?.page;
  if (!page) throw new Error("app not running");
  await page.getByRole("link", { name: "Karte" }).first().click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(join(__dirname, "fixtures", "portfolio.csv"));
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("2 von 3 ausgewählt")).toBeVisible();
  await dialog.getByRole("radio", { name: /Neugeschäft/ }).click();
  await dialog.getByRole("button", { name: "2 Standorte importieren" }).click();
  await expect(dialog).toBeHidden();

  // The row with coordinates is on the map list at once; the address-only
  // row is listed as "not on the map yet" until the address search placed
  // it (then it moves into the list). Either way it is visible.
  await expect(page.getByText("Autohaus Beispiel Nord").first()).toBeVisible();
  await expect(page.getByText("Autohaus Beispiel Süd").first()).toBeVisible();
});
