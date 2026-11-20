/**
 * Parts of a free-text German address that several matchers need. One
 * implementation, so geocoding, site membership and the import agree.
 */

/** Five-digit postcode, the last one before a place name if several. */
export function postcodeOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const beforePlace = [
    ...address.matchAll(/(?:^|[\s,]|D-)(\d{5})\s+\p{L}/gu),
  ].at(-1);
  return beforePlace?.[1] ?? address.match(/\b\d{5}\b/)?.[0];
}

/**
 * House number of the street part ("Hauptstr. 12a" → "12a"). Postcodes and
 * ordinals inside a street name ("Straße des 17. Juni 135" → "135") are not
 * house numbers; of several candidates the last one in the street part wins.
 */
export function houseNumberOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const withoutPostcodes = address.replace(/\b\d{5}\b/g, " ");
  const parts = withoutPostcodes.split(",");
  // The street is the part that holds a number; usually the first.
  const street =
    parts.find((part) => /\d/.test(part) && /\p{L}{3,}/u.test(part)) ??
    withoutPostcodes;
  const candidates = [
    ...street.matchAll(/\b(\d{1,4})\s*([a-z])?\b(?!\s*\.)/gi),
  ];
  const last = candidates.at(-1);
  if (!last) return undefined;
  return `${last[1]}${last[2] ?? ""}`.toLowerCase();
}

/** A post-office box, which names no site to geocode or analyse. */
export function isPoBox(address: string | undefined): boolean {
  return /\b(?:postfach\b|pf\.?\s*\d|p\.?\s?o\.?\s?box\b|bo[iî]te postale\b|bp\s+\d)/i.test(
    address ?? "",
  );
}

const STREET_WORD =
  /(stra(ss|ß)e|str\.?|weg|allee|platz|ring|damm|gasse|ufer|chaussee|markt|steig|pfad|hof)$/iu;
const TOWN_PREFIX = /^(bad|sankt|st\.?|neu|alt|gro(ss|ß)|klein|hohen)$/iu;

/**
 * "01237 Dresden" from an address line: the postcode and the town, never a
 * street. Used wherever a location is described to an AI provider or an
 * agent, which must not receive street addresses.
 *
 * The last five-digit group followed by a word is the postcode ("Weg 12345
 * Nord, 01067 Dresden"). The town ends at a comma, a semicolon, a dash or a
 * line break. When a number still follows ("01067 Dresden Geheimweg 5") a
 * street was written after the town without a separator: the town then
 * ends before the street word, or after its first word.
 */
export function postcodeAndTown(
  address: string | undefined,
): string | undefined {
  if (!address) return undefined;
  const match = [
    ...address.matchAll(/(?<!\d)(\d{5})\s+(\p{L}[^,;\n\r]*)/gu),
  ].at(-1);
  if (!match) return undefined;
  let town = match[2].split(/\s[-–—]\s/u)[0].trim();
  const digitAt = town.search(/\d/u);
  if (digitAt >= 0) {
    const words = town.slice(0, digitAt).trim().split(/\s+/u).filter(Boolean);
    const streetAt = words.findIndex((word) => STREET_WORD.test(word));
    town = (
      streetAt >= 0
        ? words.slice(0, streetAt)
        : words.slice(0, TOWN_PREFIX.test(words[0] ?? "") ? 2 : 1)
    ).join(" ");
  }
  return town ? `${match[1]} ${town}` : match[1];
}
