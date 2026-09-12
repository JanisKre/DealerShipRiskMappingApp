import type { OsmDetails } from "@shared/types";
import { haversineKm } from "@shared/risk-math";
import { cached, TTL } from "./cache.service";
import { fetchOverpass } from "./boundary.service";

/**
 * OSM extra info for a location (website, phone, opening hours, ...):
 * searches via Overpass for the nearest shop/amenity object in the vicinity
 * of the point and reads its tags. Returns `{}` when nothing is found —
 * not an error case, simply "OSM has no tags here".
 */

interface OverpassPoiElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export async function getOsmDetails(
  lat: number,
  lon: number,
): Promise<OsmDetails> {
  const key = `osmdetails:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached(key, TTL.osmDetails, async () => {
    const query = `
      [out:json][timeout:15];
      (
        node(around:75,${lat},${lon})["shop"];
        node(around:75,${lat},${lon})["amenity"];
        way(around:75,${lat},${lon})["shop"];
        way(around:75,${lat},${lon})["amenity"];
      );
      out center tags;`;
    const data = await fetchOverpass<OverpassPoiElement>(query);
    if (!data || data.elements.length === 0) return {};

    const nearest = data.elements
      .map((e) => {
        const p =
          e.center ?? (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
        return p ? { e, distanceKm: haversineKm(lat, lon, p.lat, p.lon) } : null;
      })
      .filter((x): x is { e: OverpassPoiElement; distanceKm: number } => x !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

    const tags = nearest?.e.tags ?? {};
    if (Object.keys(tags).length === 0) return {};

    return {
      name: tags.name,
      category: tags.shop ?? tags.amenity,
      website: tags.website ?? tags["contact:website"],
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
