import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzedDealership, Session } from "@shared/types";
import { SessionSchema } from "@shared/types";

const dir = mkdtempSync(join(tmpdir(), "drm-export-"));
const mocks = vi.hoisted(() => ({ next: "" }));

vi.mock("electron", () => ({
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: mocks.next }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [mocks.next] }),
  },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: {},
  ClipboardItem: class {},
}));

// The CommonJS build Electron's main process loads: `autoTable` is a named
// export, and the module object itself (what a default import yields after
// bundling) is not callable. A default import made every PDF export fail
// with "autoTable is not a function".
vi.mock("jspdf-autotable", async (importOriginal) => {
  const real = await importOriginal<typeof import("jspdf-autotable")>();
  return { autoTable: real.autoTable, default: { notCallable: true } };
});

import {
  exportPortfolioFile,
  exportReadonlyView,
  exportReport,
  importPortfolioFile,
  toCsv,
} from "./export.service";
import ExcelJS from "exceljs";

function site(id: string, vehicles: number, zone: number): AnalyzedDealership {
  return {
    id,
    name: `Autohaus ${id}`,
    address: `Industriestraße 1, 01219 Dresden`,
    lat: 51.02,
    lon: 13.78,
    hailZone: zone,
    detection: { vehicleCount: vehicles, confidence: 0.8, model: "test" },
    risk: {
      overallScore: 40,
      perils: [],
      eal: vehicles * 24,
      exposureEur: vehicles * 25_000,
      computedAt: "2026-11-11T00:00:00Z",
    },
  } as AnalyzedDealership;
}

const session: Session = SessionSchema.parse({
  id: "s1",
  name: "Testportfolio",
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
  dealerships: [site("A", 886, 2), site("B", 42, 5)],
});

function target(name: string): string {
  mocks.next = join(dir, name);
  return mocks.next;
}

describe("dashboard exports", () => {
  beforeEach(() => {
    mocks.next = "";
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a PDF report", async () => {
    const path = target("report.pdf");
    expect(await exportReport(session, "pdf")).toBe(path);
    const pdf = readFileSync(path);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2_000);
  });

  it("writes an Excel workbook", async () => {
    const path = target("report.xlsx");
    expect(await exportReport(session, "excel")).toBe(path);
    expect(readFileSync(path).subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("writes a CSV with one row per location", async () => {
    const path = target("report.csv");
    expect(await exportReport(session, "csv")).toBe(path);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines[0]).toMatch(/^name,address,/);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^Autohaus A,/);
  });

  it("keeps cells that look like formulas as text in the CSV", async () => {
    const path = target("formula.csv");
    const risky = SessionSchema.parse({
      ...session,
      dealerships: [{ ...site("C", 886, 1), name: "=HYPERLINK(1)" }],
    });
    expect(await exportReport(risky, "csv")).toBe(path);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines[1]).toMatch(/^'=HYPERLINK\(1\),/);
  });

  it("writes the read-only HTML view", async () => {
    const path = target("view.html");
    expect(await exportReadonlyView(session)).toBe(path);
    const html = readFileSync(path, "utf-8");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("Autohaus B");
  });

  it("writes a portfolio file that imports back unchanged", async () => {
    const path = target("portfolio.drm");
    expect(await exportPortfolioFile(session)).toBe(path);
    expect(await importPortfolioFile()).toEqual(session);
  });

  it("does nothing when the save dialog is cancelled", async () => {
    mocks.next = "";
    expect(await exportReport(session, "pdf")).toBeNull();
  });
});

/** A site without a detection model: area estimate on a fallback circle. */
const estimatedSite = {
  id: "E",
  name: "Egon Senger",
  address: "Spandauer Damm 1, 14059 Berlin",
  lat: 52.52,
  lon: 13.29,
  hailZone: 3,
  boundary: {
    source: "synthetic",
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [13.29, 52.52],
          [13.291, 52.52],
          [13.291, 52.521],
          [13.29, 52.52],
        ],
      ],
    },
    areaSqm: 72_408,
    confidence: 0.2,
  },
  detection: {
    vehicleCount: 2896,
    confidence: 0.3,
    model: "stub-area-heuristic",
  },
  risk: {
    overallScore: 40,
    perils: [],
    eal: 0,
    exposureEur: 72_400_000,
    modelVersion: "screening-0.5.1",
    confidence: 0.4,
    evidence: [
      {
        source: "Postcode hail zones",
        retrievedAt: "2026-11-11T00:00:00Z",
        method: "postcode hail-zone lookup",
        confidence: 0.7,
      },
    ],
    computedAt: "2026-11-11T00:00:00Z",
  },
};

const mixed: Session = SessionSchema.parse({
  ...session,
  dealerships: [site("A", 886, 2), estimatedSite],
});

