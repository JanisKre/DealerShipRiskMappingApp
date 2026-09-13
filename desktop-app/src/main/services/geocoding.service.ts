import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";

/**
 * Geocoding via Nominatim — im Main-Process direkt aufrufbar (kein CORS).
 * Ergebnisse werden persistent gecacht. Nominatim verlangt einen User-Agent.
 */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const key = `geocode:${query.toLowerCase().trim()}`;
  return cached(key, TTL.geocode, async () => {
    const url = `${NOMINATIM}?format=json&limit=5&q=${encodeURIComponent(query)}`;
    const res = await fetchWithResilience(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return data.map((d) => ({
      label: d.display_name,
      lat: Number(d.lat),
      lon: Number(d.lon),
    }));
  });
}
