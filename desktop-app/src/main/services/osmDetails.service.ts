import type { OsmDetails } from "@shared/types";
import { haversineKm } from "@shared/risk-math";
import { normalizeWebsiteUrl } from "@shared/website";
import { cached, TTL } from "./cache.service";
import { fetchOverpass } from "./boundary.service";

/**
 * OSM extra info for a location (website, phone, opening hours, ...):
 * searches via Overpass for the matching dealership POI in the vicinity of
 * the point and reads its tags. Only a car-related POI or one whose name
 * matches the dealership is accepted — the nearest pharmacy's website is
 * worse than none. Returns `{}` when nothing fits — not an error case, simply
 * "OSM has no such object here". An unreachable Overpass throws instead, so
 * an outage is never cached as "no details".
 */

export interface OverpassPoiElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface PoiCandidate {
  e: OverpassPoiElement;
  score: number;
  distanceKm: number;
}

/** POI categories a dealership can plausibly be mapped as in OSM. */
const CAR_SHOPS = new Set([
  "car",
  "car_repair",
  "car_parts",
  "tyres",
  "motorcycle",
]);
const CAR_AMENITIES = new Set(["car_rental", "car_wash"]);

/**
 * Words too generic to identify a dealership by name ("Autohaus Müller
 * GmbH" is matched on "muller", not on "autohaus" or "gmbh").
 */
const GENERIC_NAME_TOKENS = new Set([
  "auto",
  "autohaus",
  "autohandel",
  "autos",
  "automobile",
  "automobil",
  "autocenter",
  "autozentrum",
  "center",
  "centrum",
  "zentrum",
  "gmbh",
  "mbh",
  "co",
  "kg",
  "ag",
  "ohg",
  "ug",
  "ek",
  "und",
  "the",
  "and",
  "car",
  "cars",
  "garage",
  "haus",
  "service",
  "filiale",
  "niederlassung",
  "vertrieb",
  "handel",
]);

export async function getOsmDetails(
  lat: number,
  lon: number,
  name?: string,
  address?: string,
): Promise<OsmDetails> {
  const key = `osmdetails:v2:${lat.toFixed(5)},${lon.toFixed(5)}:${(name ?? "").toLowerCase()}`;
  return cached(key, TTL.osmDetails, async () => {
    const query = `
      [out:json][timeout:15];
      (
        nwr(around:500,${lat},${lon})["shop"];
        nwr(around:500,${lat},${lon})["amenity"];
      );
      out center tags;`;
    const data = await fetchOverpass<OverpassPoiElement>(query);
    if (!data) throw new Error("Overpass unavailable for OSM details");

    const tags = pickDealershipPoi(
      data.elements,
      lat,
      lon,
      name,
      address,
    )?.tags;
    if (!tags || Object.keys(tags).length === 0) return {};

    return {
      name: tags.name,
      category: tags.shop ?? tags.amenity,
      website: normalizeWebsiteUrl(tags.website ?? tags["contact:website"]),
      phone: tags.phone ?? tags["contact:phone"],
      email: tags.email ?? tags["contact:email"],
      openingHours: tags.opening_hours,
      brand: tags.brand,
      address: {
        road: tags["addr:street"],
        houseNumber: tags["addr:housenumber"],
        postcode: tags["addr:postcode"],
        city: tags["addr:city"],
      },
    };
  });
}

/**
 * Best POI for the dealership among Overpass results, or `null` when none is
 * car-related or name-matching. Name match beats category, which beats
 * having a website and proximity.
 */
export function pickDealershipPoi(
  elements: OverpassPoiElement[],
  lat: number,
  lon: number,
  name?: string,
  address?: string,
): OverpassPoiElement | null {
  const nameTokens = significantTokens(name);
  const street = streetTokens(address);
  const best = elements
    .map((e): PoiCandidate | null => {
      const p =
        e.center ??
        (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
      if (!p) return null;
      const tags = e.tags ?? {};
      const poiTokens = new Set(
        tokens(
          [tags.name, tags.brand, tags.operator, tags.website]
            .filter(Boolean)
            .join(" "),
        ),
      );
      const nameMatch = nameTokens.some((token) => poiTokens.has(token));
      const carShop = tags.shop === "car";
      const carRelated =
        carShop ||
        CAR_SHOPS.has(tags.shop ?? "") ||
        CAR_AMENITIES.has(tags.amenity ?? "");
      if (!nameMatch && !carRelated) return null;

      const distanceKm = haversineKm(lat, lon, p.lat, p.lon);
      const streetMatch =
        street.length > 0 &&
        street.every((token) =>
          tokens(tags["addr:street"] ?? "").includes(token),
        );
      const score =
        (nameMatch ? 20 : 0) +
        (carShop ? 10 : carRelated ? 4 : 0) +
        (streetMatch ? 3 : 0) +
        (tags.website || tags["contact:website"] ? 5 : 0) +
        (tags.name || tags.brand ? 1 : 0) +
        Math.max(0, 5 - distanceKm * 10);
      return { e, score, distanceKm };
    })
    .filter((x): x is PoiCandidate => x !== null)
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm)[0];
  return best?.e ?? null;
}

/** Lower-case ASCII tokens; "Musterstraße"/"Musterstr." both become "musterstr". */
function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.replace(/strasse$/, "str"));
}

/** Name tokens that can identify a business: ≥ 3 chars, not generic. */
function significantTokens(value?: string): string[] {
  return tokens(value ?? "").filter(
    (token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token),
  );
}

/** Street-name tokens from "Musterstraße 12, 80331 München" (before the comma). */
function streetTokens(address?: string): string[] {
  const street = address?.split(",")[0] ?? "";
  return tokens(street).filter((token) => !/^\d/.test(token));
}
