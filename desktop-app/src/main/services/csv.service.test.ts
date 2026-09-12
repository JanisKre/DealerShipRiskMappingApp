import { describe, expect, it } from "vitest";
import { parseCsvWithReport } from "./csv.service";

describe("portfolio import report", () => {
  it("reports mappings, duplicates, and invalid numeric cells", () => {
    const result = parseCsvWithReport([
      "name,address,lat,lon",
      "Berlin Motors,Main Street 1,52.5,13.4",
      "Berlin Motors,Main Street 1,52.5,13.4",
      "Hamburg Cars,Harbour Road 2,nope,10.0",
    ].join("\n"));

    expect(result.rows).toHaveLength(2);
    expect(result.report.totalRows).toBe(3);
    expect(result.report.importedRows).toBe(2);
    expect(result.report.duplicateRows).toBe(1);
    expect(result.report.columnMapping.lat).toBe("lat");
    expect(result.report.issues.some((issue) => issue.field === "lat")).toBe(true);
  });

  it("records missing names as skipped errors", () => {
    const result = parseCsvWithReport("name,address\n,Somewhere\nValid,Else");

    expect(result.rows).toHaveLength(1);
    expect(result.report.skippedRows).toBe(1);
    expect(result.report.issues[0]).toMatchObject({
      row: 2,
      field: "name",
      severity: "error",
    });
  });
});
