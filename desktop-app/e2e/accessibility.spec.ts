import { readFileSync } from "node:fs";
import type { AxeResults, RunOptions } from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";

/**
 * Automated accessibility check (axe-core) of every page against WCAG 2.2
 * level A and AA. It catches what can be checked mechanically (names, roles,
 * contrast, landmarks, ARIA use); keyboard flows and screen-reader wording
 * still need a manual review, see docs/accessibility.md.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// axe-core is injected through the DevTools protocol (page.evaluate), which
// the app's Content Security Policy does not block; @axe-core/playwright
// needs a second page that Electron cannot open.
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

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

async function seriousViolations(context: string): Promise<string[]> {
  if (!(await page.evaluate(() => "axe" in window))) {
    await page.evaluate(AXE_SOURCE);
  }
  const options: RunOptions = {
    runOnly: { type: "tag", values: WCAG_TAGS },
  };
  const result = await page.evaluate(
    (opts) =>
      (
        window as unknown as {
          axe: {
            run: (context: unknown, options: unknown) => Promise<AxeResults>;
          };
        }
      ).axe.run(
        // Map tiles come from third-party servers; their markup is Leaflet's.
        { exclude: [[".leaflet-tile-pane"]] },
        opts,
      ),
    options,
  );
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${context}: ${v.id} (${v.impact}) – ${v.help}\n    ${v.nodes
          .slice(0, 5)
          .map(
            (n) =>
              `${n.target.join(" ")}\n      ${n.html.slice(0, 160)}\n      ${(
                n.failureSummary ?? ""
              )
                .split("\n")
                .slice(1, 2)
                .join("")
                .trim()}`,
          )
          .join("\n    ")}`,
    );
}

for (const theme of ["light", "dark"] as const) {
  test(`pages have no serious WCAG 2.2 AA violations (${theme})`, async () => {
    // The default theme follows the system setting. Reduced motion ends the
    // colour transitions at once, so contrast is measured on final colours.
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
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
