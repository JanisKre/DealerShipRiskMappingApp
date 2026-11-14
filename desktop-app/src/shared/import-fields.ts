import { z } from "zod";

/**
 * Fields a portfolio column can be mapped to. The parser recognises common
 * headers on its own; a column it does not recognise can be assigned by hand
 * in the import dialog (or by an optional AI suggestion the user confirms),
 * and the file is parsed again with that assignment.
 */
export const IMPORT_FIELDS = [
  "name",
  "address",
  "street",
  "houseNumber",
  "postalCode",
  "city",
  "lat",
  "lon",
  "assetValue",
  "insured",
  "salesPartner",
  "subPortfolio",
  "group",
  "productLimitEur",
  "deductibleEur",
  "website",
] as const;
export const ImportFieldSchema = z.enum(IMPORT_FIELDS);
export type ImportField = z.infer<typeof ImportFieldSchema>;

/**
 * What a column's values look like, computed locally from the file. The
 * optional AI suggestion sees only header names and these hints, never a
 * cell value.
 */
export const COLUMN_HINTS = [
  "empty",
  "text",
  "number",
  "amount",
  "latitude",
  "longitude",
  "postcode",
  "url",
  "yesNo",
] as const;
export const ColumnHintSchema = z.enum(COLUMN_HINTS);
export type ColumnHint = z.infer<typeof ColumnHintSchema>;

export const ImportColumnSchema = z.object({
  name: z.string().max(200),
  hint: ColumnHintSchema,
  /** Field the column feeds, null when the parser does not use it. */
  field: ImportFieldSchema.nullable(),
});
export type ImportColumn = z.infer<typeof ImportColumnSchema>;

/** Field → column header (exact header text) to use instead of the detection. */
export const ColumnOverridesSchema = z
  .partialRecord(ImportFieldSchema, z.string().min(1).max(200))
  .refine(
    (o) => new Set(Object.values(o)).size === Object.values(o).length,
    "A column can feed only one field",
  );
export type ColumnOverrides = z.infer<typeof ColumnOverridesSchema>;

const YES_NO = new Set([
  "ja",
  "nein",
  "yes",
  "no",
  "oui",
  "non",
  "true",
  "false",
  "x",
  "1",
  "0",
  "bestand",
  "neu",
  "neugeschäft",
  "neugeschaeft",
]);

/** Share of non-empty cells that must match a hint. */
const HINT_SHARE = 0.8;

/**
 * Type hint of a column from up to the first 200 non-empty values. Pure and
 * deterministic; numbers accept German and English separators.
 */
export function columnHint(values: string[]): ColumnHint {
  const cells = values
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (cells.length === 0) return "empty";
  const share = (test: (v: string) => boolean): number =>
    cells.filter(test).length / cells.length;
  // "1.250.000" and "12,5" read the German way; a single dot group such as
  // "13.405" stays a decimal (a coordinate), commas otherwise group thousands.
  const asNumber = (v: string): number | null => {
    const clean = v.replace(/[€\s]|eur$/gi, "");
    const german =
      /^-?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(clean) ||
      /^-?[\d.]*\d,\d+$/.test(clean);
    const normalised = german
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, "");
    const n = Number(normalised);
    return normalised !== "" && Number.isFinite(n) ? n : null;
  };
  if (share((v) => /^https?:\/\/|^www\./i.test(v)) >= HINT_SHARE) return "url";
  if (share((v) => /^\d{5}$/.test(v)) >= HINT_SHARE) return "postcode";
  if (share((v) => YES_NO.has(v.toLowerCase())) >= HINT_SHARE) return "yesNo";
  const numbers = cells.map(asNumber);
  if (numbers.filter((n) => n != null).length / cells.length >= HINT_SHARE) {
    const decimals = cells.filter((v) => /[.,]\d{3,}$/.test(v)).length;
    const valid = numbers.filter((n): n is number => n != null);
    if (decimals / cells.length >= HINT_SHARE) {
      if (valid.every((n) => n >= 47 && n <= 56)) return "latitude";
      if (valid.every((n) => n >= 5 && n <= 16)) return "longitude";
    }
    if (cells.some((v) => /€|eur/i.test(v)) || valid.some((n) => n >= 10_000))
      return "amount";
    return "number";
  }
  return "text";
}

/** Most columns sent for a mapping suggestion. */
export const MAPPING_MAX_COLUMNS = 200;

export const ColumnMappingAnswerSchema = z.object({
  mapping: z
    .array(z.object({ column: z.string(), field: z.string() }))
    .max(MAPPING_MAX_COLUMNS),
});

/**
 * Keeps the suggestions that can be applied: a column the parser leaves
 * unused, a field no column feeds yet, each column and field once. Address
 * parts are dropped when an address column is already mapped.
 */
export function cleanMappingSuggestion(
  columns: ImportColumn[],
  suggestion: Array<{ column: string; field: string }>,
): ColumnOverrides {
  const unused = new Set(
    columns.filter((c) => c.field == null).map((c) => c.name),
  );
  const filled = new Set(columns.flatMap((c) => (c.field ? [c.field] : [])));
  const addressParts: ImportField[] = [
    "street",
    "houseNumber",
    "postalCode",
    "city",
  ];
  const result: ColumnOverrides = {};
  const used = new Set<string>();
  for (const { column, field } of suggestion) {
    const parsed = ImportFieldSchema.safeParse(field);
    if (!parsed.success || !unused.has(column) || used.has(column)) continue;
    const f = parsed.data;
    if (filled.has(f) || f in result) continue;
    if (filled.has("address") && addressParts.includes(f)) continue;
    result[f] = column;
    used.add(column);
  }
  return result;
}
