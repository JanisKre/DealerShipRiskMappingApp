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
