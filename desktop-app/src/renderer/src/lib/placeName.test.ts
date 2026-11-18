import { describe, expect, it } from "vitest";
import { nameForPlace } from "./placeName";

const DRESDEN_BRANCH = {
  name: "Autohaus Muster Dresden GmbH",
  lat: 51.132,
  lon: 13.782,
};

describe("nameForPlace", () => {
  it("uses the business name when it is unique", () => {
    expect(
      nameForPlace(
        {
          label: "Autohaus Beispiel Dresden, Musterstraße 86, 01139 Dresden",
          lat: 51.09,
          lon: 13.69,
        },
        [DRESDEN_BRANCH],
      ),
    ).toBe("Autohaus Beispiel Dresden");
  });

  it("adds the street when another branch already has the same name", () => {
    expect(
      nameForPlace(
        {
          label:
            "Autohaus Muster Dresden GmbH, Beispielstraße 141, 01139 Dresden",
          lat: 51.088,
          lon: 13.679,
        },
        [{ ...DRESDEN_BRANCH, name: "autohaus  muster dresden gmbh" }],
      ),
    ).toBe("Autohaus Muster Dresden GmbH (Beispielstraße 141)");
  });

  it("keeps the name for the same site picked again, so it is deduplicated", () => {
    expect(
      nameForPlace(
        {
          label: "Autohaus Muster Dresden GmbH, Musterweg 40, 01109 Dresden",
          lat: 51.1321,
          lon: 13.7822,
        },
        [DRESDEN_BRANCH],
      ),
    ).toBe("Autohaus Muster Dresden GmbH");
  });

  it("falls back to the town for OSM labels without a street", () => {
    expect(
      nameForPlace(
        {
          label:
            "Autohaus Muster Dresden GmbH, 01067 Dresden, Sachsen, Deutschland",
          lat: 51.06,
          lon: 13.72,
        },
        [DRESDEN_BRANCH],
      ),
    ).toBe("Autohaus Muster Dresden GmbH (Dresden)");
  });

  it("qualifies brand-only names even without a collision", () => {
    expect(
      nameForPlace(
        {
          label: "Opel, Lindenallee 38, 01217 Dresden",
          lat: 51,
          lon: 13,
        },
        [],
      ),
    ).toBe("Opel (Lindenallee 38)");
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
