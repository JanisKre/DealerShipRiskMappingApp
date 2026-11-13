import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { AnalyzedDealership, HailHistory } from "@shared/types";

const dir = mkdtempSync(join(tmpdir(), "drm-location-report-"));
const mocks = vi.hoisted(() => ({ next: "", tiles: true }));

vi.mock("electron", () => ({
  dialog: {
    showSaveDialog: async () =>
      mocks.next
        ? { canceled: false, filePath: mocks.next }
        : { canceled: true, filePath: undefined },
  },
}));
vi.mock("jspdf-autotable", async (importOriginal) => {
  const real = await importOriginal<typeof import("jspdf-autotable")>();
  return { autoTable: real.autoTable, default: { notCallable: true } };
});
// No network: a grey mosaic for the image, a fixed history.
vi.mock("./tiles.service", () => ({
  aerialImageForBbox: async (bbox: [number, number, number, number]) => ({
    rgba: new Uint8Array(2400 * 2400 * 4).fill(128),
    width: 2400,
    height: 2400,
    bbox,
    originLon: bbox[0] - 0.001,
    originLat: bbox[3] + 0.001,
    lonSpan: bbox[2] - bbox[0] + 0.002,
    latSpan: bbox[3] - bbox[1] + 0.002,
    zoom: 19,
    validTileCount: mocks.tiles ? 4 : 0,
    tileCount: 4,
  }),
}));
vi.mock("./hail-history/hail-history.service", () => ({
  getHailHistory: async (): Promise<HailHistory> => history,
}));

import {
  addressWithoutName,
  buildLocationReportPdf,
  evidenceLines,
  exportLocationReport,
  reportBbox,
  safeFileName,
  toPixel,
} from "./location-report.service";

const history: HailHistory = {
  searchRadiusKm: 30,
  stations: [
    {
      stationId: "01048",
      name: "Dresden-Klotzsche",
      distanceKm: 8.4,
      firstYear: 1961,
      lastYear: 2011,
      yearsObserved: 51,
      hailDays: 102,
      hailDaysPerYear: 2,
      recentHailDates: ["2009-07-04"],
      hailDaysByYear: [{ year: 2009, days: 2 }],
    },
  ],
  evidence: {
    source: "DWD",
    retrievedAt: "2026-11-13T00:00:00Z",
    method: "test",
    confidence: 0.5,
    fallbackUsed: false,
    limitations: [],
  },
};

