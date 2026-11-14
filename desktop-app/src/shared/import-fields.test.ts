import { describe, expect, it } from "vitest";
import {
  ColumnOverridesSchema,
  cleanMappingSuggestion,
  columnHint,
} from "./import-fields";

describe("column hints", () => {
  it("recognises the common column types", () => {
    expect(columnHint([])).toBe("empty");
    expect(columnHint(["", " "])).toBe("empty");
    expect(columnHint(["Autohaus Nord", "Autohaus Süd"])).toBe("text");
    expect(columnHint(["10115", "80331", "01067"])).toBe("postcode");
    expect(columnHint(["52.52001", "48.13743"])).toBe("latitude");
    expect(columnHint(["13.40495", "11.57549"])).toBe("longitude");
    expect(columnHint(["1.250.000", "980.000 €"])).toBe("amount");
    expect(columnHint(["12,5", "3"])).toBe("number");
    expect(columnHint(["https://a.de", "www.b.de"])).toBe("url");
    expect(columnHint(["ja", "Nein", "JA"])).toBe("yesNo");
  });

  it("needs most values to match", () => {
    expect(columnHint(["10115", "Berlin", "Hamburg"])).toBe("text");
  });
});

describe("column overrides", () => {
  it("allows one field per column only", () => {
    expect(
      ColumnOverridesSchema.safeParse({ name: "Firma", city: "Ort" }).success,
    ).toBe(true);
    expect(
      ColumnOverridesSchema.safeParse({ name: "Firma", city: "Firma" }).success,
    ).toBe(false);
    expect(ColumnOverridesSchema.safeParse({ bogus: "x" }).success).toBe(false);
  });
});

describe("mapping suggestion", () => {
  it("keeps only applicable suggestions", () => {
    const columns = [
      { name: "Firma", hint: "text" as const, field: "name" as const },
      { name: "Wert", hint: "amount" as const, field: null },
      { name: "Gebiet", hint: "text" as const, field: null },
      { name: "Anschrift", hint: "text" as const, field: "address" as const },
      { name: "Ort", hint: "text" as const, field: null },
    ];
    expect(
      cleanMappingSuggestion(columns, [
        { column: "Wert", field: "assetValue" },
        { column: "Firma", field: "group" },
        { column: "Gebiet", field: "name" },
        { column: "Gebiet", field: "subPortfolio" },
        { column: "Ort", field: "city" },
        { column: "Erfunden", field: "group" },
        { column: "Gebiet", field: "bogus" },
      ]),
    ).toEqual({ assetValue: "Wert", subPortfolio: "Gebiet" });
  });
});
