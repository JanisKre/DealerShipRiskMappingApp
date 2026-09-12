import type { OsmDetails } from "@shared/types";
import { haversineKm } from "@shared/risk-math";
import { cached, TTL } from "./cache.service";
import { fetchOverpass } from "./boundary.service";

/**
 * OSM extra info for a location (website, phone, opening hours, ...):
 * searches via Overpass for the best matching shop/amenity object in the
 * vicinity of the point and reads its tags. The dealership name is used to
 * prefer the correct business when several POIs are nearby. Returns `{}` when
 * nothing is found — not an error case, simply "OSM has no tags here".
 */

interface OverpassPoiElement {
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

export async function getOsmDetails(
  lat: number,
  lon: number,
  name?: string,
  address?: string,
): Promise<OsmDetails> {
  const key = `osmdetails:${lat.toFixed(5)},${lon.toFixed(5)}:${(name ?? "").toLowerCase()}`;
  return cached(key, TTL.osmDetails, async () => {
    const query = `
      [out:json][timeout:15];
      (
        nwr(around:500,${lat},${lon})["shop"];
        nwr(around:500,${lat},${lon})["amenity"];
      );
      out center tags;`;
    const data = await fetchOverpass<OverpassPoiElement>(query);
    if (!data || data.elements.length === 0) return {};

    const matchingText = [name, address]
      .filter((value): value is string => Boolean(value))
      .map(normalizeText)
      .filter((value) => value.length > 0);
    const best = data.elements
      .map((e) => {
        const p =
          e.center ??
          (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
        if (!p) return null;
        const distanceKm = haversineKm(lat, lon, p.lat, p.lon);
        const poiText = normalizeText(
          [
            e.tags?.name,
            e.tags?.brand,
            e.tags?.["addr:street"],
            e.tags?.["addr:city"],
          ]
            .filter(Boolean)
            .join(" "),
        );
        const nameMatch = matchingText.some(
          (needle) => needle.length >= 4 && poiText.includes(needle),
        );
        const websiteBonus =
          e.tags?.website || e.tags?.["contact:website"] ? 5 : 0;
        const nameBonus = e.tags?.name || e.tags?.brand ? 1 : 0;
        const matchBonus = nameMatch ? 20 : 0;
        const proximityScore = Math.max(0, 5 - distanceKm * 10);
        return {
          e,
          score: matchBonus + websiteBonus + nameBonus + proximityScore,
          distanceKm,
        };
      })
      .filter((x): x is PoiCandidate => x !== null)
      .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm)[0];

    const tags = best?.e.tags ?? {};
    if (Object.keys(tags).length === 0) return {};

    return {
      name: tags.name,
      category: tags.shop ?? tags.amenity,
      website: normalizeWebsite(tags.website ?? tags["contact:website"]),
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

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeWebsite(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
