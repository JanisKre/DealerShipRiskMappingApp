/**
 * Name for a location added from a search suggestion.
 *
 * The label's first segment is the business name. Dealer groups often name
 * every branch the same ("Autohaus Dresden GmbH" at four addresses), and some
 * Overture places carry only the brand ("Opel"). Taken verbatim, two different
 * sites then look identical in the list, on the map and in reports. In those
 * cases the street (or, failing that, the town) is appended:
 * "Autohaus Dresden GmbH (Kötzschenbroder Str. 141)".
 *
 * A same-named location at the same spot is the same site picked again: the
 * name stays as it is so the duplicate check (`dedupeDealerships`) skips it.
 */

import { haversineMeters, NEAR_METERS } from "@shared/dedupe";

/** Brands that appear on their own as a place name. */
const BRAND_ONLY_NAMES = new Set([
  "abarth",
  "alfa romeo",
  "audi",
  "bmw",
  "byd",
  "citroën",
  "citroen",
  "cupra",
  "dacia",
  "ds",
  "fiat",
  "ford",
  "honda",
  "hyundai",
  "iveco",
  "jaguar",
  "jeep",
  "kia",
  "land rover",
  "lexus",
  "man",
  "mazda",
  "mercedes",
  "mercedes-benz",
  "mg",
  "mini",
  "mitsubishi",
  "nissan",
  "opel",
  "peugeot",
  "polestar",
  "porsche",
  "renault",
  "seat",
  "skoda",
  "škoda",
  "smart",
  "subaru",
  "suzuki",
  "tesla",
  "toyota",
  "volkswagen",
  "volvo",
  "vw",
]);

const STREET_HINT =
  /\d|stra(ss|ß)e\b|str\.|weg\b|platz\b|allee\b|ring\b|damm\b|gasse\b|ufer\b|chaussee\b|markt\b/iu;
const POSTCODE_PLACE = /^\d{5}\s+(.+)$/u;

function normalise(name: string): string {
  return name.trim().toLocaleLowerCase("de").replace(/\s+/gu, " ");
}

interface ExistingLocation {
  name: string;
  lat?: number;
  lon?: number;
}

export function nameForPlace(
  place: { label: string; lat: number; lon: number },
  existing: readonly ExistingLocation[],
): string {
  const segments = place.label
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const base = segments[0] ?? place.label.trim();
  const sameName = existing.filter(
    (location) => normalise(location.name) === normalise(base),
  );
  const sameSite = sameName.some(
    (location) =>
      location.lat != null &&
      location.lon != null &&
      haversineMeters(location.lat, location.lon, place.lat, place.lon) <
        NEAR_METERS,
  );
  if (sameSite) return base;
  if (sameName.length === 0 && !BRAND_ONLY_NAMES.has(normalise(base))) {
    return base;
  }

  const rest = segments.slice(1);
  const street = rest.find(
    (segment) => !POSTCODE_PLACE.test(segment) && STREET_HINT.test(segment),
  );
  const town = rest
    .map((segment) => POSTCODE_PLACE.exec(segment)?.[1])
    .find(Boolean);
  const qualifier = street ?? town;
  if (!qualifier || normalise(qualifier) === normalise(base)) return base;
  return `${base} (${qualifier})`;
}
