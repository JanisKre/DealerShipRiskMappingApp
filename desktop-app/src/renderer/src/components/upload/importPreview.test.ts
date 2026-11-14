import { describe, expect, it } from "vitest";
import type { DealershipInput, ImportIssue } from "@shared/types";
import {
  buildPreviewRows,
  coordinateWarning,
  editPreviewRow,
  needsAttention,
  placement,
  skippedIssues,
} from "./importPreview";

const rows: DealershipInput[] = [
  { id: "1", name: "Autohaus Nord", lat: 51, lon: 13 },
  { id: "2", name: "Autohaus Süd", address: "Hauptstraße 1, Dresden" },
  { id: "3", name: "Autohaus Ohne" },
  { id: "4", name: "Autohaus Nord", lat: 51.0001, lon: 13.0001 },
  { id: "5", name: "Autohaus Alt", address: "Ring 2, Leipzig" },
];
const rowNumbers = [2, 3, 5, 6, 7];
const issues: ImportIssue[] = [
  {
    row: 3,
    field: "assetValue",
    severity: "warning",
    message: "Unreadable value",
  },
  {
    row: 4,
    field: "name",
    severity: "error",
    message: "Missing dealership name",
  },
];
const existing: DealershipInput[] = [
  { id: "x", name: "Autohaus Alt", address: "Ring 2, Leipzig" },
];

describe("import preview", () => {
  it("tells how each row will be placed", () => {
    expect(rows.map(placement)).toEqual([
      "coordinates",
      "address",
      "missing",
      "coordinates",
      "address",
    ]);
  });

  it("attaches notes, duplicates and default ticks", () => {
    const preview = buildPreviewRows(rows, rowNumbers, issues, existing);
    // Rows 3 (no place), 4 (repeats row 2) and 5 (in the portfolio) start off.
    expect(preview.map((r) => r.include)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(preview[1].issues.map((i) => i.message)).toEqual([
      "Unreadable value",
    ]);
    expect(preview[3].duplicateOfRow).toBe(2);
    expect(preview[4].duplicateOfExisting).toBe("Autohaus Alt");
    expect(preview.filter(needsAttention).map((r) => r.row.id)).toEqual([
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("re-derives the placement after an inline fix", () => {
    const [, , missing] = buildPreviewRows(rows, rowNumbers, issues, []);
    const fixed = editPreviewRow(missing, { address: "Weg 3, Chemnitz" });
    expect(fixed.placement).toBe("address");
    expect(fixed.row.address).toBe("Weg 3, Chemnitz");
    const cleared = editPreviewRow(fixed, { address: "  ", name: " Neu " });
    expect(cleared.placement).toBe("missing");
    expect(cleared.include).toBe(false);
    expect(cleared.row.name).toBe("Neu");
  });

  it("lists the notes of rows the parser dropped", () => {
    expect(skippedIssues(issues, rowNumbers).map((i) => i.row)).toEqual([4]);
  });
});

describe("coordinate plausibility (UW-06)", () => {
  it("flags Paris, 0/0 and swapped coordinates and leaves them unticked", () => {
    const odd: DealershipInput[] = [
      { id: "ok", name: "Anröchte", lat: 51.566, lon: 8.312 },
      { id: "paris", name: "Paris", lat: 48.8566, lon: 2.3522 },
      { id: "null", name: "Null", lat: 0, lon: 0 },
      { id: "swap", name: "Vertauscht", lat: 8.312, lon: 51.566 },
    ];
    expect(odd.map(coordinateWarning)).toEqual([
      undefined,
      "outsideGermany",
      "outsideGermany",
      "swapped",
    ]);
    const preview = buildPreviewRows(odd, [2, 3, 4, 5], [], []);
    expect(preview.map((r) => r.include)).toEqual([true, false, false, false]);
    expect(preview.filter(needsAttention).map((r) => r.row.id)).toEqual([
      "paris",
      "null",
      "swap",
    ]);
  });
});
