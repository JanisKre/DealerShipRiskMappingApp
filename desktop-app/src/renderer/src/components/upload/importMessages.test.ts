import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { isBrokenWorkbookError, localizeImportIssue } from "./importMessages";

const t = ((key: string, values?: { value?: string }) =>
  `${key}${values?.value ? `(${values.value})` : ""}`) as unknown as TFunction;

describe("localizeImportIssue", () => {
  it("maps every parser note to a translation key", () => {
    expect(localizeImportIssue(t, "Invalid number 'abc' ignored")).toBe(
      "portfolioImport.issue.invalidNumber(abc)",
    );
    expect(localizeImportIssue(t, "Invalid amount '-5' ignored")).toBe(
      "portfolioImport.issue.invalidAmount(-5)",
    );
    expect(localizeImportIssue(t, "Duplicate dealership row skipped")).toBe(
      "portfolioImport.issue.duplicateRow",
    );
    expect(localizeImportIssue(t, "Latitude must be between -90 and 90")).toBe(
      "portfolioImport.issue.latRange",
    );
  });

  it("keeps unknown messages", () => {
    expect(localizeImportIssue(t, "Something else")).toBe("Something else");
  });

  it("recognises a broken workbook", () => {
    expect(
      isBrokenWorkbookError(
        "Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/",
      ),
    ).toBe(true);
    expect(isBrokenWorkbookError("Name column missing")).toBe(false);
  });
});
