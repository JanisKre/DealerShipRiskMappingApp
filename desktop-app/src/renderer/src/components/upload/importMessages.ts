import type { TFunction } from "i18next";

/**
 * Parser notes come from the main process in English; the import dialog
 * shows them in the UI language (UW-17). Unknown messages stay as they are.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/^Missing dealership name$/, "portfolioImport.issue.missingName"],
  [/^Latitude must be between -90 and 90$/, "portfolioImport.issue.latRange"],
  [
    /^Longitude must be between -180 and 180$/,
    "portfolioImport.issue.lonRange",
  ],
  [/^Duplicate dealership row skipped$/, "portfolioImport.issue.duplicateRow"],
  [/^Invalid number '(.*)' ignored$/, "portfolioImport.issue.invalidNumber"],
  [/^Invalid amount '(.*)' ignored$/, "portfolioImport.issue.invalidAmount"],
  [
    /^Unrecognised business type '(.*)' left unclassified$/,
    "portfolioImport.issue.unknownBusiness",
  ],
];

export function localizeImportIssue(t: TFunction, message: string): string {
  for (const [pattern, key] of PATTERNS) {
    const match = pattern.exec(message);
    if (match) return t(key, { value: match[1] ?? "" });
  }
  return message;
}

/**
 * Reading an .xlsx that is not a workbook fails deep in the zip reader
 * with a technical message (and a URL); say what it means instead.
 */
export function isBrokenWorkbookError(message: string): boolean {
  return /zip|central directory|corrupted|end of data|jszip|signature/i.test(
    message,
  );
}
