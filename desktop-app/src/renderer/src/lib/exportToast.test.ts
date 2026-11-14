import { describe, expect, it } from "vitest";
import { fileNameOf } from "./exportToast";

describe("fileNameOf", () => {
  it("keeps only the file name", () => {
    expect(fileNameOf("/Users/a/Exports/Autohaus West.pdf")).toBe(
      "Autohaus West.pdf",
    );
    expect(fileNameOf("C:\\Exports\\report.csv")).toBe("report.csv");
    expect(fileNameOf("plain.xlsx")).toBe("plain.xlsx");
  });
});
