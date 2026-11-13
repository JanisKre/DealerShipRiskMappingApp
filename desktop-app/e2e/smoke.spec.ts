import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, type LaunchedApp } from "./app";

type Tree = { [key: string]: string | Tree };
function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string"
      ? [path.replace(/_(one|other)$/, "")]
      : keys(value, path);
  });
}
const translationKeys = [
  ...new Set(
    keys(
      JSON.parse(
        readFileSync("src/renderer/src/locales/de.json", "utf8"),
      ) as Tree,
    ),
  ),
].filter((key) => key.split(".").length >= 2);

let launched: LaunchedApp;
let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  // Without the detection model (as in CI) the install wizard opens at some
  // point after start-up and hides the rest of the window. It is not under
  // test: close it whenever it shows up before an action or assertion.
  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "Fahrzeugerkennungsmodell installieren" }),
    async (wizard) => {
      await wizard.getByRole("button", { name: "Schließen" }).click();
    },
  );
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test.afterAll(async () => {
  await launched?.close();
});

/** Visible text must never be a raw translation key or an English sentinel. */
async function expectTranslated(): Promise<void> {
  const text = await page.locator("body").innerText();
  const raw = translationKeys.filter((key) => text.includes(key));
  expect(raw, "untranslated keys on screen").toEqual([]);
  expect(text).not.toContain("New Conversation");
  expect(text).not.toContain("New Portfolio");
  expect(text).not.toContain("ALKIS parcel");
}

test("renderer stays isolated from Node", async () => {
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    api: typeof (window as unknown as { api?: unknown }).api,
  }));
  expect(exposed).toEqual({
    require: "undefined",
    process: "undefined",
    api: "object",
  });
});

test("every page opens translated and without errors", async () => {
  for (const [link, heading] of [
    ["Dashboard", /Dashboard/],
    ["Parameter", /Parameter/],
    ["Einstellungen", /Einstellungen/],
    ["Karte", /Karte/],
  ] as const) {
    await page.getByRole("link", { name: link }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expectTranslated();
  }
  expect(
    consoleErrors.filter((e) => !/net::|Failed to fetch|ERR_/.test(e)),
  ).toEqual([]);
});

test("settings tabs switch", async () => {
  await page.getByRole("link", { name: "Einstellungen" }).first().click();
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  const count = await tabs.count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveAttribute("data-state", "active");
    await expectTranslated();
  }
});

test("import preview lists rows before anything is analysed", async () => {
  await page.getByRole("link", { name: "Karte" }).first().click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(join(__dirname, "fixtures", "portfolio.csv"));

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Portfolio importieren")).toBeVisible();
  await expect(dialog.getByText("Vorschau")).toBeVisible();
  // The nameless row is dropped; the row without address or coordinates
  // stays unticked.
  await expect(dialog.getByText("2 von 3 ausgewählt")).toBeVisible();
  await expect(
    dialog.getByText("Weder Adresse noch Koordinaten"),
  ).toBeVisible();
  // Rows with notes come first; the filter switches to all rows.
  await dialog.getByRole("button", { name: "Nur mit Hinweisen (1)" }).click();
  await expect(dialog.getByText("Koordinaten aus der Datei")).toBeVisible();
  await expect(dialog.getByText("1 Zeile nicht übernommen")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "2 Standort(e) importieren" }),
  ).toBeDisabled();
  await expectTranslated();

  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
});
