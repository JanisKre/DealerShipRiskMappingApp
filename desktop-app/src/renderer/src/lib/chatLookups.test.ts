import { describe, expect, it, vi } from "vitest";
import type { AnalyzedDealership, HailHistory } from "@shared/types";
import type { ImagerySelection } from "@shared/imagery-sources";
import { cleanToolCalls } from "@shared/chat-tools";
import {
  formatEvidence,
  mayNeedLookups,
  plannerLocations,
  runChatLookups,
  type LookupApi,
} from "./chatLookups";

function site(id: string, eal: number): AnalyzedDealership {
  return {
    id,
    name: `Autohaus ${id}`,
    lat: 50,
    lon: 10,
    address: "Hauptstraße 1, 01067 Dresden",
    notes: "vertraulich",
    hailZone: 4,
    boundary: {
      source: "alkis",
      polygon: { type: "Polygon", coordinates: [] },
      areaSqm: 12_345,
      confidence: 0.62,
      reviewRequired: true,
    },
    risk: {
      overallScore: 30,
      perils: [],
      eal,
      computedAt: "2026-06-01T10:00:00Z",
      limitations: ["Hail EAL uses placeholder values"],
      evidence: [
        {
          source: "Postcode hail zones",
          retrievedAt: "2026-06-01",
          method: "lookup",
          confidence: 0.7,
          fallbackUsed: false,
          limitations: ["Zone per postcode"],
        },
      ],
      ealBreakdown: {
        hail: eal,
        total: eal,
        hailDetail: {
          vehicles: 120,
          exposedVehicles: 90,
          vehicleSource: "detected",
          zone: 4,
          zoneSource: "postcode",
          frequency: 0.2,
          meanSeverityEur: 450,
        },
      },
    },
  } as unknown as AnalyzedDealership;
}

describe("chat lookups", () => {
  it("only plans for a named or selected location", () => {
    const locations = [{ name: "Autohaus Nord" }, { name: "VW" }];
    expect(
      mayNeedLookups("Warum ist Autohaus Nord so hoch?", locations, null),
    ).toBe(true);
    expect(mayNeedLookups("Welche Zone hat VW?", locations, null)).toBe(false);
    expect(mayNeedLookups("Summe aller EAL?", locations, null)).toBe(false);
    expect(mayNeedLookups("Warum hier?", locations, "x")).toBe(true);
  });

  it("offers the selected location first, then by EAL", () => {
    expect(
      plannerLocations([site("a", 10), site("b", 50), site("c", 30)], "a").map(
        (l) => l.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("drops unknown tools, ids and repeats and caps the calls", () => {
    const known = new Set(["a", "b"]);
    const calls = cleanToolCalls(
      [
        { tool: "evidence", locationId: "a" },
        { tool: "evidence", locationId: "a" },
        { tool: "deleteAll", locationId: "a" },
        { tool: "radarHail", locationId: "zzz" },
        { tool: "radarHail", locationId: "a" },
        { tool: "hailHistory", locationId: "a" },
        { tool: "imagery", locationId: "a" },
        { tool: "evidence", locationId: "b" },
        { tool: "imagery", locationId: "b" },
      ],
      known,
    );
    expect(calls).toHaveLength(5);
    expect(calls[0]).toEqual({ tool: "evidence", locationId: "a" });
    expect(calls.some((c) => c.locationId === "zzz")).toBe(false);
  });

  it("writes evidence without notes or the street address", () => {
    const text = formatEvidence(site("a", 8_100));
    expect(text).toContain("Hail EAL 8100 EUR (screening estimate");
    expect(text).toContain("120 vehicles (detected), 90 parked in the open");
    expect(text).toContain("source alkis");
    expect(text).toContain("needs review");
    expect(text).toContain("Postcode hail zones");
    expect(text).not.toContain("vertraulich");
    expect(text).not.toContain("Hauptstraße");
  });

  it("runs the lookups and reports failures", async () => {
    const api: LookupApi = {
      hailHistory: vi.fn(() =>
        Promise.resolve({
          searchRadiusKm: 30,
          stations: [
            {
              stationId: "01048",
              name: "Dresden-Klotzsche",
              distanceKm: 8.4,
              firstYear: 1961,
              lastYear: 2010,
              yearsObserved: 50,
              hailDays: 40,
              hailDaysPerYear: 0.8,
              recentHailDates: ["2010-06-12"],
              hailDaysByYear: [],
            },
          ],
          evidence: {
            source: "DWD",
            retrievedAt: "",
            method: "",
            confidence: 0.5,
            fallbackUsed: false,
            limitations: [],
          },
        } as HailHistory),
      ),
      radarHail: vi.fn(() => Promise.reject(new Error("offline"))),
      selectImagery: vi.fn(() =>
        Promise.resolve({} as unknown as ImagerySelection),
      ),
    };
    const run = await runChatLookups(
      [
        { tool: "hailHistory", locationId: "a" },
        { tool: "radarHail", locationId: "a" },
      ],
      [site("a", 1)],
      api,
    );
    expect(run.done).toEqual([
      { tool: "hailHistory", name: "Autohaus a", ok: true },
      { tool: "radarHail", name: "Autohaus a", ok: false },
    ]);
    expect(run.results).toContain("Dresden-Klotzsche, 8.4 km: 40 hail days");
    expect(run.results).toContain("[radarHail] Autohaus a: lookup failed.");
  });
});
