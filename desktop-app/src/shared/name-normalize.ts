/**
 * Name and address folding shared by the place search (main), the import
 * dedupe (renderer) and the portfolio index. One implementation, so
 * "Autohaus Müller GmbH" and "Autohaus Mueller" are the same business
 * everywhere.
 */

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

/**
 * Comparison key of a business name: folded, legal forms removed,
 * punctuation dropped, spaces collapsed.
 */
export function businessNameKey(name: string): string {
  return foldText(normalisePlaceQuery(name))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Comparison key of an address: folded, "Straße/Strasse/Str." as "str",
 * punctuation dropped, spaces collapsed.
 */
export function addressKey(address: string): string {
  return foldText(address)
    .replace(/(strasse|str\.?)(?=\s|\d|,|$)/gu, "str")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
