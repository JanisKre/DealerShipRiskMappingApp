import { describe, expect, it } from "vitest";
import { parseCsvWithReport } from "./csv.service";

describe("portfolio import report", () => {
  it("reports mappings, duplicates, and invalid numeric cells", () => {
    const result = parseCsvWithReport(
      [
        "name,address,lat,lon",
        "Berlin Motors,Main Street 1,52.5,13.4",
        "Berlin Motors,Main Street 1,52.5,13.4",
        "Hamburg Cars,Harbour Road 2,nope,10.0",
      ].join("\n"),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.report.totalRows).toBe(3);
    expect(result.report.importedRows).toBe(2);
    expect(result.report.duplicateRows).toBe(1);
    expect(result.report.columnMapping.lat).toBe("lat");
    expect(result.report.issues.some((issue) => issue.field === "lat")).toBe(
      true,
    );
  });

  it("records missing names as skipped errors", () => {
    const result = parseCsvWithReport("name,address\n,Somewhere\nValid,Else");

    expect(result.rows).toHaveLength(1);
    expect(result.report.skippedRows).toBe(1);
    expect(result.report.issues[0]).toMatchObject({
      row: 2,
      field: "name",
      severity: "error",
    });
  });

  it("auto-detects ZÜRS classes and preserves source evidence", () => {
    const result = parseCsvWithReport(
      [
        "name,address,lat,lon,ZÜRS Hochwasserklasse,Starkregenklasse,Bachzone,ZÜRS Version",
        "Berlin Motors,Main Street 1,52.5,13.4,4,3,ja,2026",
      ].join("\n"),
    );

    expect(result.rows[0].natCat).toMatchObject({
      provider: "zuers-geo",
      dataVersion: "2026",
      attributes: { floodClass: 4, heavyRainClass: 3, watercourseZone: true },
    });
    expect(result.rows[0].natCat?.hazards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ peril: "flood", score: 100, rawValue: 4 }),
        expect.objectContaining({
          peril: "heavyRain",
          score: 100,
          rawValue: 3,
        }),
      ]),
    );
    expect(result.report.columnMapping.zuersFloodClass).toBe(
      "ZÜRS Hochwasserklasse",
    );
  });

  it("reports invalid ZÜRS classes without importing them as risk data", () => {
    const result = parseCsvWithReport("name,zuersFloodClass\nSite,5");
    expect(result.rows[0].natCat).toBeUndefined();
    expect(result.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "zuersFloodClass",
          severity: "warning",
        }),
      ]),
    );
  });

  it("maps 'Dealership Name' and joins split address columns", () => {
    // Synthetic rows in the layout of a typical OSM dealership export.
    const csv = [
      '\ufeff"ID","Dealership Name","Street","House Number","Postal Code","City","Brand","Latitude","Longitude"',
      '"1","Autohaus Muster GmbH","Industriestraße","12-14","04564","Musterstadt","Audi;Seat","51.2","12.4"',
      '"2","Beispiel Automobile","Hauptstraße","","10115","Berlin","","52.5","13.4"',
    ].join("\n");
    const result = parseCsvWithReport(csv);
    expect(result.rows.map((r) => [r.name, r.address, r.lat, r.lon])).toEqual([
      [
        "Autohaus Muster GmbH",
        "Industriestraße 12-14, 04564 Musterstadt",
        51.2,
        12.4,
      ],
      ["Beispiel Automobile", "Hauptstraße, 10115 Berlin", 52.5, 13.4],
    ]);
    expect(result.report.columnMapping.name).toBe("Dealership Name");
    expect(result.report.columnMapping.address).toBe(
      "Street + House Number + Postal Code + City",
    );
  });

  it("never names locations after an ID column", () => {
    const result = parseCsvWithReport(
      "Nr;Firma XY Kennung;lat;lon\n7;Autohaus A;50;8",
    );
    expect(result.rows[0].name).toBe("Autohaus A");
  });

  it("recognises German headers with umlauts", () => {
    const result = parseCsvWithReport(
      "Händler;Straße;PLZ;Ort;Breite;Länge\nAutohaus B;Ringweg 3;80331;München;48.1;11.5",
    );
    expect(result.rows[0]).toMatchObject({
      name: "Autohaus B",
      address: "Ringweg 3, 80331 München",
      lat: 48.1,
      lon: 11.5,
    });
  });
});
