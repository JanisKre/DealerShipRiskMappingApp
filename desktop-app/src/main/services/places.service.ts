/**
 * Address and dealership autocomplete. Runs in the main process (no CORS, no
 * renderer load) and combines three things:
 *
 * - Photon (https://photon.komoot.io), the keyless OSM geocoder from Komoot
 *   built for type-ahead: one query for car dealerships (`shop=car`), one for
 *   everything. Label and coordinates come in one response.
 * - The local Overture Maps dealer directory (dealer-directory.service.ts),
 *   which fills the many gaps OSM has for small businesses.
 * - The saved portfolios, so a hit that already is a portfolio location says
 *   so and ranks higher.
 *
 * The query is first understood offline (place-query.ts): legal forms
 * dropped, umlauts folded, category words ("Motorradhändler") and a city or
 * postcode at the end recognised. All hits are then merged and ranked by one
 * score (place-ranking.ts). Reverse geocoding stays with Nominatim
 * (geocoding.service.ts).
 *
 * Photon is a shared public service that throttles and, under heavy use,
 * temporarily refuses a client's address. Type-ahead therefore asks it
 * sparingly: answers are cached, a failed request is not retried (the next
 * keystroke asks again anyway), and after a failure Photon is left alone for
 * a cooldown. While it is unavailable the search still answers from the local
 * dealer directory and the portfolios, and says that the online part is
 * missing instead of failing as a whole.
 */
import type { QueryLocality } from "./dealer-directory/directory-index";
import {
  resolveQueryLocality,
  searchDealerDirectory,
} from "./dealer-directory.service";
import { fetchWithResilience, HttpRequestError } from "./http.service";
import {
  normalisePlaceQuery,
  parsePlaceQuery,
  similarBusinessNames,
} from "./place-query";
import {
  rankPlaces,
  type PlaceCandidate,
  type PlaceSource,
} from "./place-ranking";
import {
  matchPortfolio,
  portfolioEntries,
  type PortfolioMatch,
  type PortfolioEntry,
} from "./portfolio-index.service";

export { normalisePlaceQuery, similarBusinessNames };

const PHOTON_URL = "https://photon.komoot.io/api";
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/** Bias used without a map position: Germany as a whole. */
const DEFAULT_BIAS = { lat: 51.16, lon: 10.45, zoom: 6 };
const PHOTON_LIMIT = 8;
const PHOTON_DEALER_LIMIT = 5;
const DIRECTORY_LIMIT = 6;
/** Type-ahead must stay snappy; a slow Photon is treated as unavailable. */
const PHOTON_TIMEOUT_MS = 6_000;
/** How long a Photon answer is reused for the same query and bias. */
const PHOTON_CACHE_TTL_MS = 10 * 60_000;
const PHOTON_CACHE_MAX = 200;
/** Pause after a failure; a Retry-After header may ask for longer. */
const PHOTON_COOLDOWN_MS = 2 * 60_000;
const PHOTON_COOLDOWN_MAX_MS = 15 * 60_000;

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lon: number;
  source?: PlaceSource;
  /** Every source that knows the place (both = confirmed). */
  sources?: PlaceSource[];
  /** Saved portfolio locations this place already is. */
  portfolio?: PortfolioMatch[];
  /** No source knows the street; the point may be off the site. */
  approximate?: boolean;
}

export interface PlacesAutocompleteResult {
  suggestions: PlaceSuggestion[];
  /**
   * True when the online geocoder (Photon) could not be asked, so the
   * suggestions come from the local directory and the portfolios only.
   */
  onlineUnavailable: boolean;
}

export interface SearchBias {
  lat: number;
  lon: number;
  zoom?: number;
}

/** Photon feature properties (only the fields we need). */
interface PhotonProps {
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
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

const photonCache = new Map<
  string,
  { at: number; candidates: PlaceCandidate[] }
>();
let photonPausedUntil = 0;

/** Clears cache and cooldown (tests, and a manual retry later on). */
export function resetPhotonState(): void {
  photonCache.clear();
  photonPausedUntil = 0;
}

class PhotonUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotonUnavailableError";
  }
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function pausePhoton(ms: number = PHOTON_COOLDOWN_MS): void {
  const until = Date.now() + Math.min(PHOTON_COOLDOWN_MAX_MS, Math.max(ms, 0));
  photonPausedUntil = Math.max(photonPausedUntil, until);
}

/**
 * One Photon query, served from the cache when possible. Failures that say
 * "leave me alone" (network refusal, timeout, 403, 429, 5xx) start the
 * cooldown; a 400 for a single odd query does not.
 */
async function photonSearch(
  query: string,
  bias: Required<SearchBias>,
  limit: number,
  osmTag?: string,
): Promise<PlaceCandidate[]> {
  const key = JSON.stringify([query, bias, limit, osmTag ?? null]);
  const cached = photonCache.get(key);
  if (cached && Date.now() - cached.at < PHOTON_CACHE_TTL_MS) {
    return cached.candidates;
  }
  if (Date.now() < photonPausedUntil) {
    throw new PhotonUnavailableError("Photon paused after a failure");
  }
  const candidates = await photonFetch(query, bias, limit, osmTag);
  photonCache.delete(key);
  photonCache.set(key, { at: Date.now(), candidates });
  while (photonCache.size > PHOTON_CACHE_MAX) {
    const oldest = photonCache.keys().next().value;
    if (oldest === undefined) break;
    photonCache.delete(oldest);
  }
  return candidates;
}

