import { expect, test, type Page } from "@playwright/test";
import type { DrmApi } from "../src/preload";
import { dismissModelWizard, launchApp, type LaunchedApp } from "./app";

/**
 * Optional AI features against a real model. Skipped unless
 * DRM_E2E_LLM_BASE_URL points at an OpenAI-compatible endpoint on this
 * computer (Ollama, LM Studio, llama.cpp or a local bridge) and
 * DRM_E2E_LLM_MODEL names a model; the image checks also need
 * DRM_E2E_LLM_VISION=1 (a vision model) and internet access for the aerial
 * imagery. The assertions check what the app guarantees whatever the model
 * writes; the model's own output is printed for review.
 */

const BASE_URL = process.env.DRM_E2E_LLM_BASE_URL;
const MODEL = process.env.DRM_E2E_LLM_MODEL;
const VISION = process.env.DRM_E2E_LLM_VISION === "1";

test.skip(!BASE_URL || !MODEL, "no local AI endpoint configured");
test.describe.configure({ timeout: 400_000 });

/**
 * Point the image checks look at. The default is merely a place in Dresden
 * with sharp aerial imagery, not a dealership (a vision model says so); set
 * DRM_E2E_SITE_LAT / DRM_E2E_SITE_LON to a real lot to judge the answers.
 */
const LAT = Number(process.env.DRM_E2E_SITE_LAT ?? 51.0123);
const LON = Number(process.env.DRM_E2E_SITE_LON ?? 13.7903);

const dealership = {
  id: "live",
  name: "Autohaus Beispiel",
  address: "Dohnaer Straße 99, 01219 Dresden",
  notes: "LIVE-GEHEIM",
  lat: LAT,
  lon: LON,
  hailZone: 4,
  deductibleEur: 1000,
  detection: { vehicleCount: 120, confidence: 0.82, model: "yolo" },
  risk: {
    overallScore: 60,
    perils: [],
    eal: 4812,
    exposureEur: 3_600_000,
    ealBreakdown: {
      hail: 4812,
      total: 4812,
      hailDetail: {
        vehicles: 120,
        exposedVehicles: 120,
        vehicleSource: "detected",
        zone: 4,
        zoneSource: "postcode",
        frequency: 0.1,
        meanSeverityEur: 401,
      },
    },
    computedAt: "2026-10-01T00:00:00Z",
  },
};

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  await dismissModelWizard(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await page.evaluate(
    async ({ baseUrl, model }) => {
      const api = (window as unknown as { api: DrmApi }).api;
      await api.setSettings({
        language: "de",
        llm: { provider: "local", model, baseUrl },
      });
    },
    { baseUrl: BASE_URL!, model: MODEL! },
  );
});

test.afterAll(async () => {
  await launched?.close();
});

test("memo with checked figures: only the app's numbers survive", async () => {
  const memo = await page.evaluate(async (d) => {
    const api = (window as unknown as { api: DrmApi }).api;
    return api.writeEvidenceMemo({ dealership: d as never });
  }, dealership);
  console.log("MEMO", JSON.stringify(memo, null, 2));
  expect(memo.sentences.length).toBeGreaterThan(0);
  const allowed = ["120", "4", "0,1", "0.1", "401", "4812", "4.812", "4,812"];
  for (const sentence of memo.sentences) {
    expect(sentence.text).not.toContain("LIVE-GEHEIM");
    // Whatever digits a kept sentence has belong to a fact of the app.
    for (const number of sentence.text.match(/\d[\d.,]*\d|\d/g) ?? []) {
      const plain = number.replace(/[.,]$/, "");
      expect(
        allowed.includes(plain) ||
          [
            "1000",
            "1.000",
            "1,000",
            "3600000",
            "3.600.000",
            "3,600,000",
            "2026",
            "10",
            "01",
            "1",
          ].includes(plain),
        `unexpected number ${number} in: ${sentence.text}`,
      ).toBe(true);
    }
  }
});

