/**
 * Address autocomplete via Photon (https://photon.komoot.io) — an OSM-based,
 * keyless geocoder from Komoot built specifically for type-ahead search.
 * Runs in the main process (no CORS, no renderer load).
 *
 * Unlike Google Places, Photon returns the label AND coordinates in ONE response —
 * so the former two-step autocomplete/details flow with a
 * session token is no longer needed. Reverse geocoding/geocoding for further processing stays
 * with Nominatim (see geocoding.service.ts).
 */
const PHOTON_URL = "https://photon.komoot.io/api";
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lon: number;
}

/** Photon feature properties (only the fields we need for the label). */
interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  country?: string;
}

/** Builds a readable, single-line address label from the Photon properties. */
function formatLabel(p: PhotonProps): string {
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(" ");
  const primary = p.name && p.name !== p.street ? p.name : streetLine;
  const locality = p.city ?? p.town ?? p.village ?? p.county;
  const parts = [
    primary || streetLine,
    [p.postcode, locality].filter(Boolean).join(" "),
    p.state,
    p.country,
  ].filter((s): s is string => Boolean(s && s.trim()));
  return parts.join(", ");
}

export async function placesAutocomplete(
  query: string,
): Promise<PlaceSuggestion[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&lang=de&limit=5`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: PhotonProps;
    }>;
  };
  return (data.features ?? [])
    .filter((f) => Array.isArray(f.geometry?.coordinates))
    .map((f) => {
      const [lon, lat] = f.geometry!.coordinates!;
      const label = formatLabel(f.properties ?? {});
      return {
        label: label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        lat,
        lon,
      };
    });
}