async function photonFetch(
  query: string,
  bias: Required<SearchBias>,
  limit: number,
  osmTag?: string,
): Promise<PlaceCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    lang: "de",
    limit: String(limit),
    lat: String(bias.lat),
    lon: String(bias.lon),
    zoom: String(bias.zoom),
  });
  if (osmTag) params.set("osm_tag", osmTag);
  let res: Response;
  try {
    res = await fetchWithResilience(
      `${PHOTON_URL}?${params}`,
      { headers: { "User-Agent": USER_AGENT } },
      { retries: 0, timeoutMs: PHOTON_TIMEOUT_MS },
    );
  } catch (err) {
    pausePhoton();
    throw err;
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      pausePhoton(retryAfterMs(res) ?? PHOTON_COOLDOWN_MS);
    }
    throw new HttpRequestError(`Photon ${res.status}`, { status: res.status });
  }
  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: PhotonProps;
    }>;
  };
  return (data.features ?? [])
    .filter((f) => Array.isArray(f.geometry?.coordinates))
    .map((f, index) => {
      const [lon, lat] = f.geometry!.coordinates!;
      const props = f.properties ?? {};
      const label = formatLabel(props);
      return {
        label: label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        lat,
        lon,
        osmKey:
          props.osm_type && props.osm_id != null
            ? `${props.osm_type}${props.osm_id}`
            : null,
        name: props.name ?? null,
        source: "osm" as const,
        dealer:
          osmTag != null ||
          (props.osm_key === "shop" && props.osm_value === "car"),
        hasHouseNumber: Boolean(props.housenumber),
        sourceRank: index,
      };
    });
}

/**
 * Where Photon should look: the place the query names, else the map view
 * (city level at most — closer zooms would hide the right dealership one
 * town over), else Germany.
 */
export function photonBias(
  locality: QueryLocality | null,
  near: SearchBias | undefined,
): Required<SearchBias> {
  if (locality) {
    return {
      lat: locality.lat,
      lon: locality.lon,
      zoom: locality.kind === "postcode" ? 12 : 11,
    };
  }
  if (near) {
    return {
      lat: near.lat,
      lon: near.lon,
      zoom: Math.min(12, Math.max(5, Math.round(near.zoom ?? 10))),
    };
  }
  return DEFAULT_BIAS;
}

function safePortfolioEntries(): PortfolioEntry[] {
  try {
    return portfolioEntries();
  } catch (err) {
    // The badge is a nicety; the search itself must still answer.
    console.error("Portfolio lookup for search failed:", err);
    return [];
  }
}

export async function placesAutocomplete(
  query: string,
  near?: SearchBias,
): Promise<PlacesAutocompleteResult> {
  const parsed = parsePlaceQuery(query);
  const { locality, nameTokens } = resolveQueryLocality(parsed);
  const bias = photonBias(locality, near);

  const [dealerships, general] = await Promise.allSettled([
    photonSearch(parsed.text, bias, PHOTON_DEALER_LIMIT, "shop:car"),
    photonSearch(parsed.text, bias, PHOTON_LIMIT),
  ]);
  const onlineUnavailable =
    dealerships.status === "rejected" && general.status === "rejected";
  if (
    onlineUnavailable &&
    !(general.reason instanceof PhotonUnavailableError)
  ) {
    // The raw cause goes to the log; the user gets the local hits and a note.
    console.warn("Photon search failed:", general.reason);
  }
  const directoryHits: PlaceCandidate[] = searchDealerDirectory({
    nameTokens,
    categories: parsed.categories,
    locality,
    near,
    limit: DIRECTORY_LIMIT,
  }).map((hit, index) => ({
    label: hit.label,
    lat: hit.lat,
    lon: hit.lon,
    osmKey: null,
    name: hit.name,
    source: "overture",
    dealer: true,
    hasHouseNumber: /\d/u.test(hit.street ?? ""),
    addressKnown: Boolean(hit.street?.trim()),
    sourceRank: index,
  }));

  // First-seen order only breaks ties; OSM comes first because it carries
  // the richer address when both sources know a place.
  const candidates = [
    ...(dealerships.status === "fulfilled" ? dealerships.value : []),
    ...(general.status === "fulfilled" ? general.value : []),
    ...directoryHits,
  ];
  const entries = safePortfolioEntries();
  const suggestions = rankPlaces(candidates, {
    tokens: nameTokens,
    addressIntent: parsed.addressIntent,
    focus: locality ?? near,
    locality,
    portfolio: (place) => matchPortfolio(place, entries),
  }).map(({ label, lat, lon, source, sources, portfolio, approximate }) => ({
    label,
    lat,
    lon,
    source,
    sources,
    ...(portfolio.length > 0 ? { portfolio } : {}),
    ...(approximate ? { approximate } : {}),
  }));
  return { suggestions, onlineUnavailable };
}
