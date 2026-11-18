import { describe, expect, it } from "vitest";
import { addressKey, businessNameKey } from "./name-normalize";
import { dedupeDealerships } from "./dedupe";

describe("name and address keys", () => {
  it("folds umlauts and drops legal forms", () => {
    expect(businessNameKey("Autohaus Müller GmbH")).toBe(
      businessNameKey("Autohaus Mueller"),
    );
    expect(businessNameKey("Auto-Center Süd GmbH & Co. KG")).toBe(
      "auto center sued",
    );
  });

  it("treats Straße, Strasse and Str. alike", () => {
    expect(addressKey("Hauptstraße 5, 01067 Dresden")).toBe(
      addressKey("Hauptstr. 5, 01067 Dresden"),
    );
  });

  it("finds an import duplicate written two ways", () => {
    const { duplicates } = dedupeDealerships([
      {
        id: "a",
        name: "Autohaus Müller GmbH",
        address: "Hauptstraße 5, 01067 Dresden",
      },
      {
        id: "b",
        name: "Autohaus Mueller",
        address: "Hauptstr. 5, 01067 Dresden",
      },
    ]);
    expect(duplicates).toEqual([expect.objectContaining({ duplicateOf: "a" })]);
  });
});
