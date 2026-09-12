import { describe, expect, it } from "vitest";
import { classifyInput } from "./classifyInput";

describe("classifyInput", () => {
  it("recognizes addresses by street suffix, postal code, and house number", () => {
    expect(classifyInput("Hauptstraße 12, 50667 Köln")).toBe("address");
    expect(classifyInput("Kfz-Weg 3")).toBe("address");
    expect(classifyInput("Musterplatz 1")).toBe("address");
    expect(classifyInput("10115 Berlin")).toBe("address");
  });

  it("recognizes questions by question mark", () => {
    expect(classifyInput("Ist das Portfolio riskant")).toBe("question"); // domain term
    expect(classifyInput("Kannst du das zusammenfassen?")).toBe("question");
  });

  it("recognizes questions by interrogative/command starter words (de + en)", () => {
    expect(classifyInput("Welche Standorte haben hohes Hagelrisiko")).toBe(
      "question",
    );
    expect(classifyInput("Zeige alle mit hoher Auslastung")).toBe("question");
    expect(classifyInput("Wo besteht die höchste Kumul-Gefahr")).toBe(
      "question",
    );
    expect(classifyInput("Show all high-risk locations")).toBe("question");
    expect(classifyInput("Compare the two portfolios")).toBe("question");
  });

  it("recognizes questions by domain terms", () => {
    expect(classifyInput("Standorte mit EAL über 100.000 €")).toBe("question");
    expect(classifyInput("Auslastung über 80 %")).toBe("question");
  });

  it("guesses address on ambiguous/empty input", () => {
    expect(classifyInput("Köln")).toBe("address");
    expect(classifyInput("Autohaus Meier")).toBe("address");
    expect(classifyInput("")).toBe("address");
    expect(classifyInput("   ")).toBe("address");
  });
});
