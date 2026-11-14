import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import type { DrmApi } from "../src/preload";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";

/**
 * AI dashboards end to end, without a real AI provider: a local mock answers
 * like an OpenAI-compatible model (one-word routing, A2UI messages), the
 * portfolio is made up. Checks that the chat builds and changes dashboards,
 * that every figure comes from the app, and how dashboards are switched.
 */

const CATALOG =
  "https://dealership-risk-mapping.app/a2ui/catalogs/dashboard/v1";
const requests: Array<{ system: string; user: string }> = [];

const created = {
  version: "1.0",
  createSurface: {
    surfaceId: "dashboard",
    catalogId: CATALOG,
    metadata: { title: "Standorte ab Zone 4" },
    components: [
      { id: "root", component: "Column", children: ["kpis", "top"] },
      { id: "kpis", component: "Row", children: ["eal", "count"] },
      {
        id: "eal",
        component: "KpiCard",
        title: "Hagel-EAL ab Zone 4",
        value: {
          "@call": "aggregate",
          args: { measure: "eal", filter: { minHailZone: 4 } },
        },
      },
      {
        id: "count",
        component: "KpiCard",
        title: "Standorte ab Zone 4",
        value: {
          "@call": "aggregate",
          args: { measure: "count", filter: { minHailZone: 4 } },
        },
      },
      {
        id: "top",
        component: "BarChart",
        title: "Höchste Hagel-EAL",
        data: { "@call": "ranking", args: { measure: "eal", limit: 5 } },
      },
    ],
  },
};

const addTable = {
  version: "1.0",
  updateComponents: {
    surfaceId: "dashboard",
    components: [
      { id: "root", component: "Column", children: ["kpis", "top", "table"] },
      {
        id: "table",
        component: "Table",
        title: "Top 10 nach Exposure",
        rows: { "@call": "locations", args: { sortBy: "exposure", limit: 10 } },
      },
    ],
  },
};

const zoneTwo = {
  version: "1.0",
  updateComponents: {
    surfaceId: "dashboard",
    title: "Standorte in Zone 2",
    deleteIds: ["count"],
    components: [
      { id: "kpis", component: "Row", children: ["eal"] },
      {
        id: "eal",
        component: "KpiCard",
        title: "Hagel-EAL in Zone 2",
        value: {
          "@call": "aggregate",
          args: { measure: "eal", filter: { minHailZone: 2, maxHailZone: 2 } },
        },
      },
    ],
  },
};

function answer(system: string, user: string): string {
  // The router answers with one word.
  if (system.includes("You route messages")) return "edit";
  if (!system.includes("CHANGE the current dashboard"))
    return JSON.stringify(created);
  return JSON.stringify(/zone 2/i.test(user) ? zoneTwo : addTable);
}

function site(id: string, name: string, zone: number, eal: number): unknown {
  return {
    id,
    name,
    lat: 51 + Number(id) / 100,
    lon: 13,
    hailZone: zone,
    insured: true,
    detection: { vehicleCount: eal / 20, confidence: 0.8, model: "yolo" },
    risk: {
      overallScore: zone * 10,
      perils: [],
      eal,
      exposureEur: eal * 50,
      computedAt: "2026-11-13T00:00:00Z",
    },
  };
}

let server: Server;
let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { messages } = JSON.parse(body) as {
        messages: Array<{ content: string }>;
      };
      const system = messages[0].content;
      const user = messages[1].content;
      requests.push({ system, user });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: answer(system, user) } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  launched = await launchApp();
  page = launched.page;
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.evaluate(
    async ({ baseUrl, dealerships }) => {
      const api = (window as unknown as { api: DrmApi }).api;
      const settings = await api.getSettings();
      await api.setSettings({
        ...settings,
        llm: { provider: "local", model: "mock", baseUrl },
      });
      await api.saveSession({
        id: "e2e",
        name: "Testportfolio",
        createdAt: "2026-11-13T00:00:00Z",
        updatedAt: "2026-11-13T00:00:00Z",
        dealerships,
      } as never);
    },
    {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      dealerships: [
        site("1", "Autohaus Alpha", 5, 1_000),
        site("2", "Autohaus Beta", 4, 400),
        site("3", "Autohaus Gamma", 2, 2_000),
      ],
    },
  );
  // The saved portfolio and the AI settings load on start.
  await page.reload();
  await dismissModelWizard(page);
});

test.afterAll(async () => {
  await launched?.close();
  await new Promise((resolve) => server?.close(resolve));
});

const composer = (): ReturnType<Page["getByPlaceholder"]> =>
  page.getByPlaceholder("Frage an die KI stellen…");

