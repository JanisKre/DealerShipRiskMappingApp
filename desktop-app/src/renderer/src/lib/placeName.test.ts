import { describe, expect, it } from "vitest";
import { nameForPlace } from "./placeName";

const DRESDEN_WETTERWARTE = {
  name: "Autohaus Dresden GmbH",
  lat: 51.1323678,
  lon: 13.782488,
};

describe("nameForPlace", () => {
  it("uses the business name when it is unique", () => {
    expect(
      nameForPlace(
        {
          label: "Autohaus Hescher Dresden, Spitzhausstraße 86, 01139 Dresden",
          lat: 51.09,
          lon: 13.69,
        },
        [DRESDEN_WETTERWARTE],
      ),
    ).toBe("Autohaus Hescher Dresden");
  });

  it("adds the street when another branch already has the same name", () => {
    expect(
      nameForPlace(
        {
          label:
            "Autohaus Dresden GmbH, Kötzschenbroder Str. 141, 01139 Dresden",
          lat: 51.0878,
          lon: 13.6788,
        },
        [{ ...DRESDEN_WETTERWARTE, name: "autohaus  dresden gmbh" }],
      ),
    ).toBe("Autohaus Dresden GmbH (Kötzschenbroder Str. 141)");
  });

  it("keeps the name for the same site picked again, so it is deduplicated", () => {
    expect(
      nameForPlace(
        {
          label: "Autohaus Dresden GmbH, Zur Wetterwarte 40, 01109 Dresden",
          lat: 51.1325,
          lon: 13.7826,
        },
        [DRESDEN_WETTERWARTE],
      ),
    ).toBe("Autohaus Dresden GmbH");
  });

  it("falls back to the town for OSM labels without a street", () => {
    expect(
      nameForPlace(
        {
          label: "Autohaus Dresden GmbH, 01067 Dresden, Sachsen, Deutschland",
          lat: 51.06,
          lon: 13.72,
        },
        [DRESDEN_WETTERWARTE],
      ),
    ).toBe("Autohaus Dresden GmbH (Dresden)");
  });

  it("qualifies brand-only names even without a collision", () => {
    expect(
      nameForPlace(
        {
          label: "Opel, Possendorfer Straße 38, 01217 Dresden",
          lat: 51,
          lon: 13,
        },
        [],
      ),
    ).toBe("Opel (Possendorfer Straße 38)");
  });

  it("keeps the name when there is nothing to qualify it with", () => {
    expect(nameForPlace({ label: "Nissan", lat: 50, lon: 8 }, [])).toBe(
      "Nissan",
    );
  });

  it("uses a street-only label as it is", () => {
    expect(
      nameForPlace({ label: "Ringweg 3, 80331 München", lat: 48, lon: 11 }, []),
    ).toBe("Ringweg 3");
  });
});
