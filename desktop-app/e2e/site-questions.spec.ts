import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import type { DrmApi } from "../src/preload";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";
import { analysedPortfolio, seedPortfolio } from "./portfolio";

/**
 * Site questions end to end: answered by hand in the detail dialog, read
 * by the dashboard filter, and the settings for a local open model. A
 * stand-in Ollama on a free port of this computer answers `/api/tags`,
 * `/api/pull` and `/v1/systemone`, so nothing leaves the machine and no
 * real model is needed.
 */

type Site = { id: string; name: string; risk: { eal: number } };
const SITES = analysedPortfolio(3) as Site[];
const top = [...SITES].sort((a, b) => b.risk.eal - a.risk.eal)[0];

let launched: LaunchedApp;
let page: Page;
let ollama: Server;
let ollamaUrl = "";
const requests: Array<{ path: string; body: unknown }> = [];
let installed = ["llama3.2:latest"];

function startOllama(): Promise<void> {
  ollama = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      requests.push({ path: req.url ?? "", body });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/tags") {
        res.end(
          JSON.stringify({ models: installed.map((name) => ({ name })) }),
        );
      } else if (req.url === "/api/pull") {
        installed = [...installed, String(body?.model)];
        res.end(
          `${JSON.stringify({ status: "pulling manifest" })}\n${JSON.stringify({ status: "success" })}\n`,
        );
      } else if (req.url === "/v1/systemone") {
        res.end(
          JSON.stringify({
            model: body?.model,
            answers: { test: { type: "noul", noul: 0.97 } },
            usage: { output_tokens: 0 },
          }),
        );
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  return new Promise((resolve) => {
    ollama.listen(0, "127.0.0.1", () => {
      ollamaUrl = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

test.beforeAll(async () => {
  await startOllama();
  launched = await launchApp();
  page = launched.page;
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000),
  );
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await seedPortfolio(page, SITES);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test.afterAll(async () => {
  await launched?.close();
  ollama?.close();
});

test("answers given by hand are kept, shown with their source and filtered on", async () => {
  await page.getByRole("link", { name: "Dashboard" }).first().click();
  await page
    .getByRole("button", { name: `Details zu ${top.name} öffnen` })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Gelände & Fahrzeuge" }).click();
  const section = dialog.locator("details", { hasText: "Standort-Fragen" });
  await section.locator("summary").click();
  await expect(section).toContainText("0 von 7 beantwortet");
  // Without an AI provider there is no model button, only the checklist.
  await expect(section.getByRole("button", { name: /prüfen/ })).toHaveCount(0);

  await section
    .getByRole("combobox", {
      name: "Antwort auf: Sind Hagelnetze über Stellflächen gespannt?",
    })
    .click();
  await page.getByRole("option", { name: "ja", exact: true }).click();
  await expect(section).toContainText("1 von 7 beantwortet");
  await expect(section).toContainText("Underwriter,");

  // A dealer's statement does not override the underwriter's answer.
  await section.getByRole("combobox", { name: "Angaben von" }).click();
  await page.getByRole("option", { name: "Händler (laut Auskunft)" }).click();
  await section
    .getByRole("combobox", {
      name: "Antwort auf: Sind Hagelnetze über Stellflächen gespannt?",
    })
    .click();
  await page.getByRole("option", { name: "nein", exact: true }).click();
  await expect(section).toContainText("1 von 7 beantwortet");

  const stored = await page.evaluate(async () => {
    const api = (window as unknown as { api: DrmApi }).api;
    const session = await api.loadSession("e2e-portfolio");
    return session?.dealerships.flatMap((d) =>
      (d.siteAnswers ?? []).map(
        (a) => `${d.id}:${a.question}:${a.source}:${a.value}`,
      ),
    );
  });
  expect(stored).toEqual(
    expect.arrayContaining([
      `${top.id}:hailNet:underwriter:yes`,
      `${top.id}:hailNet:dealer:no`,
    ]),
  );
  await page.keyboard.press("Escape");

  // The dashboard filter counts it as protection seen.
  const filter = page.getByRole("combobox", { name: "Hagelschutz" }).first();
  await filter.click();
  await page.getByRole("option", { name: "Hagelschutz erkennbar (1)" }).click();
  await expect(page.getByText(top.name).first()).toBeVisible();
  const others = SITES.filter((s) => s.id !== top.id);
  await expect(
    page.getByRole("button", { name: `Details zu ${others[0].name} öffnen` }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Filter zurücksetzen" })
    .first()
    .click();
});

test("a local open model is downloaded, chosen and tested without leaving the computer", async () => {
  await page.evaluate(async (url) => {
    const api = (window as unknown as { api: DrmApi }).api;
    await api.setSettings({
      decisions: { engine: "ollama", ollamaBaseUrl: url },
    });
  }, ollamaUrl);
  await page.getByRole("link", { name: "Einstellungen" }).first().click();
  await page.getByRole("tab", { name: /KI/ }).click();
  const card = page
    .locator("[data-slot=card]", {
      hasText: "Standort-Fragen (Decision-Modelle)",
    })
    .first();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Liquid AI d1 2B");
  await expect(card).toContainText("Außerdem installiert: llama3.2:latest");

  await card.getByRole("button", { name: /Laden \(~2 GB\)/ }).click();
  await expect(card.getByText("gewählt")).toBeVisible();
  expect(requests.find((r) => r.path === "/api/pull")?.body).toMatchObject({
    model: "d1:2b",
  });

  await card.getByRole("button", { name: "Verbindung testen" }).click();
  await expect(card).toContainText("Testfrage mit 97 % „ja“ beantwortet");
  const asked = requests.find((r) => r.path === "/v1/systemone");
  expect(asked?.body).toMatchObject({ model: "d1:2b" });
  await expect(card).toContainText("Das Luftbild bleibt auf diesem Computer");

  // A model name that is not on the list cannot be pulled through the app.
  const refused = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const api = (window as unknown as { api: DrmApi }).api;
        api.pullOllamaModel("llama3.2", (chunk) => resolve(chunk.type));
        setTimeout(() => resolve("ignored"), 1_500);
      }),
  );
  expect(refused).toBe("ignored");
  expect(requests.filter((r) => r.path === "/api/pull")).toHaveLength(1);
});
