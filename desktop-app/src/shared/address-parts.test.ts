import { describe, expect, it } from "vitest";
import { houseNumberOf, isPoBox, postcodeOf } from "./address-parts";

describe("address parts", () => {
  it("reads the house number of the street part", () => {
    expect(houseNumberOf("Hauptstr. 12a, 80331 München")).toBe("12a");
    expect(houseNumberOf("Straße des 17. Juni 135, 10623 Berlin")).toBe("135");
    expect(houseNumberOf("80331 München, Hauptstraße 7")).toBe("7");
    expect(houseNumberOf("Industriestraße, 01067 Dresden")).toBeUndefined();
  });

  it("reads the postcode before the place", () => {
    expect(postcodeOf("Hauptstr. 12, 01067 Dresden")).toBe("01067");
    expect(postcodeOf(undefined)).toBeUndefined();
  });

  it("recognises post-office boxes", () => {
    expect(isPoBox("Postfach 10 12 34, 80331 München")).toBe(true);
    expect(isPoBox("PO Box 12")).toBe(true);
    expect(isPoBox("Postfachweg 3, 12345 Ort")).toBe(false);
    expect(isPoBox("Hauptstr. 1")).toBe(false);
  });
});
