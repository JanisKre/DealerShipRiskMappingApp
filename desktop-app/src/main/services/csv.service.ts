import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import type {
  DealershipInput,
  ImportResult,
  ImportReport,
  NatCatAssessment,
  NatCatProvider,
} from "@shared/types";

/**
 * Import parser (no heavy external dependency for CSV/TSV; XLSX via the
 * `exceljs` dependency already present).
 * Expected columns (case-insensitive, flexible): name, address, lat, lon, value,
 * insured, salespartner, subportfolio, group, limit.
 * CSV/TSV: splits on comma, semicolon, or tab (auto-detected); simple quotes.
 */
export function parseCsv(content: string): DealershipInput[] {
  return parseCsvWithReport(content).rows;
}

/** Explicit ZÜRS Geo import entry point; the normal uploader also auto-detects these columns. */
export function parseZuersCsvWithReport(content: string): ImportResult {
  return parseCsvWithReport(content, "zuers-geo");
}

/** CSV/TSV import with row-level diagnostics and a reproducible mapping report. */
export function parseCsvWithReport(
  content: string,
  provider?: NatCatProvider,
): ImportResult {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return emptyResult("csv");

  const delimiter = detectDelimiter(lines[0]);
  const matrix = lines.map((l) => splitLine(l, delimiter));
  return rowsFromMatrix(matrix, delimiter === "\t" ? "tsv" : "csv", provider);
}

/** XLSX import: first worksheet, same column heuristic as CSV. */
export async function parseXlsx(base64: string): Promise<DealershipInput[]> {
  return (await parseXlsxWithReport(base64)).rows;
}

/** XLSX import with the same diagnostics as CSV/TSV. */
export async function parseXlsxWithReport(base64: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings expect an older Buffer type → cast at the boundary.
  await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return emptyResult("xlsx");

  const matrix: string[][] = [];
  ws.eachRow((row) => {
    const cells: string[] = [];
    // values[0] is reserved; the real columns start at index 1.
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) {
      cells.push(cellToString(values[i]));
    }
    matrix.push(cells);
  });
  return rowsFromMatrix(matrix, "xlsx");
}