const site: AnalyzedDealership = {
  id: "a",
  name: "Autohaus Test, Dresden",
  address: "Industriestraße 1, 01219 Dresden",
  lat: 51.02,
  lon: 13.78,
  insured: true,
  notes: "PRIVATE NOTE",
  productLimitEur: 2_000_000,
  boundary: {
    source: "alkis",
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [13.779, 51.0195],
          [13.781, 51.0195],
          [13.781, 51.0205],
          [13.779, 51.0205],
          [13.779, 51.0195],
        ],
      ],
    },
    areaSqm: 15_600,
    confidence: 0.9,
    reviewRequired: true,
    evidence: {
      source: "ALKIS",
      retrievedAt: "2026-11-13T00:00:00Z",
      method: "parcel",
      confidence: 0.9,
      fallbackUsed: false,
      limitations: ["Parcel may include neighbouring land"],
    },
  },
  detection: { vehicleCount: 120, confidence: 0.8, model: "yolo" },
  hailZone: 3,
  risk: {
    overallScore: 40,
    perils: [],
    eal: 4_032,
    exposureEur: 3_000_000,
    ealBreakdown: {
      hail: 4_032,
      total: 4_032,
      hailDetail: {
        vehicles: 120,
        exposedVehicles: 120,
        vehicleSource: "detected",
        zone: 3,
        zoneSource: "postcode",
        frequency: 0.07,
        meanSeverityEur: 480,
      },
    },
    evidence: [
      {
        source: "Postcode hail zones",
        retrievedAt: "2026-11-13T00:00:00Z",
        method: "zone table",
        confidence: 0.7,
        fallbackUsed: false,
        limitations: [
          "Parcel may include neighbouring land",
          "Zone is a postcode average",
        ],
      },
    ],
    computedAt: "2026-11-13T00:00:00Z",
  },
} as AnalyzedDealership;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("location report", () => {
  it("frames the lot with a margin and at least ±60 m", () => {
    const [w, s, e, n] = reportBbox(site);
    expect(w).toBeLessThan(13.779);
    expect(e).toBeGreaterThan(13.781);
    expect(s).toBeLessThan(51.0195);
    expect(n).toBeGreaterThan(51.0205);
    const point = reportBbox({ ...site, boundary: undefined });
    expect((point[3] - point[1]) * 111_320).toBeGreaterThanOrEqual(119);
  });

  it("projects coordinates into the Web Mercator mosaic", () => {
    const capture = {
      originLon: 13,
      originLat: 52,
      lonSpan: 1,
      latSpan: 1,
      width: 1000,
      height: 1000,
    };
    expect(toPixel(capture, 13, 52)).toEqual([0, 0]);
    const [x, y] = toPixel(capture, 13.5, 51.5);
    expect(x).toBe(500);
    // Mercator: the middle latitude sits slightly below the middle row.
    expect(y).toBeGreaterThan(495);
    expect(y).toBeLessThan(505);
    expect(toPixel(capture, 14, 51)[1]).toBeCloseTo(1000, 6);
  });

  it("drops the name from the address line", () => {
    expect(
      addressWithoutName({
        ...site,
        address: "Autohaus Test, Dresden, 01219 Dresden",
      }),
    ).toBe("01219 Dresden");
    expect(addressWithoutName(site)).toBe(site.address);
  });

  it("makes a safe file name", () => {
    expect(safeFileName('Autohaus "A/B": Nord')).toBe("Autohaus A B Nord");
    expect(safeFileName("   ")).toBe("location");
  });

  it("lists every source once with its limitations", () => {
    const lines = evidenceLines(site);
    expect(lines).toContain("Postcode hail zones: zone table");
    expect(lines).toContain("ALKIS: parcel");
    expect(
      lines.filter((l) => l === "Parcel may include neighbouring land"),
    ).toHaveLength(1);
  });

  it("builds a one-page PDF without the local notes", async () => {
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#777" },
    })
      .jpeg()
      .toBuffer();
    const pdf = Buffer.from(
      buildLocationReportPdf(
        {
          dealership: site,
          locale: "de",
          reviewNotes: ["Grundstücksgrenze prüfen"],
        },
        {
          dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
          width: 40,
          height: 30,
          caption: "Test imagery",
        },
        history,
        new Date("2026-11-13T00:00:00Z"),
      ),
    );
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain("/Count 1");
    // A long source list moves to a second page instead of the footer.
    const long = Buffer.from(
      buildLocationReportPdf(
        {
          dealership: {
            ...site,
            risk: {
              ...site.risk!,
              limitations: Array.from({ length: 40 }, (_, i) =>
                `Limitation ${i} `.repeat(80),
              ),
            },
          },
          locale: "en",
          reviewNotes: [],
        },
        null,
        history,
        new Date("2026-11-13T00:00:00Z"),
      ),
    ).toString("latin1");
    expect(long).toContain("/Count 2");
    expect(text).not.toContain("PRIVATE NOTE");
  });

  it("writes the file with image and history, and honours cancel", async () => {
    mocks.next = join(dir, "report.pdf");
    const path = await exportLocationReport({
      dealership: site,
      locale: "en",
      reviewNotes: [],
    });
    expect(path).toBe(mocks.next);
    const pdf = readFileSync(mocks.next);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // The aerial image is embedded as a JPEG.
    expect(pdf.toString("latin1")).toContain("/DCTDecode");

    mocks.tiles = false;
    mocks.next = join(dir, "no-image.pdf");
    expect(
      await exportLocationReport({
        dealership: site,
        locale: "fr",
        reviewNotes: [],
      }),
    ).toBe(mocks.next);
    expect(readFileSync(mocks.next).toString("latin1")).not.toContain(
      "/DCTDecode",
    );

    mocks.next = "";
    expect(
      await exportLocationReport({
        dealership: site,
        locale: "de",
        reviewNotes: [],
      }),
    ).toBeNull();
  });
});
