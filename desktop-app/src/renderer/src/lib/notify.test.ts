import { describe, expect, it } from "vitest";
import {
  errorReason,
  fileNameOf,
  NOTIFY_ACTION_DURATION,
  NOTIFY_DURATION,
  toastOptions,
} from "./notify";

describe("errorReason", () => {
  it("drops Electron's IPC prefix", () => {
    expect(
      errorReason(
        new Error(
          "Error invoking remote method 'session:save': Error: disk full",
        ),
      ),
    ).toBe("disk full");
    expect(
      errorReason(
        new Error("Error invoking remote method 'x': TypeError: bad input"),
      ),
    ).toBe("bad input");
  });

  it("keeps plain messages and strings, and is empty otherwise", () => {
    expect(errorReason(new Error("timeout"))).toBe("timeout");
    expect(errorReason("offline")).toBe("offline");
    expect(errorReason({ code: 1 })).toBe("");
    expect(errorReason(undefined)).toBe("");
  });
});

describe("toastOptions", () => {
  it("puts the cause under the title", () => {
    const options = toastOptions("error", "Speichern fehlgeschlagen", {
      cause: new Error("Error invoking remote method 'a': Error: disk full"),
    });
    expect(options.description).toBe("disk full");
    expect(options.duration).toBe(NOTIFY_DURATION.error);
  });

  it("does not repeat a cause that equals the title", () => {
    expect(
      toastOptions("error", "disk full", { cause: new Error("disk full") })
        .description,
    ).toBeUndefined();
  });

  it("prefers an explicit description over the cause", () => {
    expect(
      toastOptions("error", "Import fehlgeschlagen", {
        description: "Bitte als CSV speichern.",
        cause: new Error("zip"),
      }).description,
    ).toBe("Bitte als CSV speichern.");
  });

  it("gives the same message the same id, so it replaces itself", () => {
    expect(toastOptions("success", "Gespeichert").id).toBe(
      toastOptions("success", "Gespeichert").id,
    );
    expect(toastOptions("success", "Gespeichert").id).not.toBe(
      toastOptions("error", "Gespeichert").id,
    );
    expect(toastOptions("info", "x", { id: 7 }).id).toBe(7);
  });

  it("keeps a toast with an action long enough to use it", () => {
    const options = toastOptions("success", "Zurückgesetzt", {
      action: { label: "Rückgängig", onClick: () => undefined },
    });
    expect(options.duration).toBe(NOTIFY_ACTION_DURATION);
    expect(NOTIFY_ACTION_DURATION).toBeGreaterThan(NOTIFY_DURATION.success);
  });

  it("orders the kinds by urgency", () => {
    expect(NOTIFY_DURATION.success).toBeLessThan(NOTIFY_DURATION.info);
    expect(NOTIFY_DURATION.info).toBeLessThan(NOTIFY_DURATION.warning);
    expect(NOTIFY_DURATION.warning).toBeLessThan(NOTIFY_DURATION.error);
  });
});

describe("fileNameOf", () => {
  it("keeps only the file name", () => {
    expect(fileNameOf("/Users/a/Exports/Autohaus West.pdf")).toBe(
      "Autohaus West.pdf",
    );
    expect(fileNameOf("C:\\Exports\\report.csv")).toBe("report.csv");
    expect(fileNameOf("plain.xlsx")).toBe("plain.xlsx");
  });
});
