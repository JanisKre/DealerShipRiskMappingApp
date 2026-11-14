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

  it("ignores ZÜRS flood columns: the app models hail only", () => {
    const result = parseCsvWithReport(
      [
        "name,address,lat,lon,ZÜRS Hochwasserklasse,Starkregenklasse,Bachzone,ZÜRS Version",
        "Berlin Motors,Main Street 1,52.5,13.4,4,3,ja,2026",
      ].join("\n"),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).not.toHaveProperty("natCat");
    expect(result.rows[0].address).toBe("Main Street 1");
    expect(result.report.columnMapping).not.toHaveProperty("zuersFloodClass");
    expect(result.report.issues).toEqual([]);
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

describe("website column", () => {
  it("marks a website from the file as imported, not as typed", () => {
    const result = parseCsvWithReport(
      [
        "Name;Adresse;Website",
        "Autohaus Nord;Hauptstr. 1, Hamburg;www.autohaus-nord.de",
        "Autohaus Süd;Ringstr. 2, München;",
      ].join("\n"),
    );

    expect(result.rows[0]).toMatchObject({
      website: "https://www.autohaus-nord.de/",
      websiteSource: "import",
    });
    expect(result.rows[1].website).toBeUndefined();
    expect(result.rows[1].websiteSource).toBeUndefined();
  });
});

describe("portfolio terms and business type", () => {
  it("imports maximum indemnity and deductible from German headers", () => {
    const result = parseCsvWithReport(
      [
        "Händler;Adresse;Höchstentschädigung;Selbstbehalt;Geschäftsart",
        "Autohaus Nord;Hauptstr. 1, Hamburg;1.250.000,00 €;2.500;Bestand",
        "Autohaus Süd;Ringstr. 2, München;750000;1000 EUR;Neugeschäft",
      ].join("\n"),
    );

    expect(result.report.columnMapping).toMatchObject({
      productLimitEur: "Höchstentschädigung",
      deductibleEur: "Selbstbehalt",
      insured: "Geschäftsart",
    });
    expect(result.rows[0]).toMatchObject({
      productLimitEur: 1_250_000,
      deductibleEur: 2_500,
      insured: true,
    });
    expect(result.rows[1]).toMatchObject({
      productLimitEur: 750_000,
      deductibleEur: 1_000,
      insured: false,
    });
  });

  it("recognises English headers and thousands separators", () => {
    const result = parseCsvWithReport(
      [
        "name\tmax indemnity\tdeductible\tbusiness type",
        "Dealer A\t1,500,000.00\t5,000\texisting business",
        "Dealer B\t250.000\t1250,50\tnew business",
      ].join("\n"),
    );

    expect(result.rows.map((r) => r.productLimitEur)).toEqual([
      1_500_000, 250_000,
    ]);
    expect(result.rows.map((r) => r.deductibleEur)).toEqual([5_000, 1_250.5]);
    expect(result.rows.map((r) => r.insured)).toEqual([true, false]);
  });

  it("leaves unknown business types unclassified and reports them", () => {
    const result = parseCsvWithReport(
      ["name,status", "Dealer A,vielleicht", "Dealer B,", "Dealer C,ja"].join(
        "\n",
      ),
    );

    expect(result.rows.map((r) => r.insured)).toEqual([
      undefined,
      undefined,
      true,
    ]);
    expect(result.report.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        field: "insured",
        severity: "warning",
      }),
    );
  });

  it("rejects negative or malformed amounts with a warning", () => {
    const result = parseCsvWithReport(
      ["name,limit,deductible", "Dealer A,-5,abc"].join("\n"),
    );

    expect(result.rows[0].productLimitEur).toBeUndefined();
    expect(result.rows[0].deductibleEur).toBeUndefined();
    expect(
      result.report.issues.filter((i) => i.severity === "warning"),
    ).toHaveLength(2);
  });
});

describe("quoted CSV cells", () => {
  it("reads a quoted address spanning two lines as one cell of one row", () => {
    const result = parseCsvWithReport(
      [
        "name,address,lat,lon",
        '"Autohaus Nord","Hauptstr. 1',
        '80331 München",48.1,11.5',
        "Autohaus Süd,Ring 2,48.2,11.6",
      ].join("\r\n"),
    );
    expect(result.rows.map((r) => [r.name, r.address, r.lat])).toEqual([
      ["Autohaus Nord", "Hauptstr. 1, 80331 München", 48.1],
      ["Autohaus Süd", "Ring 2", 48.2],
    ]);
  });

  it("keeps row numbers of the file after a multi-line cell", () => {
    const result = parseCsvWithReport(
      [
        "name,address,lat,lon",
        '"A","Line 1',
        'Line 2",48.1,11.5',
        "B,Street,nope,11.6",
      ].join("\n"),
    );
    expect(result.report.issues).toEqual([
      expect.objectContaining({ row: 4, field: "lat" }),
    ]);
  });

  it("turns doubled quotes inside a quoted cell into one quote", () => {
    const result = parseCsvWithReport(
      ["name;address", '"Autohaus ""Max"" GmbH";"Weg 1; Hof"'].join("\n"),
    );
    expect(result.rows[0].name).toBe('Autohaus "Max" GmbH');
    expect(result.rows[0].address).toBe("Weg 1; Hof");
  });

  it("falls back to line by line when a quote is never closed", () => {
    const result = parseCsvWithReport(
      ["name,lat,lon", '"Open,48.1,11.5', "Closed,48.2,11.6"].join("\n"),
    );
    expect(result.rows.map((r) => r.name)).toContain("Closed");
  });

  it("lists every column with a type hint and the field it feeds", () => {
    const result = parseCsvWithReport(
      [
        "name,Kundennr,Breite,Laenge,PLZ Standort,Fahrzeugwert",
        "Autohaus Nord,K-1,52.52001,13.40495,10115,1.250.000",
        "Autohaus Süd,K-2,48.13743,11.57549,80331,980.000",
      ].join("\n"),
    );
    expect(result.report.columns).toEqual([
      { name: "name", hint: "text", field: "name" },
      { name: "Kundennr", hint: "text", field: null },
      { name: "Breite", hint: "latitude", field: "lat" },
      { name: "Laenge", hint: "longitude", field: "lon" },
      { name: "PLZ Standort", hint: "postcode", field: null },
      { name: "Fahrzeugwert", hint: "amount", field: null },
    ]);
  });

  it("uses columns assigned by hand instead of the detection", () => {
    const csv = [
      "Firma,Ort,Wert in Euro,Region",
      "Autohaus Nord,Berlin,1.250.000,Nord",
    ].join("\n");
    const result = parseCsvWithReport(csv, {
      assetValue: "Wert in Euro",
      city: "Region",
      subPortfolio: "Ort",
    });
    expect(result.rows[0]).toMatchObject({
      name: "Autohaus Nord",
      assetValue: 1_250_000,
      address: "Nord",
      subPortfolio: "Berlin",
    });
    expect(result.report.columns?.map((c) => [c.name, c.field])).toEqual([
      ["Firma", "name"],
      ["Ort", "subPortfolio"],
      ["Wert in Euro", "assetValue"],
      ["Region", "city"],
    ]);
    // A header that is not in the file changes nothing.
    expect(
      parseCsvWithReport(csv, { assetValue: "Gibt es nicht" }).rows[0]
        .assetValue,
    ).toBeUndefined();
  });
});
