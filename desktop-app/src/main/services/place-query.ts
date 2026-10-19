// German legal forms, longest first so "GmbH & Co. KG" is removed as a whole.
const LEGAL_FORM =
  /(^|\s)(gmbh\s*&\s*co\.?\s*kg|gmbh|mbh|ag|kg|ohg|gbr|e\.\s?k\.|ug(\s*\(haftungsbeschränkt\))?)(?=\s|,|$)/giu;

/**
 * Removes legal forms from a business-name query. OSM rarely records them,
 * and every extra token Photon cannot match pushes the real hit down.
 */
export function normalisePlaceQuery(query: string): string {
  const stripped = query
    .replace(LEGAL_FORM, " ")
    .replace(/\s*[,&+]\s*$/u, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return stripped || query.trim();
}

/**
 * Folds text for matching: lower case, ß → ss, ä/ö/ü → ae/oe/ue, every other
 * diacritic dropped. "Müller" and "Mueller" fold to the same key, as do
 * "Škoda" and "Skoda".
 */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/gu, "ss")
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Folded word tokens of `text`, legal forms removed. */
export function foldedTokens(text: string): string[] {
  return foldText(normalisePlaceQuery(text))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Words every second dealer name contains; they say nothing about identity. */
export const GENERIC_NAME_TOKENS = new Set([
  "autohaus",
  "autohaeuser",
  "auto",
  "autos",
  "automobile",
  "automobil",
  "autocenter",
  "autozentrum",
  "autohandel",
  "autohaendler",
  "haendler",
  "kfz",
  "car",
  "cars",
  "dealer",
  "service",
  "center",
  "zentrum",
  "handel",
  "und",
]);

/**
 * Brand spellings that name the same make. A query for one finds dealers
 * that carry another ("VW" → "Volkswagen Zentrum").
 */
const BRAND_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["volkswagen", "vw"],
  ["mercedes", "benz", "daimler"],
  ["landrover", "rover"],
  ["chevrolet", "chevy"],
];

const BRAND_ALIASES = new Map<string, readonly string[]>();
for (const group of BRAND_ALIAS_GROUPS) {
  for (const token of group) {
    BRAND_ALIASES.set(
      foldText(token),
      group.map(foldText).filter((t) => t !== foldText(token)),
    );
  }
}

/** Other spellings of the same make, without `token` itself. */
export function brandAliases(token: string): readonly string[] {
  return BRAND_ALIASES.get(token) ?? [];
}

/**
 * Words that ask for a kind of dealer rather than a name. They select
 * Overture categories instead of being matched against names; a token counts
 * when it starts with one of the stems ("Wohnmobilhändler" → RV dealers).
 */
const CATEGORY_INTENTS: ReadonlyArray<{
  stems: readonly string[];
  categories: readonly string[];
}> = [
  {
    stems: ["gebrauchtwagen", "gebraucht", "used"],
    categories: ["used_auto_dealer", "used_car_dealer"],
  },
  {
    stems: ["lkw", "nutzfahrzeug", "truck"],
    categories: ["truck_dealer", "commercial_vehicle_dealer"],
  },
  { stems: ["motorrad", "motorcycle"], categories: ["motorcycle_dealer"] },
  {
    stems: ["wohnmobil", "wohnwagen", "reisemobil", "caravan", "camper"],
    categories: ["recreational_vehicle_dealer"],
  },
  { stems: ["anhaenger", "trailer"], categories: ["trailer_dealer"] },
];

function categoriesFor(token: string): readonly string[] {
  for (const intent of CATEGORY_INTENTS) {
    if (intent.stems.some((stem) => token.startsWith(stem))) {
      return intent.categories;
    }
  }
  return [];
}

const POSTCODE = /^\d{5}$/u;
const HOUSE_NUMBER = /^\d{1,4}[a-z]?$/u;

export interface ParsedPlaceQuery {
  /** Query as sent to Photon: legal forms dropped, otherwise as typed. */
  text: string;
  /** Every folded token, in order. */
  tokens: string[];
  /** Tokens that identify the business: no category words, no numbers. */
  nameTokens: string[];
  /** A German five-digit postcode in the query. */
  postcode: string | null;
  /** A house number means the user is typing an address. */
  addressIntent: boolean;
  /** Overture categories asked for ("Motorradhändler" → motorcycle dealers). */
  categories: string[];
}

/**
 * Splits a search into what it says about the business (name), its kind
 * (category words) and its location (postcode, house number). Place names
 * need the directory and are resolved by `resolveQueryLocality`.
 */
export function parsePlaceQuery(query: string): ParsedPlaceQuery {
  const text = normalisePlaceQuery(query);
  const tokens = foldedTokens(text);
  const categories = new Set<string>();
  const nameTokens: string[] = [];
  let postcode: string | null = null;
  let addressIntent = false;
  for (const token of tokens) {
    if (POSTCODE.test(token)) {
      postcode ??= token;
      continue;
    }
    if (HOUSE_NUMBER.test(token)) {
      addressIntent = true;
      continue;
    }
    const intent = categoriesFor(token);
    if (intent.length > 0) {
      for (const category of intent) categories.add(category);
      continue;
    }
    nameTokens.push(token);
  }
  return {
    text,
    tokens,
    nameTokens,
    postcode,
    addressIntent,
    categories: [...categories],
  };
}

/** Distinct letter trigrams of a token, padded so short tokens still have some. */
export function trigrams(token: string): Set<string> {
  const padded = ` ${token} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++)
    grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Dice coefficient of two trigram sets: 1 = same token, 0 = nothing shared. */
export function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** Below this, two tokens are different words rather than a typo. */
export const FUZZY_MIN_SIMILARITY = 0.6;

/**
 * How well one query token matches one name token: 1 for a prefix match or
 * an alias of the same brand, the trigram similarity for a likely typo of a
 * token of four letters or more, otherwise 0.
 */
export function tokenMatch(queryToken: string, nameToken: string): number {
  if (nameToken.startsWith(queryToken)) return 1;
  if (brandAliases(queryToken).includes(nameToken)) return 1;
  if (queryToken.length < 4) return 0;
  const similarity = trigramSimilarity(
    trigrams(queryToken),
    trigrams(nameToken),
  );
  return similarity >= FUZZY_MIN_SIMILARITY ? similarity : 0;
}

/**
 * Share of the query's identifying tokens found in `candidate` (0–1). Generic
 * words only count when the query has nothing else ("Autohaus" alone).
 */
export function textMatchScore(
  queryTokens: readonly string[],
  candidate: string,
): number {
  const specific = queryTokens.filter((t) => !GENERIC_NAME_TOKENS.has(t));
  const wanted = specific.length > 0 ? specific : queryTokens;
  if (wanted.length === 0) return 0;
  const tokens = foldedTokens(candidate);
  let total = 0;
  for (const queryToken of wanted) {
    let best = 0;
    for (const token of tokens) {
      best = Math.max(best, tokenMatch(queryToken, token));
      if (best === 1) break;
    }
    total += best;
  }
  return total / wanted.length;
}

function identityTokens(name: string): Set<string> {
  const all = foldedTokens(name).filter((token) => token.length >= 3);
  const specific = all.filter((token) => !GENERIC_NAME_TOKENS.has(token));
  return new Set(specific.length > 0 ? specific : all);
}

/** "Opel - Autohaus Dresden GmbH" ≈ "Autohaus Dresden"; "Auto Müller" ≉ "Auto Schmidt". */
export function similarBusinessNames(a: string, b: string): boolean {
  const left = identityTokens(a);
  const right = identityTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared > 0 && shared >= Math.min(left.size, right.size) / 2;
}

export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371;
}
