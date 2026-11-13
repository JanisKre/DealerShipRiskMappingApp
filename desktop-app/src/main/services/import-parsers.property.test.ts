import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCsvWithReport } from "./csv.service";
import {
  normalizeRelationships,
  normalizeSpreadsheetXml,
  normalizeXlsx,
} from "./xlsx-normalize";
import { readZipEntries, writeZip } from "./zip";

/**
 * Property-based (fuzz-style) tests for the import parsers. They feed
 * generated, often malformed input to the code that reads user-supplied
 * files and check that it either returns a result or throws a plain Error,
 * and that the round trips hold. The seed is fixed so runs are reproducible.
 */

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const params = { seed: 20261113, numRuns: 200 };

const prefix = fc.stringMatching(/^[A-Za-z_][\w.-]{0,6}$/);
const tag = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/);

describe("ZIP reader and writer (property)", () => {
  it("round-trips arbitrary entries", () => {
    const entry = fc.record({
      name: fc.stringMatching(/^[\w./-]{1,40}$/),
      data: fc.uint8Array({ maxLength: 512 }).map((a) => Buffer.from(a)),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 8 }), (entries) => {
        const read = readZipEntries(writeZip(entries));
        expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
        read.forEach((e, i) => expect(e.read().equals(entries[i].data)).toBe(true));
      }),
      params,
    );
  });

  it("rejects arbitrary bytes with an Error, never a crash", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (bytes) => {
        try {
          for (const e of readZipEntries(Buffer.from(bytes))) e.read();
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      params,
    );
  });

  it("returns non-ZIP input to normalizeXlsx unchanged", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
        const buffer = Buffer.from(bytes);
        let result: Buffer;
        try {
          readZipEntries(buffer);
          return; // a valid archive by chance; covered elsewhere
        } catch {
          result = normalizeXlsx(buffer);
        }
        expect(result).toBe(buffer);
      }),
      params,
    );
  });
});

describe("SpreadsheetML normalisation (property)", () => {
  it("strips the SpreadsheetML prefix and is idempotent", () => {
    fc.assert(
      fc.property(prefix, fc.array(tag, { maxLength: 6 }), (p, tags) => {
        const body = tags.map((t) => `<${p}:${t}/>`).join("");
        const xml = `<${p}:worksheet xmlns:${p}="${MAIN}">${body}</${p}:worksheet>`;
        const once = normalizeSpreadsheetXml(xml);
        expect(once).toBe(
          `<worksheet xmlns="${MAIN}">${tags.map((t) => `<${t}/>`).join("")}</worksheet>`,
        );
        expect(normalizeSpreadsheetXml(once)).toBe(once);
      }),
      params,
    );
  });

  it("leaves XML without a prefixed SpreadsheetML namespace untouched", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        fc.pre(!text.includes(MAIN));
        expect(normalizeSpreadsheetXml(text)).toBe(text);
      }),
      params,
    );
  });

  it("never touches external relationship targets", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const target = url.replace(/"/g, "");
        const rels = `<Relationships><Relationship TargetMode="External" Target="${target}" Id="x"/></Relationships>`;
        expect(normalizeRelationships(rels, "xl/_rels/workbook.xml.rels")).toBe(rels);
      }),
      params,
    );
  });
});

describe("CSV import (property)", () => {
  it("returns a report or throws an Error for arbitrary text", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        try {
          const result = parseCsvWithReport(text);
          expect(Array.isArray(result.rows)).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      params,
    );
  });
});
