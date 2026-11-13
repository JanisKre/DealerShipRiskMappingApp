import { describe, expect, it } from "vitest";
import { parseCsvWithReport, parseXlsxWithReport } from "./csv.service";
import {
  normalizeRelationships,
  normalizeSpreadsheetXml,
  normalizeXlsx,
} from "./xlsx-normalize";
import { readZipEntries, writeZip } from "./zip";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const BOM = "\uFEFF";

/** A cell with an inline string (no shared strings needed). */
const s = (ref: string, text: string): string =>
  `<x:c r="${ref}" t="inlineStr"><x:is><x:t>${text}</x:t></x:is></x:c>`;
const n = (ref: string, value: number): string =>
  `<x:c r="${ref}"><x:v>${value}</x:v></x:c>`;
const sheet = (rows: string[]): string =>
  `${BOM}<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="${MAIN}"><x:sheetData>${rows.join("")}</x:sheetData></x:worksheet>`;

/**
 * An XLSX written like the Open XML SDK does it: every element with the
 * `x:` prefix, absolute relationship targets, a BOM, a notes sheet first
 * and a title, a note and a blank line above the column names.
 */
function openXmlSdkWorkbook(): Buffer {
  const file = (
    name: string,
    text: string,
  ): { name: string; data: Buffer } => ({
    name,
    data: Buffer.from(text, "utf8"),
  });
  return writeZip([
    file(
      "[Content_Types].xml",
      `${BOM}<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>`,
    ),
    file(
      "_rels/.rels",
      `${BOM}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="${PKG}"><Relationship Type="${REL}/officeDocument" Target="/xl/workbook.xml" Id="R1" /></Relationships>`,
    ),
    file(
      "xl/workbook.xml",
      `${BOM}<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="${MAIN}"><x:sheets><x:sheet name="Notes" sheetId="1" r:id="R2" xmlns:r="${REL}" /><x:sheet name="Dealerships" sheetId="2" r:id="R3" xmlns:r="${REL}" /></x:sheets></x:workbook>`,
    ),
    file(
      "xl/_rels/workbook.xml.rels",
      `${BOM}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="${PKG}"><Relationship Type="${REL}/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R2" /><Relationship Type="${REL}/worksheet" Target="/xl/worksheets/sheet2.xml" Id="R3" /></Relationships>`,
    ),
    file(
      "xl/worksheets/sheet1.xml",
      sheet([`<x:row r="1">${s("A1", "Metric")}${s("B1", "Value")}</x:row>`]),
    ),
    file(
      "xl/worksheets/sheet2.xml",
      sheet([
        `<x:row r="1">${s("A1", "Sample Dataset")}${s("B1", "Sample Dataset")}</x:row>`,
        `<x:row r="2">${s("A2", "Taken from OpenStreetMap")}</x:row>`,
        `<x:row r="4">${s("A4", "ID")}${s("B4", "Dealership Name")}${s("C4", "Street")}${s("D4", "Postal Code")}${s("E4", "City")}${s("F4", "Latitude")}${s("G4", "Longitude")}${s("H4", "Website")}</x:row>`,
        `<x:row r="5">${n("A5", 1)}${s("B5", "Autohaus Nord")}${s("C5", "Ring 1")}${s("D5", "01067")}${s("E5", "Dresden")}${n("F5", 51.05)}${n("G5", 13.74)}${s("H5", "www.autohaus-nord.example")}</x:row>`,
        `<x:row r="7">${n("A7", 2)}${s("B7", "Autohaus Süd")}${s("C7", "Weg 2")}${s("D7", "04109")}${s("E7", "Leipzig")}${n("F7", 51.34)}${n("G7", 12.37)}</x:row>`,
      ]),
    ),
  ]);
}