describe("limitations and provenance in exports (UW-11, UW-03)", () => {
  const ownDir = mkdtempSync(join(tmpdir(), "drm-export-prov-"));
  const target = (name: string): string => {
    mocks.next = join(ownDir, name);
    return mocks.next;
  };
  afterAll(() => rmSync(ownDir, { recursive: true, force: true }));
  it("adds provenance columns and leaves the EAL empty without a count", () => {
    const [header, counted, estimated] = toCsv(mixed).split("\n");
    expect(header).toContain(
      "vehicleSource,hailZone,hailZoneSource,exposureEur,exposureEstimated,eal,ealStatus",
    );
    expect(header).toContain("boundarySource,boundaryConfidence");
    expect(header).toContain(
      "modelVersion,imageDate,analysedAt,boundaryReview,fallbackUsed",
    );
    expect(counted).toContain(",detected,");
    expect(counted).toContain(",ok,");
    // Area estimate: flagged, exposure exported, EAL blank with the reason.
    expect(estimated).toContain(",areaEstimate,");
    expect(estimated).toContain(",72400000,yes,,noCount,");
    expect(estimated).toContain(",synthetic,0.2,0.4,screening-0.5.1,");
  });

  it("writes German CSVs with semicolons, decimal commas and a BOM", () => {
    const text = toCsv(mixed, "de");
    expect(text.startsWith("\uFEFF")).toBe(true);
    const [header, , estimated] = text.slice(1).split("\n");
    expect(header).toMatch(/^Name;Adresse;Breite;Länge;/);
    expect(header).toContain("Quelle Fahrzeugzahl");
    expect(estimated).toContain(";52,52;13,29;");
    expect(estimated).toContain("Flächenschätzung (nicht in der EAL)");
    expect(estimated).toContain(";keine Fahrzeugzahl;");
    // Sources in words, not as the internal codes.
    expect(estimated).toContain(";geschätzte Grenze (Kreis);");
    expect(estimated).not.toContain(";synthetic;");
  });

  it("gives English workbooks readable headings, the CSV keeps its keys", async () => {
    const path = target("headings.xlsx");
    expect(await exportReport(mixed, "excel", "en")).toBe(path);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const header = wb.worksheets[0].getRow(1).values as unknown[];
    expect(header).toContain("Hail zone");
    expect(header).not.toContain("hailZone");
    expect(toCsv(mixed).split("\n")[0]).toContain("hailZone");
  });

  it("puts the methodology and placeholder note into the workbook", async () => {
    const path = target("method.xlsx");
    expect(await exportReport(mixed, "excel", "de")).toBe(path);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const notes = wb.worksheets[1];
    const text = notes
      .getColumn(1)
      .values.filter((v): v is string => typeof v === "string")
      .join("\n");
    expect(text).toContain("Screening-Schätzung");
    expect(text).toContain("Platzhalterwerte");
    expect(text).toContain("aus 1 von 2 Standorten mit Fahrzeugzahl");
    expect(text).toContain("Postcode hail zones");
    expect(text).toContain("screening-0.5.1");
    const header = wb.worksheets[0].getRow(1).values as unknown[];
    expect(header).toContain("Quelle Fahrzeugzahl");
    expect(header).toContain("Konfidenz Grenze");
  });

  it("writes a localised HTML view with the limitations", async () => {
    const path = target("view-de.html");
    expect(await exportReadonlyView(mixed, "de")).toBe(path);
    const html = readFileSync(path, "utf-8");
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("Methodik, Datenquellen und Einschränkungen");
    expect(html).toContain("Platzhalterwerte");
    expect(html).toContain("keine Fahrzeugzahl");
    expect(html).toContain("≈2.896");
    expect(html).not.toContain(">0 €<");
  });

  it("writes a PDF with the methodology page", async () => {
    const path = target("report-de.pdf");
    expect(await exportReport(mixed, "pdf", "de")).toBe(path);
    expect(readFileSync(path).length).toBeGreaterThan(2_000);
  });

  it("writes readable text: symbols outside the PDF font are replaced", async () => {
    for (const locale of ["de", "fr"] as const) {
      const path = target(`report-${locale}-text.pdf`);
      expect(await exportReport(mixed, "pdf", locale)).toBe(path);
      const pdf = readFileSync(path).toString("latin1");
      // jsPDF writes text outside WinAnsi as UTF-16 with a byte-order mark.
      expect(pdf).not.toContain("\u00fe\u00ff");
      expect(pdf).toMatch(locale === "de" ? /In Hagelzone >= 4/ : /grêle >= 4/);
    }
  });

  it("adds the site answers as shown in the app", () => {
    const answered = {
      ...session,
      dealerships: [
        {
          ...site("A", 886, 2),
          siteAnswers: [
            {
              question: "hailNet" as const,
              value: "yes",
              source: "underwriter" as const,
              at: "2026-11-20T00:00:00Z",
            },
            {
              question: "openAirShare" as const,
              value: "few",
              source: "model" as const,
              at: "2026-11-21T00:00:00Z",
              engine: "llm" as const,
              model: "claude-fable-5-2",
            },
          ],
        },
        site("B", 100, 1),
      ],
    };
    const [header, first, second] = toCsv(answered).split("\n");
    expect(header).toContain(
      "clusterId,hailProtection,siteHailNet,siteCanopy,siteParkingStructure,siteOpenAirShare,siteBoundaryFits,siteConstruction,siteDealershipVisible,siteAnswerSources",
    );
    expect(first.endsWith(",seen,yes,,,few,,,,underwriter model")).toBe(true);
    expect(second.endsWith(",,,,,,,,,")).toBe(true);
    const german = toCsv(answered, "de").slice(1).split("\n");
    expect(german[0]).toContain("Hagelschutz;Hagelnetz;");
    expect(german[1]).toContain(
      ";erkennbar;ja;;;wenige;;;;Underwriter, Bildmodell",
    );
  });
});
