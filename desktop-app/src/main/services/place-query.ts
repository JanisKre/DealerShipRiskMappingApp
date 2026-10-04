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