describe("spreadsheets written with namespace prefixes", () => {
  it("rewrites prefixed SpreadsheetML to the default namespace", () => {
    const xml = `${BOM}<x:worksheet xmlns:x="${MAIN}"><x:row r="1"/></x:worksheet>`;
    expect(normalizeSpreadsheetXml(xml)).toBe(
      `<worksheet xmlns="${MAIN}"><row r="1"/></worksheet>`,
    );
    const plain = `<worksheet xmlns="${MAIN}"/>`;
    expect(normalizeSpreadsheetXml(plain)).toBe(plain);
  });

  it("only rewrites prefixes bound to the exact SpreadsheetML namespace", () => {
    const lookalike = MAIN.replace("schemas.", "schemasX");
    const xml = `<s.m-l:worksheet xmlns:s.m-l="${MAIN}" xmlns:o="${lookalike}"><s.m-l:row/><o:row/><mc:x/></s.m-l:worksheet>`;
    expect(normalizeSpreadsheetXml(xml)).toBe(
      `<worksheet xmlns="${MAIN}" xmlns:o="${lookalike}"><row/><o:row/><mc:x/></worksheet>`,
    );
    const onlyLookalike = `<o:worksheet xmlns:o="${lookalike}"/>`;
    expect(normalizeSpreadsheetXml(onlyLookalike)).toBe(onlyLookalike);
  });

  it("makes absolute relationship targets relative to their part", () => {
    const rels = `<Relationships><Relationship Target="/xl/tables/table1.xml" Id="a"/><Relationship Target="https://x.example" TargetMode="External" Id="b"/></Relationships>`;
    expect(
      normalizeRelationships(rels, "xl/worksheets/_rels/sheet1.xml.rels"),
    ).toContain('Target="../tables/table1.xml"');
    expect(
      normalizeRelationships(rels, "xl/worksheets/_rels/sheet1.xml.rels"),
    ).toContain('Target="https://x.example"');
    expect(
      normalizeRelationships(
        `<Relationship Target="/xl/workbook.xml"/>`,
        "_rels/.rels",
      ),
    ).toBe(`<Relationship Target="xl/workbook.xml"/>`);
  });

  it("leaves regular files and non-ZIP data untouched", () => {
    const regular = writeZip([
      {
        name: "xl/workbook.xml",
        data: Buffer.from(`<workbook xmlns="${MAIN}"/>`),
      },
    ]);
    expect(normalizeXlsx(regular)).toBe(regular);
    const junk = Buffer.from("not a zip");
    expect(normalizeXlsx(junk)).toBe(junk);
    expect(readZipEntries(normalizeXlsx(openXmlSdkWorkbook())).length).toBe(6);
  });

  it("imports such a workbook: right sheet, header below a title, real row numbers", async () => {
    const result = await parseXlsxWithReport(
      openXmlSdkWorkbook().toString("base64"),
    );
    expect(result.rows.map((r) => r.name)).toEqual([
      "Autohaus Nord",
      "Autohaus Süd",
    ]);
    expect(result.rows[0]).toMatchObject({
      address: "Ring 1, 01067 Dresden",
      lat: 51.05,
      lon: 13.74,
      website: "https://www.autohaus-nord.example/",
      websiteSource: "manual",
    });
    expect(result.rowNumbers).toEqual([5, 7]);
    expect(result.report).toMatchObject({
      totalRows: 2,
      importedRows: 2,
      skippedRows: 0,
    });
    expect(result.report.columnMapping).toMatchObject({
      name: "Dealership Name",
      website: "Website",
    });
  });
});

describe("header row detection", () => {
  it("skips title lines above the column names in CSV files too", () => {
    const result = parseCsvWithReport(
      [
        "Portfolio export 2026",
        "",
        "Name;Adresse;Breite;Länge",
        "Autohaus A;Ring 1, Dresden;51,05;13,74",
      ].join("\n"),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      name: "Autohaus A",
      address: "Ring 1, Dresden",
    });
    expect(result.report.issues).toEqual([]);
  });
});
