import { beforeEach, describe, expect, it, vi } from "vitest";

const shown: string[] = [];
vi.mock("electron", () => ({
  shell: { showItemInFolder: (p: string) => shown.push(p) },
}));

const { rememberExport, showExportInFolder } = await import("./exported-files");

describe("showExportInFolder", () => {
  beforeEach(() => {
    shown.length = 0;
  });

  it("reveals only files this run exported", () => {
    expect(rememberExport("/tmp/report.pdf")).toBe("/tmp/report.pdf");
    expect(showExportInFolder("/tmp/report.pdf")).toBe(true);
    expect(showExportInFolder("/etc/passwd")).toBe(false);
    expect(shown).toEqual(["/tmp/report.pdf"]);
  });

  it("ignores a cancelled export", () => {
    expect(rememberExport(null)).toBeNull();
    expect(showExportInFolder("")).toBe(false);
  });
});
