/** Lower case without accents, "ß" as "ss": "Günzburg" matches "gunzburg". */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss");
}

/**
 * Search of the location table: every word of the query must occur in the
 * name or the address (street, postcode, town). Figures are left out on
 * purpose: "6" used to match the unformatted 2896 vehicles and 72400000 €.
 */
export function matchesLocationSearch(
  d: { name: string; address?: string },
  query: string,
): boolean {
  const words = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearchText(`${d.name} ${d.address ?? ""}`);
  return words.every((word) => haystack.includes(word));
}
