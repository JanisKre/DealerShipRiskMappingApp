/**
 * In-memory view of the Overture dealer directory for what SQLite FTS5 cannot
 * do: typo-tolerant name matching ("Autohaus Mueler" → "Autohaus Müller") and
 * recognising a city or postcode in the query from the directory's own
 * addresses. Built once per directory release (~45,000 records, a few MB).
 *
 * Pure and Electron-free so it can be unit-tested with plain records.
 */
import type { DealerRecord } from "./overture-dealers";
import {
  FUZZY_MIN_SIMILARITY,
  GENERIC_NAME_TOKENS,
  distanceKm,
  foldedTokens,
  trigrams,
} from "../place-query";

/** A place the query names, with the area a dealer must be in to count as "there". */
export interface QueryLocality {
  kind: "city" | "postcode";
  /** As written in the directory ("Frankfurt am Main", "01067"). */
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

/** Large enough for Berlin or Hamburg around their dealer median. */
export const CITY_RADIUS_KM = 30;
export const POSTCODE_RADIUS_KM = 8;
/** Place names are matched from the end of the query: "… Frankfurt am Main". */
const MAX_LOCALITY_TOKENS = 3;

export interface FuzzyHit {
  record: DealerRecord;
  /** Average best token similarity over the query tokens (0–1). */
  similarity: number;
}

interface Area {
  name: string;
  lat: number;
  lon: number;
  count: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median position per key: robust against the odd record with a wrong city. */
function areas(
  records: readonly DealerRecord[],
  keysOf: (record: DealerRecord) => Array<{ key: string; name: string }>,
): Map<string, Area> {
  const grouped = new Map<
    string,
    { name: string; lats: number[]; lons: number[] }
  >();
  for (const record of records) {
    for (const { key, name } of keysOf(record)) {
      let group = grouped.get(key);
      if (!group) {
        group = { name, lats: [], lons: [] };
        grouped.set(key, group);
      }
      group.lats.push(record.lat);
      group.lons.push(record.lon);
    }
  }
  const out = new Map<string, Area>();
  for (const [key, group] of grouped) {
    out.set(key, {
      name: group.name,
      lat: median(group.lats),
      lon: median(group.lons),
      count: group.lats.length,
    });
  }
  return out;
}

export class DirectoryIndex {
  readonly size: number;
  private readonly records: readonly DealerRecord[];
  /** Folded name/brand token → indices of the records that contain it. */
  private readonly recordsByToken = new Map<string, number[]>();
  /** Trigram → name tokens containing it, for typo candidates. */
  private readonly tokensByGram = new Map<string, string[]>();
  private readonly gramsByToken = new Map<string, Set<string>>();
  private readonly cities: Map<string, Area>;
  private readonly postcodes: Map<string, Area>;

  constructor(records: readonly DealerRecord[]) {
    this.records = records;
    this.size = records.length;
    records.forEach((record, index) => {
      const tokens = new Set(
        foldedTokens(`${record.name} ${record.brand ?? ""}`),
      );
      for (const token of tokens) {
        const ids = this.recordsByToken.get(token);
        if (ids) ids.push(index);
        else this.recordsByToken.set(token, [index]);
      }
    });
    for (const token of this.recordsByToken.keys()) {
      if (token.length < 3) continue;
      const grams = trigrams(token);
      this.gramsByToken.set(token, grams);
      for (const gram of grams) {
        const tokens = this.tokensByGram.get(gram);
        if (tokens) tokens.push(token);
        else this.tokensByGram.set(gram, [token]);
      }
    }

    this.cities = areas(records, (record) => {
      const tokens = record.city ? foldedTokens(record.city) : [];
      return tokens.length > 0
        ? [{ key: tokens.join(" "), name: record.city as string }]
        : [];
    });
    // A multi-word city is also known by its first word ("Frankfurt"), unless
    // a city has exactly that name; the one with the most dealers wins.
    const shortForms = new Map<string, Area>();
    for (const [key, area] of this.cities) {
      const short = key.split(" ")[0];
      if (short === key || this.cities.has(short)) continue;
      const existing = shortForms.get(short);
      if (!existing || existing.count < area.count) shortForms.set(short, area);
    }
    for (const [short, area] of shortForms) this.cities.set(short, area);
    this.postcodes = areas(records, (record) =>
      record.postcode && /^\d{5}$/u.test(record.postcode)
        ? [{ key: record.postcode, name: record.postcode }]
        : [],
    );
  }

