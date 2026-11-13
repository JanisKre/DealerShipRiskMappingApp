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
} from "./export.service";

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
