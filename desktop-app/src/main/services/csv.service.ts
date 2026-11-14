import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { normalizeWebsiteUrl } from "@shared/website";
import {
  columnHint,
  type ColumnOverrides,
  type ImportColumn,
  type ImportField,
} from "@shared/import-fields";
import { normalizeXlsx } from "./xlsx-normalize";
import type {
  DealershipInput,
  ImportResult,
  ImportReport,
} from "@shared/types";

/**
 * Import parser (no heavy external dependency for CSV/TSV; XLSX via the
 * `exceljs` dependency already present).
 * Expected columns (case-insensitive, flexible): name, address, lat, lon, value,
 * insured / business type, salespartner, subportfolio, group, limit
 * (maximum indemnity), deductible.
 * CSV/TSV: splits on comma, semicolon, or tab (auto-detected); simple quotes.
 */
export function parseCsv(content: string): DealershipInput[] {
  return parseCsvWithReport(content).rows;
}

/** CSV/TSV import with row-level diagnostics and a reproducible mapping report. */
export function parseCsvWithReport(
  content: string,
  overrides?: ColumnOverrides,
): ImportResult {
  // Blank lines stay (rowsFromMatrix skips them) so row numbers match the file.
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.every((l) => l.trim().length === 0)) return emptyResult("csv");

  const delimiter = chooseDelimiter(lines);
  const matrix = splitRecords(lines.join("\n"), delimiter);
  return rowsFromMatrix(matrix, delimiter === "\t" ? "tsv" : "csv", overrides);
}

/** XLSX import: first worksheet, same column heuristic as CSV. */
export async function parseXlsx(base64: string): Promise<DealershipInput[]> {
  return (await parseXlsxWithReport(base64)).rows;
}

/** XLSX import with the same diagnostics as CSV/TSV. */
export async function parseXlsxWithReport(
  base64: string,
  overrides?: ColumnOverrides,
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings expect an older Buffer type → cast at the boundary.
  // Files with namespace-prefixed XML (Open XML SDK) are rewritten first.
  await wb.xlsx.load(
    normalizeXlsx(Buffer.from(base64, "base64")) as unknown as ArrayBuffer,
  );
  // The sheet with the clearest header wins (a "Notes" sheet may come
  // first); rows keep their sheet row numbers, blank ones included.
  let best: { matrix: string[][]; score: number } | null = null;
  for (const ws of wb.worksheets) {
    const matrix: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      // values[0] is reserved; the real columns start at index 1.
      const values = row.values as unknown[];
      for (let i = 1; i < values.length; i++) {
        cells.push(cellToString(values[i]));
      }
      matrix[rowNumber - 1] = cells;
    });
    for (let i = 0; i < matrix.length; i++) matrix[i] ??= [];
    const score = headerScore(matrix);
    if (!best || score > best.score) best = { matrix, score };
  }
  if (!best) return emptyResult("xlsx");
  const matrix = best.matrix;
  return rowsFromMatrix(matrix, "xlsx", overrides);
}

/**
 * The delimiter that makes some top line read as column names (a title line
 * above the header has none); without any known header, the most frequent
 * delimiter of the first non-empty line.
 */
function chooseDelimiter(lines: string[]): string {
  const top = lines.filter((l) => l.trim()).slice(0, HEADER_SEARCH_ROWS);
  let best: { delimiter: string; fields: number } | null = null;
  for (const delimiter of ["\t", ";", ","]) {
    const fields = Math.max(
      0,
      ...top.map((line) => knownFields(splitLine(line, delimiter))),
    );
    if (fields > 0 && (!best || fields > best.fields))
      best = { delimiter, fields };
  }
  return best?.delimiter ?? detectDelimiter(top[0] ?? "");
}