  /**
   * Finds the place a query names: its postcode, or a city written as its
   * last words with something left to search for ("Autohaus Müller Dresden").
   * With `standalone` (the query asks for a kind of dealer) the city may be
   * all there is ("Wohnmobil Hamburg"). Returns the remaining name tokens.
   */
  resolveLocality(
    nameTokens: readonly string[],
    postcode: string | null,
    standalone = false,
  ): { locality: QueryLocality | null; nameTokens: string[] } {
    const remaining = [...nameTokens];
    let city: QueryLocality | null = null;
    for (
      let n = Math.min(
        MAX_LOCALITY_TOKENS,
        remaining.length - (standalone ? 0 : 1),
      );
      n >= 1;
      n--
    ) {
      const area = this.cities.get(remaining.slice(-n).join(" "));
      if (area) {
        city = { kind: "city", ...areaPoint(area), radiusKm: CITY_RADIUS_KM };
        remaining.splice(-n, n);
        break;
      }
    }
    const postcodeArea = postcode ? this.postcodes.get(postcode) : undefined;
    const locality = postcodeArea
      ? {
          kind: "postcode" as const,
          ...areaPoint(postcodeArea),
          radiusKm: POSTCODE_RADIUS_KM,
        }
      : city;
    return { locality, nameTokens: remaining };
  }

  /**
   * Records whose name tokens are likely typos of every specific query
   * token. Generic words and tokens under four letters are not matched
   * fuzzily: too many dealers share them.
   */
  fuzzySearch(
    queryTokens: readonly string[],
    accept: (record: DealerRecord) => boolean,
    limit: number,
  ): FuzzyHit[] {
    const wanted = queryTokens.filter(
      (token) => token.length >= 4 && !GENERIC_NAME_TOKENS.has(token),
    );
    if (wanted.length === 0) return [];
    let scores: Map<number, number> | null = null;
    for (const queryToken of wanted) {
      const best = new Map<number, number>();
      for (const [token, similarity] of this.similarTokens(queryToken)) {
        for (const index of this.recordsByToken.get(token) ?? []) {
          if ((best.get(index) ?? 0) < similarity) best.set(index, similarity);
        }
      }
      // Every token must match, as in the FTS search.
      const next = new Map<number, number>();
      for (const [index, similarity] of best) {
        if (scores === null) next.set(index, similarity);
        else if (scores.has(index)) {
          next.set(index, (scores.get(index) ?? 0) + similarity);
        }
      }
      scores = next;
      if (scores.size === 0) return [];
    }
    return [...(scores ?? new Map<number, number>())]
      .map(([index, total]) => ({
        record: this.records[index],
        similarity: total / wanted.length,
      }))
      .filter((hit) => accept(hit.record))
      .sort(
        (a, b) =>
          b.similarity - a.similarity ||
          b.record.confidence - a.record.confidence,
      )
      .slice(0, limit);
  }

  /** Dealers of the given categories nearest to `locality`, inside its radius. */
  nearby(
    locality: QueryLocality,
    accept: (record: DealerRecord) => boolean,
    limit: number,
  ): DealerRecord[] {
    return this.records
      .map((record) => ({ record, km: distanceKm(locality, record) }))
      .filter(({ record, km }) => km <= locality.radiusKm && accept(record))
      .sort((a, b) => a.km - b.km)
      .slice(0, limit)
      .map(({ record }) => record);
  }

  private similarTokens(queryToken: string): Map<string, number> {
    const grams = trigrams(queryToken);
    const shared = new Map<string, number>();
    for (const gram of grams) {
      for (const token of this.tokensByGram.get(gram) ?? []) {
        shared.set(token, (shared.get(token) ?? 0) + 1);
      }
    }
    const out = new Map<string, number>();
    for (const [token, count] of shared) {
      const tokenGrams = this.gramsByToken.get(token);
      if (!tokenGrams) continue;
      // Both trigram sets are distinct, so `count` is their intersection.
      const similarity = token.startsWith(queryToken)
        ? 1
        : (2 * count) / (grams.size + tokenGrams.size);
      if (similarity >= FUZZY_MIN_SIMILARITY) out.set(token, similarity);
    }
    return out;
  }
}

function areaPoint(area: Area): { name: string; lat: number; lon: number } {
  return { name: area.name, lat: area.lat, lon: area.lon };
}
