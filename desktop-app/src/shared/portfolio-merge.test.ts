import { describe, expect, it } from "vitest";
import { mergePortfolios } from "./portfolio-merge";
import type { AnalyzedDealership, BoundaryResult } from "./types";

function boundary(source: "osm" | "manual", x = 0): BoundaryResult {
  return {
    source,
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [x, 0],
          [x + 1, 0],
          [x + 1, 1],
          [x, 0],
        ],
      ],
    },
    areaSqm: 100,
    confidence: 0.9,
  } as BoundaryResult;
}

function make(
  id: string,
  patch: Partial<AnalyzedDealership> = {},
): AnalyzedDealership {
  return {
    id,
    name: `Dealer ${id}`,
    lat: 51.1234,
    lon: 10.5678,
    boundary: boundary("osm"),
    ...patch,
  } as AnalyzedDealership;
}

describe("mergePortfolios", () => {
  it("adds locations that are not in the current portfolio", () => {
    const result = mergePortfolios(
      [make("a")],
      [make("b", { lat: 52, lon: 11 })],
    );
    expect(result.dealerships.map((d) => d.id)).toEqual(["a", "b"]);
    expect(result.addedIds).toEqual(["b"]);
    expect(result.updatedIds).toEqual([]);
  });

  it("takes over a manually edited boundary and detection, keeping local fields", () => {
    const local = make("a", { salesPartner: "Local partner" });
    const edited = make("a", {
      salesPartner: "Remote partner",
      boundary: boundary("manual", 5),
      boundaryBeforeManualEdit: boundary("osm"),
      detection: {
        vehicleCount: 10,
        manualVehicleCount: 12,
        confidence: 0.9,
        model: "t",
      } as AnalyzedDealership["detection"],
    });
    const result = mergePortfolios([local], [edited]);
    const [merged] = result.dealerships;
    expect(result.updatedIds).toEqual(["a"]);
    expect(merged.boundary?.source).toBe("manual");
    expect(merged.detection?.manualVehicleCount).toBe(12);
    expect(merged.salesPartner).toBe("Local partner");
  });

  it("matches by name and position when the ids differ", () => {
    const edited = make("zzz", {
      name: "Dealer a",
      boundary: boundary("manual"),
    });
    const result = mergePortfolios([make("a")], [edited]);
    expect(result.dealerships).toHaveLength(1);
    expect(result.dealerships[0].id).toBe("a");
    expect(result.dealerships[0].boundary?.source).toBe("manual");
    expect(result.addedIds).toEqual([]);
  });

  it("keeps the local copy when only the local one was edited", () => {
    const local = make("a", { boundary: boundary("manual", 3) });
    const result = mergePortfolios([local], [make("a")]);
    expect(result.dealerships[0].boundary?.polygon).toEqual(
      local.boundary?.polygon,
    );
    expect(result.unchangedCount).toBe(1);
    expect(result.conflictNames).toEqual([]);
  });

  it("reports a conflict when both sides were edited differently", () => {
    const local = make("a", { boundary: boundary("manual", 1) });
    const incoming = make("a", { boundary: boundary("manual", 2) });
    const result = mergePortfolios([local], [incoming]);
    expect(result.conflictNames).toEqual(["Dealer a"]);
    expect(result.dealerships[0].boundary?.polygon).toEqual(
      local.boundary?.polygon,
    );
  });

  it("does not report a conflict for identical edits", () => {
    const edit = boundary("manual", 1);
    const result = mergePortfolios(
      [make("a", { boundary: edit })],
      [make("a", { boundary: edit })],
    );
    expect(result.conflictNames).toEqual([]);
    expect(result.unchangedCount).toBe(1);
  });

  it("is idempotent: merging the same file twice changes nothing more", () => {
    const incoming = [
      make("a", { boundary: boundary("manual") }),
      make("b", { lat: 53 }),
    ];
    const once = mergePortfolios([make("a")], incoming);
    const twice = mergePortfolios(once.dealerships, incoming);
    expect(twice.dealerships).toEqual(once.dealerships);
    expect(twice.addedIds).toEqual([]);
    expect(twice.updatedIds).toEqual([]);
  });
});
