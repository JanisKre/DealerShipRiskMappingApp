/**
 * Street-and-house-number keys of an address, for comparing the address a
 * cadastre service publishes for a parcel (`lagebeztxt`: "Schmiedstraße 12",
 * "Kölner Straße 260, 262, 264", "An der Insel 2; Landstraße 36 a") with
 * the address of a dealership ("Schwarzwaldstraße 92-100, 68163 Mannheim").
 *
 * A key is `street|number` with the street reduced to letters and digits
 * ("kölnerstr|260"). Text without a house number yields no key: the name of
 * a street alone is also what road parcels carry.
 */

/** Longest house-number range that is expanded ("92-100"). */
const MAX_RANGE = 40;

function normaliseStreet(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/\([^)]*\)/g, " ")
    .replace(/strasse/g, "str")
    .replace(/str\./g, "str")
    .replace(/[^a-z0-9äöü]/g, "");
}

/** "10 a" → ["10a"]; "92-100" → ["92", "93", …, "100"]. */
function houseNumbers(token: string): string[] {
  const compact = token.toLowerCase().replace(/\s+/g, "");
  const single = compact.match(/^(\d{1,4})([a-z]?)$/);
  if (single) return [compact];
  const range = compact.match(/^(\d{1,4})([a-z]?)[-–](\d{1,4})([a-z]?)$/);
  if (!range) return [];
  const from = Number(range[1]);
  const to = Number(range[3]);
  if (to < from || to - from > MAX_RANGE) return [];
  const numbers = new Set<string>([`${from}${range[2]}`, `${to}${range[4]}`]);
  for (let n = from; n <= to; n += 1) numbers.add(String(n));
  return [...numbers];
}

/**
 * The street-and-number keys in an address text; empty without a number.
 *
 * A dealership's address often starts with its name ("M&S Muster-Technik,
 * Musterstr. 263, 01234 Musterstadt"), so the text is read part by part
 * between commas: a part without a number is a name or a town and is
 * skipped, a part that starts with a number continues the street before it,
 * and a postcode ends the street.
 */
export function addressKeys(address: string | undefined): string[] {
  if (!address) return [];
  const keys = new Set<string>();
  let street = "";
  for (const part of address.split(";")) {
    // "Wandsbeker Chaussee 195;197": a part that starts with a number
    // continues the street before it.
    for (const segment of part.split(",")) {
      const match = segment.trim().match(/^(\D*?)\s*(\d.*)$/);
      if (!match) continue;
      const named = normaliseStreet(match[1]);
      if (named.length >= 3) street = named;
      if (street.length < 3) continue;
      let ended = false;
      for (const token of match[2].split("/")) {
        const numbers = houseNumbers(token.trim());
        // A postcode and town ("12345 Musterstadt") end the house numbers.
        if (numbers.length === 0) {
          ended = named.length < 3;
          break;
        }
        for (const number of numbers) keys.add(`${street}|${number}`);
      }
      if (ended) break;
    }
  }
  return [...keys];
}

/** True when the two addresses share a street and house number. */
export function sharesAddress(
  keys: ReadonlySet<string>,
  address: string | undefined,
): boolean {
  if (keys.size === 0 || !address) return false;
  return addressKeys(address).some((key) => keys.has(key));
}

/**
 * The keys of an address with letter suffixes dropped ("53 c" → "53"):
 * plots split off one property keep its number and get a letter, so "53",
 * "53 b" and "53 c" are one site far more often than neighbours.
 */
export function addressBaseKeys(address: string | undefined): string[] {
  return [
    ...new Set(addressKeys(address).map((key) => key.replace(/[a-z]+$/, ""))),
  ];
}

/**
 * The street names in a cadastral address text, with or without a house
 * number ("Hansestraße 47; Am Hof" → ["hansestr", "amhof"]). Only for the
 * address of a parcel: in a dealership's address a part without a number
 * is its name or its town.
 */
export function parcelStreets(address: string | undefined): string[] {
  if (!address) return [];
  const streets = new Set<string>();
  for (const segment of address.split(/[;,]/)) {
    const match = segment.trim().match(/^(\D+?)\s*(\d.*)?$/);
    if (!match) continue;
    const street = normaliseStreet(match[1]);
    if (street.length >= 3) streets.add(street);
  }
  return [...streets];
}