export async function parseZuersXlsxWithReport(base64: string): Promise<ImportResult> {
  return parseXlsxWithReport(base64);
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

/** Shared row/column mapping for CSV, TSV, and XLSX. */
function rowsFromMatrix(
  matrix: string[][],
  format: ImportReport["format"],
  provider?: NatCatProvider,
): ImportResult {
  if (matrix.length === 0) return emptyResult(format);
  const rawHeader = matrix[0].map((h) => h.trim());
  const header = rawHeader.map(normaliseHeader);
  const idx = (names: string[]): number =>
    header.findIndex((h) => names.includes(h));

  // NOTE: the alias lists below intentionally include German column-header
  // variants (e.g. "händler", "länge") as recognized input data, so that
  // German-language spreadsheets can still be imported. These are data
  // values, not descriptive text, and are left untranslated on purpose.
  const nameIdx = idx(["name", "dealership", "händler", "site"]);
  const addrIdx = idx(["address", "adresse", "location"]);
  const latIdx = idx(["lat", "latitude", "breite"]);
  const lonIdx = idx(["lon", "lng", "longitude", "länge"]);
  const valIdx = idx(["value", "assetvalue", "wert", "suminsured"]);
  const insuredIdx = idx(["insured", "versichert", "policy", "status"]);
  const partnerIdx = idx([
    "salespartner",
    "partner",
    "vertriebspartner",
    "agent",
  ]);
  const subPortfolioIdx = idx([
    "subportfolio",
    "portfolio",
    "teilportfolio",
    "segment",
  ]);
  const groupIdx = idx(["group", "gruppe", "konzern"]);
  const limitIdx = idx(["limit", "productlimit", "cap", "versicherungssumme"]);
  const zuersFloodIdx = idx([
    "zuersfloodclass",
    "zuersfloodzone",
    "zuershochwasserklasse",
    "zuersgefaehrdungsklasse",
    "floodclass",
    "hochwasserklasse",
    "hochwassergefaehrdungsklasse",
  ]);
  const zuersHeavyRainIdx = idx([
    "zuersheavyrainclass",
    "starkregenklasse",
    "starkregengefahrenklasse",
    "starkregenrisikoklasse",
    "sgk",
  ]);
  const zuersWatercourseIdx = idx([
    "watercoursezone",
    "bachzone",
    "gewaesserzone",
  ]);
  const zuersVersionIdx = idx(["zuersversion", "zuersdataversion"]);
  const detectedProvider = provider ??
    (zuersFloodIdx >= 0 || zuersHeavyRainIdx >= 0 || zuersWatercourseIdx >= 0
      ? "zuers-geo"
      : undefined);

  const rows: DealershipInput[] = [];
  const issues: ImportReport["issues"] = [];
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    const name = (nameIdx >= 0 ? cols[nameIdx] : cols[0])?.trim();
    const rowNumber = i + 1;
    if (!name) {
      issues.push({ row: rowNumber, field: "name", severity: "error", message: "Missing dealership name" });
      continue;
    }

    const latCell = readNumber(cols[latIdx], "lat", rowNumber, issues);
    const lonCell = readNumber(cols[lonIdx], "lon", rowNumber, issues);
    const valueCell = readNumber(cols[valIdx], "assetValue", rowNumber, issues);
    const limitCell = readNumber(cols[limitIdx], "productLimitEur", rowNumber, issues);
    const lat = latCell.value;
    const lon = lonCell.value;
    const assetValue = valueCell.value;
    const productLimitEur = limitCell.value;
    const natCat = detectedProvider === "zuers-geo"
      ? parseZuersAssessment(
          cols,
          {
            flood: zuersFloodIdx,
            heavyRain: zuersHeavyRainIdx,
            watercourse: zuersWatercourseIdx,
            version: zuersVersionIdx,
          },
          rowNumber,
          issues,
        )
      : undefined;

    if (lat != null && (lat < -90 || lat > 90)) {
      issues.push({ row: rowNumber, field: "lat", severity: "error", message: "Latitude must be between -90 and 90" });
    }
    if (lon != null && (lon < -180 || lon > 180)) {
      issues.push({ row: rowNumber, field: "lon", severity: "error", message: "Longitude must be between -180 and 180" });
    }
    const validLat = lat != null && lat >= -90 && lat <= 90 ? lat : undefined;
    const validLon = lon != null && lon >= -180 && lon <= 180 ? lon : undefined;

    const key = `${normalise(name)}|${normalise(cols[addrIdx] ?? "")}`;
    if (seen.has(key)) {
      duplicateRows++;
      issues.push({ row: rowNumber, severity: "warning", message: "Duplicate dealership row skipped" });
      continue;
    }
    seen.add(key);

    rows.push({
      id: randomUUID(),
      name,
      address: addrIdx >= 0 ? cols[addrIdx]?.trim() || undefined : undefined,
      lat: validLat,
      lon: validLon,
      assetValue: assetValue != null ? assetValue : undefined,
      insured: insuredIdx >= 0 ? parseBool(cols[insuredIdx]) : undefined,
      salesPartner:
        partnerIdx >= 0 ? cols[partnerIdx]?.trim() || undefined : undefined,
      subPortfolio:
        subPortfolioIdx >= 0
          ? cols[subPortfolioIdx]?.trim() || undefined
          : undefined,
      group: groupIdx >= 0 ? cols[groupIdx]?.trim() || undefined : undefined,
      productLimitEur: productLimitEur != null ? productLimitEur : undefined,
      ...(natCat ? { natCat } : {}),
    });
  }

  const missingCoordinates = rows.filter((r) => r.lat == null || r.lon == null).length;
  const warnings = missingCoordinates > 0
    ? [`${missingCoordinates} row(s) require address geocoding because coordinates are incomplete.`]
    : [];
  return {
    rows,
    report: {
      format,
      totalRows: Math.max(0, matrix.length - 1),
      importedRows: rows.length,
      skippedRows: Math.max(0, matrix.length - 1 - rows.length),
      duplicateRows,
      columnMapping: {
        name: rawHeader[nameIdx] ?? null,
        address: rawHeader[addrIdx] ?? null,
        lat: rawHeader[latIdx] ?? null,
        lon: rawHeader[lonIdx] ?? null,
        assetValue: rawHeader[valIdx] ?? null,
        insured: rawHeader[insuredIdx] ?? null,
        salesPartner: rawHeader[partnerIdx] ?? null,
        subPortfolio: rawHeader[subPortfolioIdx] ?? null,
        group: rawHeader[groupIdx] ?? null,
        productLimitEur: rawHeader[limitIdx] ?? null,
        zuersFloodClass: rawHeader[zuersFloodIdx] ?? null,
        zuersHeavyRainClass: rawHeader[zuersHeavyRainIdx] ?? null,
        zuersWatercourseZone: rawHeader[zuersWatercourseIdx] ?? null,
        zuersVersion: rawHeader[zuersVersionIdx] ?? null,
      },
      issues,
      warnings,
      createdAt: new Date().toISOString(),
    },
  };
}

