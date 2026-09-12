import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import type { DealershipInput } from "@shared/types";

/**
 * Import parser (no heavy external dependency for CSV/TSV; XLSX via the
 * `exceljs` dependency already present).
 * Expected columns (case-insensitive, flexible): name, address, lat, lon, value,
 * insured, salespartner, subportfolio, group, limit.
 * CSV/TSV: splits on comma, semicolon, or tab (auto-detected); simple quotes.
 */
export function parseCsv(content: string): DealershipInput[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const matrix = lines.map((l) => splitLine(l, delimiter));
  return rowsFromMatrix(matrix);
}

/** XLSX import: first worksheet, same column heuristic as CSV. */
export async function parseXlsx(base64: string): Promise<DealershipInput[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings expect an older Buffer type → cast at the boundary.
  await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

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
  return rowsFromMatrix(matrix);
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
function rowsFromMatrix(matrix: string[][]): DealershipInput[] {
  if (matrix.length === 0) return [];
  const header = matrix[0].map((h) => h.trim().toLowerCase());
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

  const rows: DealershipInput[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    const name = (nameIdx >= 0 ? cols[nameIdx] : cols[0])?.trim();
    if (!name) continue;

    const lat = latIdx >= 0 ? parseNum(cols[latIdx]) : undefined;
    const lon = lonIdx >= 0 ? parseNum(cols[lonIdx]) : undefined;
    const assetValue = valIdx >= 0 ? parseNum(cols[valIdx]) : undefined;
    const productLimitEur = limitIdx >= 0 ? parseNum(cols[limitIdx]) : undefined;

    rows.push({
      id: randomUUID(),
      name,
      address: addrIdx >= 0 ? cols[addrIdx]?.trim() || undefined : undefined,
      lat: lat != null && !Number.isNaN(lat) ? lat : undefined,
      lon: lon != null && !Number.isNaN(lon) ? lon : undefined,
      assetValue:
        assetValue != null && !Number.isNaN(assetValue)
          ? assetValue
          : undefined,
      insured: insuredIdx >= 0 ? parseBool(cols[insuredIdx]) : undefined,
      salesPartner:
        partnerIdx >= 0 ? cols[partnerIdx]?.trim() || undefined : undefined,
      subPortfolio:
        subPortfolioIdx >= 0
          ? cols[subPortfolioIdx]?.trim() || undefined
          : undefined,
      group: groupIdx >= 0 ? cols[groupIdx]?.trim() || undefined : undefined,
      productLimitEur:
        productLimitEur != null && !Number.isNaN(productLimitEur)
          ? productLimitEur
          : undefined,
    });
  }
  return rows;
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

function parseNum(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.trim().replace(",", "."));
  return Number.isNaN(n) ? undefined : n;
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
