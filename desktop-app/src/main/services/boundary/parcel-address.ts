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

/** The street-and-number keys in an address text; empty without a number. */
export function addressKeys(address: string | undefined): string[] {
  if (!address) return [];
  const keys = new Set<string>();
  let street = "";
  for (const part of address.split(";")) {
    // "Wandsbeker Chaussee 195;197": a part that starts with a number
    // continues the street before it.
    const match = part.trim().match(/^(\D*?)\s*(\d.*)$/);
    if (!match) continue;
    const named = normaliseStreet(match[1]);
    if (named.length >= 3) street = named;
    if (street.length < 3) continue;
    for (const token of match[2].split(/[,/]/)) {
      const numbers = houseNumbers(token.trim());
      // A postcode and town ("51645 Gummersbach") end the house numbers.
      if (numbers.length === 0) break;
      for (const number of numbers) keys.add(`${street}|${number}`);
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