/** Selects the most frequent delimiter in the header row from tab/semicolon/comma. */
function detectDelimiter(header: string): string {
  const counts: Array<[string, number]> = [
    ["\t", occurrences(header, "\t")],
    [";", occurrences(header, ";")],
    [",", occurrences(header, ",")],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

function occurrences(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Recognised column headers per field, compared after `normaliseHeader`
 * (lower-case ASCII, umlauts transliterated, no spaces). German variants
 * such as "haendler" or "laenge" are data values, not text to translate.
 */
const HEADER_ALIASES = {
  name: [
    "name",
    "dealership",
    "dealershipname",
    "dealername",
    "haendler",
    "haendlername",
    "autohaus",
    "firma",
    "firmenname",
    "company",
    "companyname",
    "site",
    "sitename",
    "standort",
    "standortname",
    "bezeichnung",
  ],
  addr: ["address", "adresse", "anschrift", "location"],
  street: ["street", "strasse", "streetname"],
  houseNumber: ["housenumber", "hausnummer", "hausnr", "streetnumber"],
  postalCode: ["postalcode", "postcode", "zip", "zipcode", "plz"],
  city: ["city", "ort", "stadt", "town", "gemeinde"],
  lat: ["lat", "latitude", "breite", "breitengrad"],
  lon: ["lon", "lng", "longitude", "laenge", "laengengrad"],
  val: ["value", "assetvalue", "wert", "suminsured"],
  insured: [
    "insured",
    "versichert",
    "policy",
    "status",
    "businesstype",
    "business",
    "geschaeftsart",
    "geschaeftstyp",
    "bestand",
    "bestandneu",
    "bestandoderneu",
    "bestandneugeschaeft",
    "kundenstatus",
    "vertragsstatus",
  ],
  partner: ["salespartner", "partner", "vertriebspartner", "agent"],
  subPortfolio: ["subportfolio", "portfolio", "teilportfolio", "segment"],
  group: ["group", "gruppe", "konzern"],
  limit: [
    "limit",
    "productlimit",
    "productlimiteur",
    "limiteur",
    "cap",
    "versicherungssumme",
    "maxindemnity",
    "maximumindemnity",
    "indemnitylimit",
    "maxindemnitylimit",
    "maximumindemnitylimit",
    "hoechstentschaedigung",
    "hoechstentschaedigungeur",
    "hoechstentschaedigungsgrenze",
    "entschaedigungsgrenze",
    "haftungshoechstgrenze",
    "hoechsthaftung",
    "hoechstgrenze",
    "jahreshoechstentschaedigung",
  ],
  deductible: [
    "deductible",
    "deductibleeur",
    "excess",
    "selbstbehalt",
    "selbstbehalteur",
    "selbstbeteiligung",
    "selbstbeteiligungeur",
    "sb",
    "sbeur",
  ],
  website: ["website", "webseite", "homepage", "internetseite", "web", "url"],
} satisfies Record<string, string[]>;

/** Alias list behind each import field. */
const FIELD_ALIASES: Record<ImportField, keyof typeof HEADER_ALIASES> = {
  name: "name",
  address: "addr",
  street: "street",
  houseNumber: "houseNumber",
  postalCode: "postalCode",
  city: "city",
  lat: "lat",
  lon: "lon",
  assetValue: "val",
  insured: "insured",
  salesPartner: "partner",
  subPortfolio: "subPortfolio",
  group: "group",
  productLimitEur: "limit",
  deductibleEur: "deductible",
  website: "website",
};

/** Every recognised header, for finding the header row. */
const KNOWN_HEADERS = new Map(
  Object.entries(HEADER_ALIASES).flatMap(([field, names]) =>
    names.map((name) => [name, field] as const),
  ),
);

/** Rows searched for the header (title and note lines may come first). */
const HEADER_SEARCH_ROWS = 20;

/**
 * Index of the header row: the first row among the top rows that names the
 * most known fields. Exports often start with a title, a note or an empty
 * line; a row of repeated merged-cell text names no field. Falls back to
 * the first row when no row names a field.
 */
export function findHeaderRow(matrix: string[][]): number {
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(matrix.length, HEADER_SEARCH_ROWS); i++) {
    const score = knownFields(matrix[i]);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/** Number of distinct fields a row names as column headers. */
function knownFields(row: string[]): number {
  return new Set(
    row
      .map((cell) => KNOWN_HEADERS.get(normaliseHeader(cell ?? "")))
      .filter((field): field is string => field != null),
  ).size;
}

/** How clearly a sheet carries an import table (its best header row). */
function headerScore(matrix: string[][]): number {
  const row = matrix[findHeaderRow(matrix)];
  return row ? knownFields(row) : 0;
}

/** Shared row/column mapping for CSV, TSV, and XLSX. */
function rowsFromMatrix(
  matrix: string[][],
  format: ImportReport["format"],
  overrides: ColumnOverrides = {},
): ImportResult {
  if (matrix.length === 0) return emptyResult(format);
  // Title or note lines above the column names are skipped.
  const headerRow = findHeaderRow(matrix);
  const rawHeader = matrix[headerRow].map((h) => h.trim());
  const header = rawHeader.map(normaliseHeader);
  // Columns assigned by hand feed only their field; the recognised headers
  // fill the remaining fields.
  const overridden = new Map<ImportField, number>();
  for (const [field, column] of Object.entries(overrides) as Array<
    [ImportField, string]
  >) {
    const index = rawHeader.indexOf(column.trim());
    if (index >= 0) overridden.set(field, index);
  }
  const claimed = new Set(overridden.values());
  const idx = (field: ImportField): number => {
    const manual = overridden.get(field);
    if (manual != null) return manual;
    const names: string[] = HEADER_ALIASES[FIELD_ALIASES[field]];
    return header.findIndex((h, i) => !claimed.has(i) && names.includes(h));
  };

  const nameIdx = idx("name");
  const addrIdx = idx("address");
  // Split address columns, combined when there is no single address column.
  const streetIdx = idx("street");
  const houseNumberIdx = idx("houseNumber");
  const postalCodeIdx = idx("postalCode");
  const cityIdx = idx("city");
  const latIdx = idx("lat");
  const lonIdx = idx("lon");
  // Without a name column, use the first column that is not a row id —
  // otherwise every location would be called "1", "2", "3", ….
  const fallbackNameIdx = header.findIndex(
    (h, i) =>
      !ID_HEADERS.has(h) &&
      ![
        latIdx,
        lonIdx,
        addrIdx,
        streetIdx,
        houseNumberIdx,
        postalCodeIdx,
        cityIdx,
      ].includes(i),
  );
  const nameCol = nameIdx >= 0 ? nameIdx : fallbackNameIdx;
  const composeAddress = (cols: string[]): string | undefined => {
    if (addrIdx >= 0) return cols[addrIdx]?.trim() || undefined;
    const cell = (i: number): string => (i >= 0 ? (cols[i]?.trim() ?? "") : "");
    const street = [cell(streetIdx), cell(houseNumberIdx)]
      .filter(Boolean)
      .join(" ");
    const place = [cell(postalCodeIdx), cell(cityIdx)]
      .filter(Boolean)
      .join(" ");
    return [street, place].filter(Boolean).join(", ") || undefined;
  };
  const addressColumns =
    addrIdx >= 0
      ? [addrIdx]
      : [streetIdx, houseNumberIdx, postalCodeIdx, cityIdx].filter(
          (i) => i >= 0,
        );
  const valIdx = idx("assetValue");
  // Existing vs. new business ("Bestand"/"Neugeschäft", yes/no, …).
  const insuredIdx = idx("insured");
  const partnerIdx = idx("salesPartner");
  const subPortfolioIdx = idx("subPortfolio");
  const groupIdx = idx("group");
  // Maximum indemnity per location (stored as `productLimitEur`).
  const limitIdx = idx("productLimitEur");
  const deductibleIdx = idx("deductibleEur");
  const websiteIdx = idx("website");
  const fieldByColumn = new Map<number, ImportField>();
  for (const [field, index] of [
    ["name", nameIdx],
    ["address", addrIdx],
    ["street", streetIdx],
    ["houseNumber", houseNumberIdx],
    ["postalCode", postalCodeIdx],
    ["city", cityIdx],
    ["lat", latIdx],
    ["lon", lonIdx],
    ["assetValue", valIdx],
    ["insured", insuredIdx],
    ["salesPartner", partnerIdx],
    ["subPortfolio", subPortfolioIdx],
    ["group", groupIdx],
    ["productLimitEur", limitIdx],
    ["deductibleEur", deductibleIdx],
    ["website", websiteIdx],
  ] as Array<[ImportField, number]>) {
    if (index >= 0 && !fieldByColumn.has(index))
      fieldByColumn.set(index, field);
  }
  // A split address is used only without an address column.
  if (addrIdx >= 0)
    for (const i of [streetIdx, houseNumberIdx, postalCodeIdx, cityIdx])
      if (fieldByColumn.get(i) !== "address") fieldByColumn.delete(i);
  const columns: ImportColumn[] = rawHeader.map((name, i) => ({
    name: name.slice(0, 200),
    hint: columnHint(
      matrix.slice(headerRow + 1, headerRow + 201).map((row) => row[i] ?? ""),
    ),
    field: fieldByColumn.get(i) ?? (i === nameCol ? "name" : null),
  }));
  const rows: DealershipInput[] = [];
  /** Source row (1-based, header = 1) of each entry in `rows`. */
  const rowNumbers: number[] = [];
  const issues: ImportReport["issues"] = [];
  const seen = new Set<string>();
  let duplicateRows = 0;
  let dataRows = 0;
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const cols = matrix[i];
    // Blank lines (spacers, trailing rows) are neither data nor errors.
    if (cols.every((cell) => !cell?.trim())) continue;
    dataRows++;
    const name = (nameCol >= 0 ? cols[nameCol] : cols[0])?.trim();
    const address = composeAddress(cols);
    const rowNumber = i + 1;
    if (!name) {
      issues.push({
        row: rowNumber,
        field: "name",
        severity: "error",
        message: "Missing dealership name",
      });
      continue;
    }

    const latCell = readNumber(cols[latIdx], "lat", rowNumber, issues);
    const lonCell = readNumber(cols[lonIdx], "lon", rowNumber, issues);
    const valueCell = readAmount(cols[valIdx], "assetValue", rowNumber, issues);
    const limitCell = readAmount(
      cols[limitIdx],
      "productLimitEur",
      rowNumber,
      issues,
    );
    const deductibleCell = readAmount(
      cols[deductibleIdx],
      "deductibleEur",
      rowNumber,
      issues,
    );
    const lat = latCell.value;
    const lon = lonCell.value;
    const assetValue = valueCell.value;
    const productLimitEur = limitCell.value;
    const deductibleEur = deductibleCell.value;

    if (lat != null && (lat < -90 || lat > 90)) {
      issues.push({
        row: rowNumber,
        field: "lat",
        severity: "error",
        message: "Latitude must be between -90 and 90",
      });
    }
    if (lon != null && (lon < -180 || lon > 180)) {
      issues.push({
        row: rowNumber,
        field: "lon",
        severity: "error",
        message: "Longitude must be between -180 and 180",
      });
    }
    const validLat = lat != null && lat >= -90 && lat <= 90 ? lat : undefined;
    const validLon = lon != null && lon >= -180 && lon <= 180 ? lon : undefined;

    const key = `${normalise(name)}|${normalise(address ?? "")}`;
    if (seen.has(key)) {
      duplicateRows++;
      issues.push({
        row: rowNumber,
        severity: "warning",
        message: "Duplicate dealership row skipped",
      });
      continue;
    }
    seen.add(key);

    rowNumbers.push(rowNumber);
    rows.push({
      id: randomUUID(),
      name,
      address,
      lat: validLat,
      lon: validLon,
      assetValue: assetValue != null ? assetValue : undefined,
      insured:
        insuredIdx >= 0
          ? parseBusinessType(cols[insuredIdx], rowNumber, issues)
          : undefined,
      salesPartner:
        partnerIdx >= 0 ? cols[partnerIdx]?.trim() || undefined : undefined,
      subPortfolio:
        subPortfolioIdx >= 0
          ? cols[subPortfolioIdx]?.trim() || undefined
          : undefined,
      group: groupIdx >= 0 ? cols[groupIdx]?.trim() || undefined : undefined,
      productLimitEur: productLimitEur != null ? productLimitEur : undefined,
      deductibleEur: deductibleEur != null ? deductibleEur : undefined,
      ...websiteFields(websiteIdx >= 0 ? cols[websiteIdx] : undefined),
    });
  }

  const missingCoordinates = rows.filter(
    (r) => r.lat == null || r.lon == null,
  ).length;
  const warnings =
    missingCoordinates > 0
      ? [
          `${missingCoordinates} row(s) require address geocoding because coordinates are incomplete.`,
        ]
      : [];
  return {
    rows,
    rowNumbers,
    report: {
      format,
      totalRows: dataRows,
      importedRows: rows.length,
      skippedRows: Math.max(0, dataRows - rows.length),
      duplicateRows,
      columnMapping: {
        name: rawHeader[nameCol] ?? null,
        address:
          addressColumns.length > 0
            ? addressColumns.map((i) => rawHeader[i]).join(" + ")
            : null,
        lat: rawHeader[latIdx] ?? null,
        lon: rawHeader[lonIdx] ?? null,
        assetValue: rawHeader[valIdx] ?? null,
        insured: rawHeader[insuredIdx] ?? null,
        salesPartner: rawHeader[partnerIdx] ?? null,
        subPortfolio: rawHeader[subPortfolioIdx] ?? null,
        group: rawHeader[groupIdx] ?? null,
        productLimitEur: rawHeader[limitIdx] ?? null,
        deductibleEur: rawHeader[deductibleIdx] ?? null,
        website: rawHeader[websiteIdx] ?? null,
      },
      columns,
      issues,
      warnings,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * A website from the file is user-provided: labelled "from the import file"
 * and, like a typed link, never replaced by an automatic lookup.
 */
function websiteFields(
  raw: string | undefined,
): { website: string; websiteSource: "import" } | Record<string, never> {
  const website = normalizeWebsiteUrl(raw?.trim());
  return website ? { website, websiteSource: "import" } : {};
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    // exceljs rich text / hyperlink / formula result
    const o = v as { text?: string; result?: unknown; hyperlink?: string };
    if (typeof o.text === "string") return o.text;
    if (o.result != null) return String(o.result);
    if (typeof o.hyperlink === "string") return o.hyperlink;
    return "";
  }
  return String(v);
}

function splitLine(line: string, delimiter: string): string[] {
  return tokenize(line, delimiter)?.[0] ?? [line];
}

/**
 * Records of a CSV text, each at the index of the line it starts on, so row
 * numbers in the report still match the file. A quoted cell may span lines
 * (an address exported from Excel); the lines it continues on stay empty
 * and are skipped like blank lines. An unbalanced quote would swallow the
 * rest of the file into one cell, so then each line is read on its own.
 */
function splitRecords(text: string, delimiter: string): string[][] {
  const records = tokenize(text, delimiter);
  if (records) return records;
  return text.split("\n").map((line) => splitLine(line, delimiter));
}

/**
 * RFC 4180 reading: a cell that starts with `"` is quoted, `""` inside it
 * is one quote, delimiters and line breaks inside it are text. Line breaks
 * inside a cell become ", ", so a multi-line address reads as one line.
 * Returns null when a quote is never closed.
 */
function tokenize(text: string, delimiter: string): string[][] | null {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 0;
  let startLine = 0;
  const endCell = (): void => {
    row.push(cell.replace(/[ \t]*\n[ \t]*/g, ", "));
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (ch === "\n") {
        line++;
        cell += ch;
      } else if (ch !== "\r") {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\n") {
      endCell();
      records[startLine] = row;
      row = [];
      line++;
      startLine = line;
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (inQuotes) return null;
  endCell();
  records[startLine] = row;
  for (let i = 0; i < records.length; i++) records[i] ??= [];
  return records;
}

function readNumber(
  s: string | undefined,
  field: string,
  row: number,
  issues: ImportReport["issues"],
): { value: number | undefined } {
  if (!s?.trim()) return { value: undefined };
  const n = Number(s.trim().replace(",", "."));
  if (Number.isNaN(n)) {
    issues.push({
      row,
      field,
      severity: "warning",
      message: `Invalid number '${s.trim()}' ignored`,
    });
    return { value: undefined };
  }
  return { value: n };
}

/**
 * Money cell: also accepts currency signs and thousands separators
 * ("25.000 €", "1.250.000,00", "1,250,000.00"). A lone separator followed
 * by groups of exactly three digits is a thousands separator — amounts
 * carry two decimals at most — so "250.000" is 250 000, not 250, while
 * "1250,50" stays 1 250.50. Negative amounts are rejected.
 */
function readAmount(
  s: string | undefined,
  field: string,
  row: number,
  issues: ImportReport["issues"],
): { value: number | undefined } {
  const raw = s?.trim();
  if (!raw) return { value: undefined };
  const n = parseAmount(raw);
  if (n == null || n < 0) {
    issues.push({
      row,
      field,
      severity: "warning",
      message: `Invalid amount '${raw}' ignored`,
    });
    return { value: undefined };
  }
  return { value: n };
}

function parseAmount(raw: string): number | undefined {
  let v = raw.replace(/(eur|€)/gi, "").replace(/[\s\u00a0'’]/g, "");
  if (!v) return undefined;
  const lastDot = v.lastIndexOf(".");
  const lastComma = v.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later one is the decimal separator.
    v =
      lastComma > lastDot
        ? v.replace(/\./g, "").replace(",", ".")
        : v.replace(/,/g, "");
  } else if (lastComma >= 0) {
    v = /^-?\d{1,3}(,\d{3})+$/.test(v)
      ? v.replace(/,/g, "")
      : v.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) {
    v = v.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(v)) return undefined;
  return Number(v);
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Row-number columns that must never become the location name. */
const ID_HEADERS = new Set([
  "id",
  "nr",
  "no",
  "lfdnr",
  "nummer",
  "index",
  "rowid",
]);

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function emptyResult(format: ImportReport["format"]): ImportResult {
  return {
    rows: [],
    report: {
      format,
      totalRows: 0,
      importedRows: 0,
      skippedRows: 0,
      duplicateRows: 0,
      columnMapping: {},
      issues: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    },
  };
}

const EXISTING_BUSINESS_VALUES = new Set([
  "yes",
  "ja",
  "true",
  "wahr",
  "1",
  "x",
  "insured",
  "versichert",
  "policy",
  "existing",
  "existingbusiness",
  "inforce",
  "renewal",
  "bestand",
  "bestandsgeschaeft",
  "bestandskunde",
  "bestandsvertrag",
  "aktiv",
  "active",
]);
const NEW_BUSINESS_VALUES = new Set([
  "no",
  "nein",
  "false",
  "falsch",
  "0",
  "new",
  "newbusiness",
  "prospect",
  "quote",
  "offer",
  "neu",
  "neugeschaeft",
  "neukunde",
  "neuvertrag",
  "interessent",
  "angebot",
  "anfrage",
  "nichtversichert",
]);

/**
 * Existing (`true`) vs. new business (`false`) from an insured/business-type
 * cell. Empty → undefined (unknown); an unrecognised value is reported and
 * left unknown rather than silently counted as new business.
 */
function parseBusinessType(
  s: string | undefined,
  row: number,
  issues: ImportReport["issues"],
): boolean | undefined {
  const raw = s?.trim();
  if (!raw) return undefined;
  const v = normaliseHeader(raw);
  if (EXISTING_BUSINESS_VALUES.has(v)) return true;
  if (NEW_BUSINESS_VALUES.has(v)) return false;
  issues.push({
    row,
    field: "insured",
    severity: "warning",
    message: `Unrecognised business type '${raw}' left unclassified`,
  });
  return undefined;
}
