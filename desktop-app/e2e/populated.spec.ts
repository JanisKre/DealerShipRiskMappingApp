import { expect, test, type Page } from "@playwright/test";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";
import { seriousViolations } from "./axe";
import { analysedPortfolio, seedPortfolio } from "./portfolio";

/**
 * The pages with an imported, analysed portfolio: KPIs, charts, the
 * location table, the detail dialog and the map list. The other specs
 * start on an empty app; this one checks that the figures on screen match
 * the stored data, that the main flows work with the keyboard, that no
 * page raises an error, and that axe finds nothing serious on real content.
 */

type Site = {
  name: string;
  detection: { vehicleCount: number };
  risk: { eal: number; exposureEur: number };
};

const SITES = analysedPortfolio(12) as Site[];
const byEal = [...SITES].sort((a, b) => b.risk.eal - a.risk.eal);
const eur = (value: number): string =>
  `${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
const sum = (pick: (s: Site) => number): number =>
  SITES.reduce((total, s) => total + pick(s), 0);

let launched: LaunchedApp;
let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000),
  );
  page.on("pageerror", (error) =>
    pageErrors.push(error.stack ?? String(error)),
  );
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await seedPortfolio(page, SITES);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test.afterAll(async () => {
  await launched?.close();
});

async function openDashboard(): Promise<void> {
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
}

test("the dashboard totals match the stored portfolio", async () => {
  await openDashboard();
  await expect(page.getByText("12 Standorte analysiert")).toBeVisible();
  const kpis = page.getByRole("region", { name: "Portfolio-KPIs" });
  await expect(kpis).toContainText(
    sum((s) => s.detection.vehicleCount).toLocaleString("de-DE"),
  );
  await expect(kpis).toContainText(eur(sum((s) => s.risk.exposureEur)));
  await expect(kpis).toContainText(eur(sum((s) => s.risk.eal)));

  // The ranking starts with the highest hail EAL.
  const top = page.getByRole("region", {
    name: "Top-Standorte nach Hagel-EAL",
  });
  await expect(top.getByRole("listitem").first()).toContainText(byEal[0].name);
  await expect(top.getByRole("listitem").first()).toContainText(
    eur(byEal[0].risk.eal),
  );

  // The zone chart is drawn (one bar group per zone on the axis).
  const zones = page.getByRole("region", { name: "Hagelzonen-Verteilung" });
  await expect(zones.getByRole("application")).toContainText("Zone 6");
});

test("dashboard tiles can be reordered without dragging", async () => {
  await openDashboard();
  const order = (): Promise<string[]> =>
    page
      .locator("section[draggable]")
      .evaluateAll((tiles) =>
        tiles.map((tile) => tile.getAttribute("aria-label") ?? ""),
      );
  const before = await order();
  expect(before.slice(0, 2)).toEqual([
    "Portfolio-KPIs",
    "Hagelzonen-Verteilung",
  ]);
  // Keyboard only: focus the button, press Enter.
  const later = page.getByRole("button", {
    name: "Kachel nach hinten verschieben: Portfolio-KPIs",
  });
  await later.focus();
  await page.keyboard.press("Enter");
  expect((await order()).slice(0, 2)).toEqual([
    "Hagelzonen-Verteilung",
    "Portfolio-KPIs",
  ]);
  const earlier = page.getByRole("button", {
    name: "Kachel nach vorne verschieben: Portfolio-KPIs",
  });
  await earlier.focus();
  await page.keyboard.press("Enter");
  expect(await order()).toEqual(before);
  // The first tile cannot move further up.
  await expect(earlier).toBeDisabled();
});

test("the location table sorts and searches", async () => {
  await openDashboard();
  const table = page.getByRole("region", { name: "Standorttabelle" });
  const rows = table.getByRole("row");
  // Header + one row per location, highest EAL first.
  await expect(rows).toHaveCount(SITES.length + 1);
  await expect(rows.nth(1)).toContainText(byEal[0].name);

  await table.getByRole("button", { name: "Name", exact: true }).click();
  const byName = [...SITES]
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b, "de"));
  const first = await rows.nth(1).innerText();
  expect(
    [byName[0], byName[byName.length - 1]].some((n) => first.includes(n)),
  ).toBe(true);

  await table.getByRole("searchbox").fill("Leipzig");
  await expect(rows).toHaveCount(
    SITES.filter((s) => s.name.includes("Leipzig")).length + 1,
  );
  await table.getByRole("searchbox").fill("");
  await expect(rows).toHaveCount(SITES.length + 1);
});

test("the detail dialog opens, pages and closes with the keyboard", async () => {
  await openDashboard();
  const opener = page.getByRole("button", {
    name: `Details zu ${byEal[0].name} öffnen`,
  });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 2 })).toContainText(
    byEal[0].name,
  );
  await expect(dialog).toContainText(eur(byEal[0].risk.eal));
  await expect(dialog).toContainText("Rang 1 von 12");
  // The EAL stays labelled as a screening estimate.
  await expect(dialog).toContainText("Screening-Schätzung");

  // Every tab renders its panel; arrow keys move between tabs.
  const tabs = dialog.getByRole("tab");
  await tabs.first().focus();
  for (const name of ["Gelände & Fahrzeuge", "Vertrag & Notizen", "Quellen"]) {
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(dialog.getByRole("tabpanel", { name })).toBeVisible();
  }

  // Paging follows the table order, whatever it is sorted by.
  const position = dialog.getByText(/^\d+\/12$/);
  const before = Number((await position.innerText()).split("/")[0]);
  await dialog.getByRole("button", { name: "Nächster Standort" }).click();
  await expect(position).toHaveText(`${(before % 12) + 1}/12`);
  await expect(dialog.getByRole("heading", { level: 2 })).not.toContainText(
    byEal[0].name,
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the map list shows every location and opens its details", async () => {
  await page.getByRole("link", { name: "Karte" }).first().click();
  await expect(
    page.getByRole("button", { name: /Standorte-Liste/ }),
  ).toContainText(new RegExp(`Standorte\\s*\\(${SITES.length}\\)`));
  await page
    .getByRole("button", { name: `Details zu ${byEal[2].name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 2 })).toContainText(
    byEal[2].name,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

for (const theme of ["light", "dark"] as const) {
  test(`pages with data have no serious WCAG 2.2 AA violations (${theme})`, async () => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        ),
      )
      .toBe(theme === "dark");
    const found: string[] = [];

    await page.getByRole("link", { name: "Karte" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Karte");
    found.push(...(await seriousViolations(page, `Karte (${theme})`)));

    await openDashboard();
    found.push(...(await seriousViolations(page, `Dashboard (${theme})`)));

    await page
      .getByRole("button", { name: `Details zu ${byEal[0].name} öffnen` })
      .click();
    const dialog = page.getByRole("dialog");
    const tabs = dialog.getByRole("tab");
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveAttribute("data-state", "active");
      found.push(
        ...(await seriousViolations(page, `Detail tab ${i + 1} (${theme})`)),
      );
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(found, found.join("\n")).toEqual([]);
  });
}

test("no page raised an error or fell back to the error message", async () => {
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
