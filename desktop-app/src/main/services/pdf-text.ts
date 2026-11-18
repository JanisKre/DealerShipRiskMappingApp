import type { jsPDF } from "jspdf";

/**
 * Text for jsPDF's standard fonts (Helvetica), which only cover the WinAnsi
 * character set. jsPDF writes anything outside it as UTF-16 bytes, so
 * "In Hagelzone ≥ 4", "≈ 12 000", "λ" and "Σ" came out as garbage, and in
 * French every number above 1,000 (grouped with a narrow no-break space).
 *
 * Known symbols get a readable stand-in, accented letters outside the set
 * lose their accent (ł → l, č → c), and whatever is left becomes "?". The
 * result is deterministic, so the PDF tests can check the text.
 */

/** Characters of WinAnsi (CP1252) beyond Latin-1. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));

const REPLACEMENTS: Record<string, string> = {
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "≠": "!=",
  "−": "-",
  "‑": "-",
  "→": "->",
  "←": "<-",
  λ: "lambda",
  Σ: "sum ",
  "∑": "sum ",
  α: "alpha",
  β: "beta",
  Δ: "delta ",
  // Letters without a decomposition into base letter and accent.
  Ł: "L",
  ł: "l",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  ı: "i",
  "\u202f": " ",
  "\u2009": " ",
  "\u2007": " ",
  "\u200b": "",
  "\u00a0": " ",
};

function inWinAnsi(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRA.has(char);
}

export function pdfSafeText(text: string): string {
  let out = "";
  for (const char of text) {
    const replacement = REPLACEMENTS[char];
    if (replacement != null) {
      out += replacement;
      continue;
    }
    if (inWinAnsi(char)) {
      out += char;
      continue;
    }
    // ł, č, ő …: the base letter without its accent, where one exists.
    const base = char.normalize("NFKD").replace(/\p{M}/gu, "");
    out += [...base].every(inWinAnsi) && base !== "" ? base : "?";
  }
  return out;
}

type TextArg = string | string[];

function safe<T extends TextArg>(text: T): T {
  return (Array.isArray(text) ? text.map(pdfSafeText) : pdfSafeText(text)) as T;
}

/**
 * Routes the document's text drawing and measuring through `pdfSafeText`,
 * so every string written by the report code (and by jspdf-autotable, which
 * draws through the same methods) stays inside the font's character set.
 */
export function withPdfSafeText(doc: jsPDF): jsPDF {
  const text = doc.text.bind(doc);
  const split = doc.splitTextToSize.bind(doc);
  const width = doc.getTextWidth.bind(doc);
  const stringWidth = doc.getStringUnitWidth.bind(doc);
  doc.text = ((value: TextArg, ...rest: unknown[]) =>
    (text as (...args: unknown[]) => jsPDF)(
      safe(value),
      ...rest,
    )) as jsPDF["text"];
  doc.splitTextToSize = ((value: string, ...rest: unknown[]) =>
    (split as (...args: unknown[]) => string[])(
      pdfSafeText(value),
      ...rest,
    )) as jsPDF["splitTextToSize"];
  doc.getTextWidth = (value: string) => width(pdfSafeText(value));
  doc.getStringUnitWidth = ((value: string, ...rest: unknown[]) =>
    (stringWidth as (...args: unknown[]) => number)(
      pdfSafeText(value),
      ...rest,
    )) as jsPDF["getStringUnitWidth"];
  return doc;
}