test("dealership reply: every shown answer is quoted from the reply", async () => {
  const reply =
    "Sehr geehrte Damen und Herren,\nwir haben seit 2023 Hagelnetze über 80 Stellplätzen auf dem Gebrauchtwagenplatz. In der Halle können wir etwa 25 Fahrzeuge unterstellen. Hagelschäden hatten wir zuletzt im Juni 2021, damals rund 40 Fahrzeuge.\nMit freundlichen Grüßen";
  const { answers } = await page.evaluate(async (text) => {
    const api = (window as unknown as { api: DrmApi }).api;
    return api.extractQuestionnaireAnswers({
      questions: [
        {
          id: "hailProtection",
          text: "Gibt es auf dem Gelände Hagelschutz (Hagelnetze, Überdachungen)? Wenn ja: für wie viele Stellplätze?",
        },
        {
          id: "coveredSpaces",
          text: "Wie viele Fahrzeuge können in Hallen, Werkstatt oder Tiefgarage untergestellt werden?",
        },
        {
          id: "outdoorAtNight",
          text: "Wie viele Fahrzeuge stehen nachts und am Wochenende üblicherweise im Freien?",
        },
        {
          id: "pastLosses",
          text: "Gab es in den letzten 5 Jahren Hagelschäden am Fahrzeugbestand?",
        },
      ],
      reply: text,
    });
  }, reply);
  console.log("ANSWERS", JSON.stringify(answers, null, 2));
  const ids = answers.map((a) => a.questionId);
  expect(ids).toContain("hailProtection");
  expect(ids).not.toContain("outdoorAtNight"); // the reply does not say
  const flat = reply.replace(/\s+/g, " ").toLowerCase();
  for (const a of answers)
    expect(flat).toContain(a.quote.replace(/\s+/g, " ").toLowerCase());
});

test("counter-argument stream: the weak points, without amounts", async () => {
  const text = await page.evaluate(async () => {
    const api = (window as unknown as { api: DrmApi }).api;
    return new Promise<string>((resolve, reject) => {
      let out = "";
      api.llmStream(
        {
          kind: "explain",
          topic: "challenge",
          facts:
            "Location: Autohaus Beispiel\nWeak points, heaviest first:\n- [weight 2 of 3] Hail frequency and loss per vehicle are uncalibrated placeholder values. (the EAL may be off in either direction)\n- [weight 1 of 3] The vehicle count comes from a single aerial image, one day's stock. (the EAL may be off in either direction)\n- [weight 1 of 3] Every counted vehicle is treated as parked in the open; hail nets, canopies or halls are not considered. (the true EAL may be lower)",
        },
        (chunk) => {
          if (chunk.type === "token") out += chunk.token;
          if (chunk.type === "done") resolve(out);
          if (chunk.type === "error") reject(new Error(chunk.message));
        },
      );
    });
  });
  console.log("CHALLENGE", text);
  expect(text.length).toBeGreaterThan(80);
  expect(text).not.toMatch(/\d\s*(%|€|EUR)/);
});

test("aerial image check and boundary opinion return cleaned observations", async () => {
  test.skip(!VISION, "set DRM_E2E_LLM_VISION=1 for a vision model");
  const result = await page.evaluate(
    async ({ lat, lon }) => {
      const api = (window as unknown as { api: DrmApi }).api;
      const boundary = await api
        .detectBoundary(lat, lon, "Autohaus", undefined)
        .catch(() => undefined);
      const check = await api.checkSite({
        lat,
        lon,
        boundary: boundary ?? undefined,
        history: false,
      });
      const opinion = boundary
        ? await api.boundaryOpinion({ lat, lon, boundary })
        : null;
      return {
        boundarySource: boundary?.source ?? null,
        boundaryAreaSqm: boundary?.areaSqm ?? null,
        check,
        opinion,
      };
    },
    { lat: LAT, lon: LON },
  );
  console.log("SITE", JSON.stringify(result, null, 2));
  const seen = ["yes", "no", "unclear"];
  expect(seen).toContain(result.check.current.findings.hailNet);
  expect(seen).toContain(result.check.current.findings.canopy);
  expect(result.check.current.findings.note).not.toMatch(/\d\s*(%|€|EUR)/);
  if (result.opinion) {
    expect([
      "plausible",
      "tooLarge",
      "tooSmall",
      "wrongPlace",
      "unclear",
    ]).toContain(result.opinion.verdict);
  }
});

test("the record book lists every request with its origin, kept local", async () => {
  const log = await page.evaluate(async () => {
    const api = (window as unknown as { api: DrmApi }).api;
    const page = await api.listAiLog(0);
    const newest = page.entries[0]
      ? await api.getAiLogEntry(page.entries[0].id)
      : null;
    return { page, newest };
  });
  console.log(
    "LOG",
    log.page.entries
      .map(
        (e) => `${e.feature} ${e.status} ${e.durationMs}ms img=${e.imageCount}`,
      )
      .join("\n"),
  );
  const features = log.page.entries.map((e) => e.feature);
  expect(features).toEqual(
    expect.arrayContaining([
      "llm:evidenceMemo",
      "llm:questionnaireAnswers",
      "llm:stream:explain",
    ]),
  );
  expect(log.page.entries.every((e) => e.local)).toBe(true);
  expect(log.newest?.request.length).toBeGreaterThan(0);
  expect(JSON.stringify(log)).not.toContain("LIVE-GEHEIM");
});
