import { expect, test, type Page } from "@playwright/test";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";
import { seriousViolations as axeViolations } from "./axe";

/**
 * Automated accessibility check (axe-core) of every page against WCAG 2.2
 * level A and AA. It catches what can be checked mechanically (names, roles,
 * contrast, landmarks, ARIA use); keyboard flows and screen-reader wording
 * still need a manual review, see docs/accessibility.md.
 */

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test.afterAll(async () => {
  await launched?.close();
});

const seriousViolations = (context: string): Promise<string[]> =>
  axeViolations(page, context);

for (const theme of ["light", "dark"] as const) {
  test(`pages have no serious WCAG 2.2 AA violations (${theme})`, async () => {
    // The default theme follows the system setting. Reduced motion ends the
    // colour transitions at once, so contrast is measured on final colours.
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    // The app switches its theme class from a matchMedia listener; measure
    // only once that has happened.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        ),
      )
      .toBe(theme === "dark");
    const found: string[] = [];
    for (const [link, heading] of [
      ["Karte", /Karte/],
      ["Dashboard", /Dashboard/],
      ["Parameter", /Parameter/],
      ["Einstellungen", /Einstellungen/],
    ] as const) {
      await page.getByRole("link", { name: link }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      found.push(...(await seriousViolations(`${link} (${theme})`)));
    }
    // Every settings tab, not only the first.
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    for (let i = 1; i < count; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveAttribute("data-state", "active");
      found.push(...(await seriousViolations(`Einstellungen tab ${i + 1}`)));
    }
    expect(found, found.join("\n")).toEqual([]);
  });
}

test("the document language follows the interface language", async () => {
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.getByRole("link", { name: "Einstellungen" }).first().click();
  await page.getByRole("tab").first().click();
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("radio", { name: "Deutsch" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
});
