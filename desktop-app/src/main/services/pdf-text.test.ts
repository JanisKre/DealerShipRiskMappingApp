import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { pdfSafeText, withPdfSafeText } from "./pdf-text";

describe("pdfSafeText", () => {
  it("keeps German and French text as it is", () => {
    expect(pdfSafeText("Größe, Straße, élevé – 12 €")).toBe(
      "Größe, Straße, élevé – 12 €",
    );
  });

  it("replaces symbols the standard fonts do not have", () => {
    expect(pdfSafeText("In Hagelzone ≥ 4")).toBe("In Hagelzone >= 4");
    expect(pdfSafeText("≈2.896")).toBe("~2.896");
    expect(pdfSafeText("N × λ(Zone) × Σ p·S")).toBe(
      "N × lambda(Zone) × sum  p·S",
    );
    expect(pdfSafeText("12 345")).toBe("12 345");
  });

  it("drops accents outside the character set and marks the rest", () => {
    expect(pdfSafeText("Łódź Autohaus Čech")).toBe("Lódz Autohaus Cech");
    expect(pdfSafeText("車")).toBe("?");
  });
});

describe("withPdfSafeText", () => {
  it("keeps table cells that start outside the character set", () => {
    const doc = withPdfSafeText(new jsPDF({ compress: false }));
    autoTable(doc, {
      head: [["Standort", "≈ Fahrzeuge"]],
      body: [
        ["Čech Automobile", "≈80"],
        ["Zwei\nZeilen", "≈2.000.000 €"],
      ],
    });
    const pdf = doc.output();
    expect(pdf).toContain("(~80)");
    expect(pdf).toContain("(~ Fahrzeuge)");
    expect(pdf).toContain("(Cech Automobile)");
    expect(pdf).toContain("(Zwei)");
    expect(pdf).toContain("(Zeilen)");
    expect(pdf).not.toContain("(?)");
  });

  it("measures and wraps lines given as an array", () => {
    const doc = withPdfSafeText(new jsPDF());
    expect(doc.splitTextToSize(["≈80", ""] as unknown as string, 100)).toEqual([
      "~80",
      "",
    ]);
    expect(doc.getTextWidth("≈80")).toBe(doc.getTextWidth("~80"));
  });
});
