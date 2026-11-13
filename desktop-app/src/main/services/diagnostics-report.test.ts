import { describe, expect, it } from "vitest";
import {
  buildDiagnosticsReport,
  diagnosticsFileName,
} from "./diagnostics-report";

describe("buildDiagnosticsReport", () => {
  it("contains environment, settings and log lines with secrets masked", () => {
    const report = buildDiagnosticsReport({
      generatedAt: new Date("2026-11-13T10:00:00.000Z"),
      app: {
        name: "Dealership Risk Mapping",
        version: "0.5.0",
        packaged: true,
      },
      runtime: { electron: "44.10.2" },
      os: {
        platform: "win32",
        arch: "x64",
        release: "10.0.22631",
        locale: "de-DE",
      },
      settings: {
        language: "de",
        llm: {
          provider: "custom",
          model: "m",
          baseUrl: "https://user:secret@llm.example/v1",
          hasApiKey: true,
        },
      },
      data: { sessions: 3, databaseBytes: 4096 },
      detectionModelInstalled: false,
      log: "2026-11-13 [warn] retry with key sk-abcdefghijkl\n\n2026-11-13 [info] done\n",
    });

    expect(report.format).toBe("dealership-risk-mapping/diagnostics@1");
    expect(report.generatedAt).toBe("2026-11-13T10:00:00.000Z");
    expect(JSON.stringify(report.settings)).not.toContain("secret");
    expect(report.log).toEqual([
      "2026-11-13 [warn] retry with key [redacted-key]",
      "2026-11-13 [info] done",
    ]);
    expect(report.data).toEqual({ sessions: 3, databaseBytes: 4096 });
  });
});

describe("diagnosticsFileName", () => {
  it("names the file after the local date and time", () => {
    expect(diagnosticsFileName(new Date(2026, 10, 3, 9, 5))).toBe(
      "drm-diagnostics-20261103-0905.json",
    );
  });
});
