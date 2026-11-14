import { describe, expect, it } from "vitest";
import { decodeImportText } from "./decodeText";

const buf = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;
const utf8 = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("decodeImportText", () => {
  it("reads UTF-8 with and without BOM", () => {
    expect(decodeImportText(utf8("Name;Länge\nA;7,1"))).toEqual({
      ok: true,
      text: "Name;Länge\nA;7,1",
      encoding: "utf-8",
    });
    const withBom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("Ä"),
    ]);
    expect(decodeImportText(withBom.buffer)).toMatchObject({ text: "Ä" });
  });

  it("falls back to Windows-1252 for German Excel CSVs", () => {
    // "Länge;Straße" in Windows-1252: ä = 0xE4, ß = 0xDF.
    const latin1 = buf([
      0x4c, 0xe4, 0x6e, 0x67, 0x65, 0x3b, 0x53, 0x74, 0x72, 0x61, 0xdf, 0x65,
    ]);
    expect(decodeImportText(latin1)).toEqual({
      ok: true,
      text: "Länge;Straße",
      encoding: "windows-1252",
    });
  });

  it("reads UTF-16 with BOM", () => {
    expect(
      decodeImportText(buf([0xff, 0xfe, 0x41, 0x00, 0xc4, 0x00])),
    ).toMatchObject({
      text: "AÄ",
      encoding: "utf-16le",
    });
  });

  it("refuses binary content", () => {
    const junk = Array.from({ length: 400 }, (_, i) => (i * 37) % 256);
    expect(decodeImportText(buf(junk))).toEqual({
      ok: false,
      reason: "binary",
    });
  });
});
