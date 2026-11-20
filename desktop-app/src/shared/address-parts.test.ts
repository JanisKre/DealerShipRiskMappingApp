import { describe, expect, it } from "vitest";
import {
  houseNumberOf,
  isPoBox,
  postcodeAndTown,
  postcodeOf,
} from "./address-parts";

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

describe("postcodeAndTown", () => {
  it("returns postcode and town of the usual formats", () => {
    expect(postcodeAndTown("Geheimweg 5, 01067 Dresden")).toBe("01067 Dresden");
    expect(postcodeAndTown("Ring 2, 60311 Frankfurt am Main")).toBe(
      "60311 Frankfurt am Main",
    );
    expect(postcodeAndTown("Weg 1, 83646 Bad Tölz, Deutschland")).toBe(
      "83646 Bad Tölz",
    );
    expect(postcodeAndTown("Ohne Postleitzahl 3, Dresden")).toBeUndefined();
    expect(postcodeAndTown(undefined)).toBeUndefined();
  });

  it("never passes a street on, whatever the format", () => {
    for (const address of [
      "01067 Dresden Geheimweg 5",
      "Geheimweg 5; 01067 Dresden; Hinterhof Halle 3",
      "D-01067 Dresden - Geheimweg 5",
      "Geheimweg 12345 Nord, 01067 Dresden",
      "01067 Dresden Am Geheimhang 5",
      "01067 Dresden\nGeheimweg 5",
    ]) {
      const place = postcodeAndTown(address);
      expect(place, address).toBe("01067 Dresden");
    }
    expect(postcodeAndTown("83646 Bad Tölz Geheimstraße 7")).toBe(
      "83646 Bad Tölz",
    );
  });
});