function parseZuersAssessment(
  cols: string[],
  indexes: { flood: number; heavyRain: number; watercourse: number; version: number },
  row: number,
  issues: ImportReport["issues"],
): NatCatAssessment | undefined {
  const floodClass = readClass(cols[indexes.flood], "zuersFloodClass", row, issues, 4);
  const heavyRainClass = readClass(
    cols[indexes.heavyRain],
    "zuersHeavyRainClass",
    row,
    issues,
    3,
  );
  const watercourseZone = parseBool(cols[indexes.watercourse]);
  if (floodClass == null && heavyRainClass == null && watercourseZone == null) {
    return undefined;
  }

  const hazards = [] as NatCatAssessment["hazards"];
  if (floodClass != null) {
    hazards.push({
      peril: "flood",
      score: classScore(floodClass, 4),
      hazardValue: floodClass,
      unit: "ZÜRS Hochwasser-Gefährdungsklasse",
      rawValue: floodClass,
    });
  }
  if (heavyRainClass != null) {
    hazards.push({
      peril: "heavyRain",
      score: classScore(heavyRainClass, 3),
      hazardValue: heavyRainClass,
      unit: "ZÜRS Starkregen-Gefährdungsklasse",
      rawValue: heavyRainClass,
    });
  }

  const attributes: Record<string, string | number | boolean> = {};
  if (floodClass != null) attributes.floodClass = floodClass;
  if (heavyRainClass != null) attributes.heavyRainClass = heavyRainClass;
  if (watercourseZone != null) attributes.watercourseZone = watercourseZone;
  const retrievedAt = new Date().toISOString();
  return {
    provider: "zuers-geo",
    retrievedAt,
    dataVersion: cols[indexes.version]?.trim() || undefined,
    spatialResolution: "address/building",
    hazards,
    attributes,
    evidence: {
      source: "ZÜRS Geo",
      retrievedAt,
      dataVersion: cols[indexes.version]?.trim() || undefined,
      spatialResolution: "address/building",
      method: "licensed ZÜRS Geo CSV import",
      confidence: 0.9,
      fallbackUsed: false,
      limitations: [
        "Imported classification values require verification against the applicable ZÜRS license and data release",
      ],
    },
  };
}

function readClass(
  value: string | undefined,
  field: string,
  row: number,
  issues: ImportReport["issues"],
  max: number,
): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    issues.push({
      row,
      field,
      severity: "warning",
      message: `Expected an integer from 1 to ${max}; '${value.trim()}' ignored`,
    });
    return undefined;
  }
  return parsed;
}

function classScore(value: number, max: number): number {
  return Math.round(((value - 1) / (max - 1)) * 100 * 100) / 100;
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
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.replace(/^"|"$/g, ""));
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
    issues.push({ row, field, severity: "warning", message: `Invalid number '${s.trim()}' ignored` });
    return { value: undefined };
  }
  return { value: n };
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

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

/**
 * Interprets a cell as an insured flag. Truthy: yes/ja/true/1/insured/
 * versichert/x/policy. Empty cell → undefined (unknown, not false).
 */
function parseBool(s: string | undefined): boolean | undefined {
  const v = s?.trim().toLowerCase();
  if (!v) return undefined;
  return ["yes", "ja", "true", "1", "insured", "versichert", "x", "policy"].includes(
    v,
  );
}
