/**
 * Decodes an imported CSV/TSV file. German Excel saves "CSV (Trennzeichen-
 * getrennt)" as Windows-1252, which `File.text()` reads as UTF-8 and turns
 * every umlaut into "�" — headers such as "Länge" then went unrecognised and
 * coordinates were ignored (UW-05). Binary files are refused instead of
 * being previewed as junk rows (UW-19).
 */
export type TextEncodingName =
  "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export type DecodedText =
  | { ok: true; text: string; encoding: TextEncodingName }
  | { ok: false; reason: "binary" };

/** Above this share of control bytes a file is not text. */
const MAX_CONTROL_SHARE = 0.02;

export function decodeImportText(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return decoded(bytes.subarray(3), "utf-8");
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return decoded(bytes.subarray(2), "utf-16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return decoded(bytes.subarray(2), "utf-16be");
  if (controlShare(bytes) > MAX_CONTROL_SHARE)
    return { ok: false, reason: "binary" };
  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8",
    };
  } catch {
    return decoded(bytes, "windows-1252");
  }
}

function decoded(bytes: Uint8Array, encoding: TextEncodingName): DecodedText {
  return { ok: true, text: new TextDecoder(encoding).decode(bytes), encoding };
}

/** Share of bytes that never occur in text (NUL and C0 controls but tab/CR/LF/FF). */
function controlShare(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const sample = bytes.subarray(0, 64 * 1024);
  let control = 0;
  for (const b of sample) {
    if (
      (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) ||
      b === 0x7f
    )
      control++;
  }
  return control / sample.length;
}