async function ask(text: string): Promise<void> {
  await composer().fill(text);
  await composer().press("Enter");
}

test("the chat builds a dashboard whose figures the app computes", async () => {
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("tab", { name: "Übersicht" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await page.getByRole("button", { name: "KI-Assistent" }).click();
  await ask("Baue mir ein Dashboard zu allen Standorten ab Zone 4");

  await expect(
    page.getByText(/Dashboard „Standorte ab Zone 4“ ist fertig/),
  ).toBeVisible();
  const view = page.getByRole("region", { name: "Standorte ab Zone 4" });
  // 1.000 € + 400 € from zones 5 and 4; Gamma (zone 2) is left out.
  await expect(view.getByText("1.400 €")).toBeVisible();
  await expect(view.getByText("Zone ≥ 4 · 2 Standorte").first()).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Standorte ab Zone 4" }),
  ).toHaveAttribute("data-state", "active");

  // The model got the catalog and the portfolio shape, no figures.
  expect(requests[0].system).toContain(CATALOG);
  expect(requests[0].user).toContain("Portfolio: 3 locations.");
  expect(requests[0].user).not.toContain("1000");
});

test("a follow-up request changes the shown dashboard", async () => {
  await ask("Füge eine Tabelle der Top 10 nach Exposure hinzu");
  await expect(page.getByText(/ist angepasst/)).toBeVisible();
  const table = page
    .getByRole("region", { name: "Standorte ab Zone 4" })
    .getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("row").nth(1)).toContainText("Autohaus Gamma");

  // A row opens the location.
  await table.getByRole("row").nth(1).click();
  await expect(
    page.getByRole("dialog").getByText("Autohaus Gamma").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a bar in a dashboard chart opens its location", async () => {
  // Clicked straight away, without hovering first.
  const view = page.getByRole("region", { name: "Standorte ab Zone 4" });
  await view.locator(".recharts-bar-rectangle").first().click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(/Autohaus (Alpha|Beta|Gamma)/)
      .first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("switching the zone in the chat changes what the dashboard shows", async () => {
  // The wording that used to reach the plain chat instead.
  await ask("Wechsle zu Hagelzone 2");
  await expect(
    page.getByText(/„Standorte in Zone 2“ ist angepasst/),
  ).toBeVisible();
  const view = page.getByRole("region", { name: "Standorte in Zone 2" });
  // Only Gamma (zone 2) is left in the figure.
  await expect(view.getByText("Zone 2 · 1 Standort")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Standorte in Zone 2" }),
  ).toBeVisible();
});

test("an unclear request on an open dashboard is routed by the AI", async () => {
  const before = requests.length;
  await ask("Mach das bitte nochmal für Zone 2");
  await expect(
    page.getByText(/„Standorte in Zone 2“ ist angepasst/).nth(1),
  ).toBeVisible();
  expect(requests[before].system).toContain("You route messages");
  expect(requests[before + 1].system).toContain("CHANGE the current dashboard");
});

test("tabs switch dashboards and offer a new one", async () => {
  await page.getByRole("tab", { name: "Übersicht" }).click();
  await expect(
    page.getByRole("region", { name: "Standorte in Zone 2" }),
  ).toBeHidden();
  await page.getByRole("tab", { name: "Standorte in Zone 2" }).click();
  await expect(
    page.getByRole("region", { name: "Standorte in Zone 2" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Neues Dashboard" }).click();
  await expect(composer()).toHaveValue("Baue mir ein Dashboard zu ");
  await expect(composer()).toBeFocused();
});

test("the portfolio table searches, sorts and opens a location", async () => {
  await page.getByRole("tab", { name: "Übersicht" }).click();
  const table = page
    .getByRole("table")
    .filter({ has: page.getByRole("button", { name: "Name" }) });
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(4); // header + 3 locations

  const search = page.getByLabel("Name, Adresse oder Ort suchen…");
  await search.fill("Beta");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Autohaus Beta");
  await search.fill("");
  await expect(rows).toHaveCount(4);

  const name = table.getByRole("button", { name: "Name" });
  await name.click();
  await expect(rows.nth(1)).toContainText("Autohaus Alpha");
  await name.click();
  await expect(rows.nth(1)).toContainText("Autohaus Gamma");

  await rows.nth(1).click();
  await expect(
    page.getByRole("dialog").getByText("Autohaus Gamma").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("tiles of the overview move by drag and drop", async () => {
  await page.getByRole("tab", { name: "Übersicht" }).click();
  const tiles = page.locator("section[draggable=true]");
  const labels = (): Promise<string[]> =>
    tiles.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? ""),
    );
  const before = await labels();
  expect(before.length).toBeGreaterThan(2);
  await tiles.nth(1).dragTo(tiles.nth(0));
  await expect.poll(labels).toEqual([before[1], before[0], ...before.slice(2)]);
  await tiles.nth(1).dragTo(tiles.nth(0));
  await expect.poll(labels).toEqual(before);
});

// Last: it reloads the window, which closes the assistant.
test("parts of an AI dashboard move by drag and drop and stay moved", async () => {
  await page.getByRole("tab", { name: "Standorte in Zone 2" }).click();
  const view = page.getByRole("region", { name: "Standorte in Zone 2" });
  const part = (id: string): ReturnType<Page["locator"]> =>
    view.locator(`[data-a2ui-part="${id}"]`);
  const order = (): Promise<string[]> =>
    view
      .locator("[data-a2ui-part]")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-a2ui-part") ?? ""),
      );
  await expect.poll(order).toEqual(["kpis", "eal", "top", "table"]);

  // Dropped on the key figure, the table takes the place of its whole row.
  await part("table").dragTo(part("eal"));
  await expect.poll(order).toEqual(["table", "kpis", "eal", "top"]);
  await part("top").dragTo(part("table"));
  await expect.poll(order).toEqual(["top", "table", "kpis", "eal"]);

  // The order is saved with the dashboard.
  await page.reload();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("tab", { name: "Standorte in Zone 2" }).click();
  await expect.poll(order).toEqual(["top", "table", "kpis", "eal"]);
});

test("a key figure dragged out of a four-up row can be dragged back", async () => {
  await page.evaluate(async (catalogId) => {
    const api = (window as unknown as { api: DrmApi }).api;
    await api.saveDashboard({
      id: "four-up",
      name: "Vier Kennzahlen",
      createdAt: "2026-11-13T00:00:00Z",
      updatedAt: "2026-11-13T00:00:00Z",
      prompt: "Vier Kennzahlen",
      surface: {
        surfaceId: "four-up",
        catalogId,
        title: "Vier Kennzahlen",
        components: [
          { id: "root", component: "Column", children: ["kpis", "top"] },
          {
            id: "kpis",
            component: "Row",
            children: ["k1", "k2", "k3", "k4"],
          },
          ...["k1", "k2", "k3", "k4"].map((id, i) => ({
            id,
            component: "KpiCard",
            title: `Kennzahl ${i + 1}`,
            value: { "@call": "aggregate", args: { measure: "count" } },
          })),
          {
            id: "top",
            component: "BarChart",
            title: "Höchste Hagel-EAL",
            data: { "@call": "ranking", args: { measure: "eal", limit: 5 } },
          },
        ],
      },
    } as never);
  }, CATALOG);
  await page.reload();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("tab", { name: "Vier Kennzahlen" }).click();
  const view = page.getByRole("region", { name: "Vier Kennzahlen" });
  const part = (id: string): ReturnType<Page["locator"]> =>
    view.locator(`[data-a2ui-part="${id}"]`);
  const row = (): Promise<string[]> =>
    part("kpis")
      .locator("[data-a2ui-part]")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-a2ui-part") ?? ""),
      );
  await expect.poll(row).toEqual(["k1", "k2", "k3", "k4"]);

  // Out of the row: the card stands in a row of its own below.
  await part("k2").dragTo(part("top"));
  await expect.poll(row).toEqual(["k1", "k3", "k4"]);
  await expect(part("k2")).toBeVisible();

  // And back in, in front of the card it is dropped on.
  await part("k2").dragTo(part("k3"));
  await expect.poll(row).toEqual(["k1", "k2", "k3", "k4"]);

  await page.reload();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("tab", { name: "Vier Kennzahlen" }).click();
  await expect.poll(row).toEqual(["k1", "k2", "k3", "k4"]);
});

test("the detail dialog lists questions for the dealership by rule", async () => {
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("tab", { name: "Übersicht" }).click();
  const table = page
    .getByRole("table")
    .filter({ has: page.getByRole("button", { name: "Name" }) });
  await table.getByRole("row").filter({ hasText: "Autohaus Alpha" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Vertrag & Notizen" }).click();
  await dialog.getByText("Rückfragen an den Händler").click();
  // Zone 5: the season and hail-warning questions apply.
  await expect(dialog.getByText(/liegt in Hagelzone 5/)).toBeVisible();
  await expect(dialog.getByText(/Unwetter- oder Hagelwarnung/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Als Text kopieren" }),
  ).toBeVisible();
  // With an AI provider the optional rewording is offered.
  await expect(
    dialog.getByRole("button", { name: "Als Nachricht formulieren" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
