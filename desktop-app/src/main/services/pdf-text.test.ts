import { describe, expect, it } from "vitest";
import { pdfSafeText } from "./pdf-text";

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
