import { posix } from "node:path";
import { readZipEntries, writeZip } from "./zip";

/**
 * Some spreadsheet writers (the Microsoft Open XML SDK and tools built on
 * it) put a namespace prefix on every SpreadsheetML element —
 * `<x:workbook>`, `<x:row>` — instead of a default namespace. That is valid
 * OOXML and Excel opens it, but exceljs only recognises unprefixed names
 * and fails with "Cannot read properties of undefined (reading 'sheets')".
 * These helpers rewrite such parts to the default namespace before the
 * workbook is loaded. The same writers use absolute part paths in their
 * relationships (`Target="/xl/tables/table1.xml"`), which exceljs cannot
 * resolve either; those become relative. Other files pass through untouched.
 */

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PREFIXED_MAIN_NS = new RegExp(
  `xmlns:([A-Za-z_][\\w.-]*)="${MAIN_NS.replace(/[./]/g, "\\$&")}"`,
  "g",
);

/** Rewrites one XML part to use the default SpreadsheetML namespace. */
export function normalizeSpreadsheetXml(xml: string): string {
  const text = xml.replace(/^\uFEFF/, "");
  const prefixes = [
    ...new Set([...text.matchAll(PREFIXED_MAIN_NS)].map((m) => m[1])),
  ];
  if (prefixes.length === 0) return xml;
  let out = text;
  for (const prefix of prefixes) {
    const p = prefix.replace(/[.-]/g, "\\$&");
    out = out
      .replace(new RegExp(`<(/?)${p}:`, "g"), "<$1")
      .replace(
        new RegExp(`xmlns:${p}="${MAIN_NS.replace(/[./]/g, "\\$&")}"`, "g"),
        `xmlns="${MAIN_NS}"`,
      );
  }
  return out;
}

/**
 * Makes absolute internal relationship targets relative to the part the
 * `.rels` file belongs to ("xl/worksheets/_rels/sheet1.xml.rels" +
 * "/xl/tables/table1.xml" → "../tables/table1.xml"). External links stay.
 */
export function normalizeRelationships(xml: string, relsPath: string): string {
  // "<dir>/_rels/<part>.rels" belongs to "<dir>/<part>"; targets resolve
  // against "<dir>".
  const baseDir = posix.dirname(posix.dirname(relsPath.replace(/^\//, "")));
  return xml.replace(/<Relationship\b[^>]*>/g, (tag) => {
    if (/TargetMode="External"/.test(tag)) return tag;
    return tag.replace(/Target="\/([^"]*)"/, (_, target: string) => {
      const relative = posix.relative(baseDir === "." ? "" : baseDir, target);
      return `Target="${relative}"`;
    });
  });
}

/**
 * Returns an XLSX package exceljs can read: unchanged when no part uses a
 * prefixed SpreadsheetML namespace, otherwise repacked with those parts
 * rewritten. Anything that is not a readable ZIP is returned as it is, so
 * exceljs reports the real problem.
 */
export function normalizeXlsx(buffer: Buffer): Buffer {
  let entries: ReturnType<typeof readZipEntries>;
  try {
    entries = readZipEntries(buffer);
  } catch {
    return buffer;
  }
  let changed = false;
  const files = entries.map((entry) => {
    const data = entry.read();
    const isRels = /\.rels$/i.test(entry.name);
    if (!isRels && !/\.xml$/i.test(entry.name))
      return { name: entry.name, data };
    const xml = data.toString("utf8");
    const normalized = isRels
      ? normalizeRelationships(xml, entry.name)
      : normalizeSpreadsheetXml(xml);
    if (normalized === xml) return { name: entry.name, data };
    changed = true;
    return { name: entry.name, data: Buffer.from(normalized, "utf8") };
  });
  return changed ? writeZip(files) : buffer;
}
