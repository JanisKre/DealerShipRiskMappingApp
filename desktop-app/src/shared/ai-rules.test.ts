import { describe, expect, it } from "vitest";
import {
  cleanBoundaryVerdict,
  cleanNote,
  cleanSiteFindings,
  featuresSince,
  spreadOverTime,
  SiteCheckAnswerSchema,
  type SiteCheck,
  type SiteFindings,
} from "./site-check";
import { groundAnswers } from "./questionnaire-answers";
import { noticeFacts, noticeSites } from "./event-notice";
import {
  cleanRemoteTools,
  toolResultText,
  validateMcpServerUrl,
} from "./mcp-client";

describe("site check", () => {
  it("maps anything unexpected to unclear", () => {
    const findings = cleanSiteFindings(
      SiteCheckAnswerSchema.parse({
        hailNet: "YES",
        canopy: "probably",
        openAirShare: "aboutHalf",
        note: "Netze über den östlichen Reihen.",
      }),
    );
    expect(findings).toMatchObject({
      hailNet: "yes",
      canopy: "unclear",
      parkingStructure: "unclear",
      openAirShare: "aboutHalf",
      note: "Netze über den östlichen Reihen.",
    });
  });

  it("discards notes with amounts or percentages and unusable images", () => {
    expect(cleanNote("Etwa 40 % der Fahrzeuge unter Dach")).toBe("");
    expect(
      cleanNote(
        "Etwa 40 Fahrzeuge stehen unter Netzen, der Schaden läge bei EUR 5.000 je Fahrzeug, also rund 200000 insgesamt.",
      ),
    ).toBe("");
    expect(cleanNote("Netze über den östlichen Reihen")).toBe(
      "Netze über den östlichen Reihen",
    );
    expect(cleanNote("Schaden ca. 5000 EUR")).toBe("");
    expect(cleanNote("Zwei Hallen im Norden")).toBe("Zwei Hallen im Norden");
    const unusable = cleanSiteFindings(
      SiteCheckAnswerSchema.parse({ imageUsable: false, hailNet: "yes" }),
    );
    expect(unusable.hailNet).toBe("unclear");
  });

  it("spreads archived images over the range", () => {
    expect(spreadOverTime([1, 2, 3, 4, 5, 6, 7], 4)).toEqual([1, 3, 5, 7]);
    expect(spreadOverTime([1, 2], 4)).toEqual([1, 2]);
  });

  const check = (
    date: string,
    hailNet: SiteFindings["hailNet"],
  ): SiteCheck => ({
    checkedAt: "2026-11-15T00:00:00Z",
    model: "m",
    imageCapturedAt: date,
    imageLabel: "Esri",
    findings: {
      imageUsable: true,
      hailNet,
      canopy: "no",
      parkingStructure: "no",
      openAirShare: "most",
      note: "",
    },
  });

  it("dates a feature back to the last image without it", () => {
    const since = featuresSince({
      current: check("2025-06-01", "yes"),
      history: [
        check("2023-05-01", "yes"),
        check("2021-07-01", "no"),
        check("2019-07-01", "yes"),
      ],
    });
    expect(since).toEqual([
      { feature: "hailNet", seenSince: "2023-05-01", absentOn: "2021-07-01" },
    ]);
    expect(
      featuresSince({ current: check("2025-06-01", "no"), history: [] }),
    ).toEqual([]);
  });

  it("accepts only known boundary verdicts", () => {
    expect(
      cleanBoundaryVerdict({ verdict: "tooLarge", note: "Feld im Süden" }),
    ).toEqual({ verdict: "tooLarge", note: "Feld im Süden" });
    expect(cleanBoundaryVerdict({ verdict: "fine", note: "" }).verdict).toBe(
      "unclear",
    );
  });
});

describe("groundAnswers", () => {
  const reply =
    "Guten Tag,\nwir haben Hagelnetze über 80 Stellplätzen.\nNachts stehen etwa 60 Fahrzeuge draußen.";
  const asked = ["hailProtection", "outdoorAtNight", "pastLosses"] as const;

  it("keeps answers whose quote is in the reply, in question order", () => {
    const answers = groundAnswers(
      [
        {
          questionId: "outdoorAtNight",
          answer: "Rund 60 Fahrzeuge nachts im Freien.",
          quote: "nachts stehen etwa 60 Fahrzeuge draußen",
        },
        {
          questionId: "hailProtection",
          answer: "Hagelnetze über 80 Stellplätzen.",
          quote: "wir haben Hagelnetze über\n80 Stellplätzen",
        },
      ],
      reply,
      asked,
    );
    expect(answers.map((a) => a.questionId)).toEqual([
      "hailProtection",
      "outdoorAtNight",
    ]);
  });

  it("drops invented quotes, unknown questions and duplicates", () => {
    const answers = groundAnswers(
      [
        {
          questionId: "pastLosses",
          answer: "Kein Schaden.",
          quote: "keine Hagelschäden",
        },
        {
          questionId: "seasonalPeak",
          answer: "x",
          quote: "Hagelnetze über 80",
        },
        {
          questionId: "hailProtection",
          answer: "a",
          quote: "Hagelnetze über 80",
        },
        {
          questionId: "hailProtection",
          answer: "b",
          quote: "Hagelnetze über 80",
        },
        { questionId: "outdoorAtNight", answer: "c", quote: "60" },
      ],
      reply,
      asked,
    );
    expect(answers).toEqual([
      {
        questionId: "hailProtection",
        answer: "a",
        quote: "Hagelnetze über 80",
      },
    ]);
  });
});

describe("event notice", () => {
  it("lists reached sites with date and class, without amounts", () => {
    const sites = noticeSites(
      [
        {
          id: "a",
          firstAt: Date.UTC(2026, 5, 12, 16),
          hailClass: "large",
          distanceKm: 0,
          exposureEur: 1_000_000,
          lossEur: 250_000,
        },
        {
          id: "gone",
          firstAt: 0,
          hailClass: "hail",
          distanceKm: 0.4,
          exposureEur: 1,
          lossEur: 1,
        },
      ],
      new Map([["a", "Autohaus A"]]),
    );
    expect(sites).toEqual([
      {
        id: "a",
        name: "Autohaus A",
        date: "2026-06-12",
        hailClass: "large",
        distanceKm: 0,
      },
    ]);
    const facts = noticeFacts("12.06.2026", sites, 1);
    expect(facts).toContain(
      "Autohaus A: 2026-06-12, large hail, cell over the site",
    );
    expect(facts).not.toContain("250");
  });
});

describe("MCP client rules", () => {
  it("allows HTTPS and local HTTP only", () => {
    expect(validateMcpServerUrl("https://mcp.example.com/mcp#x")).toEqual({
      ok: true,
      url: "https://mcp.example.com/mcp",
    });
    expect(validateMcpServerUrl("http://127.0.0.1:8000/mcp").ok).toBe(true);
    expect(validateMcpServerUrl("http://mcp.example.com/mcp")).toEqual({
      ok: false,
      problem: "insecure",
    });
    expect(validateMcpServerUrl("https://u:p@example.com")).toEqual({
      ok: false,
      problem: "credentials",
    });
    expect(validateMcpServerUrl("file:///etc/passwd")).toEqual({
      ok: false,
      problem: "scheme",
    });
    expect(validateMcpServerUrl("nope").ok).toBe(false);
  });

  it("marks a tool read-only only when the server says so", () => {
    const tools = cleanRemoteTools({
      tools: [
        {
          name: "search",
          description: "x",
          annotations: { readOnlyHint: true },
        },
        { name: "delete_all", description: "y" },
        { name: "bad name!", description: "z" },
        "junk",
      ],
    });
    expect(tools.map((t) => [t.name, t.readOnly])).toEqual([
      ["search", true],
      ["delete_all", false],
    ]);
    expect(cleanRemoteTools(null)).toEqual([]);
  });

  it("reads only text parts of a tool result", () => {
    expect(
      toolResultText({
        content: [
          { type: "text", text: "A" },
          { type: "image", data: "…" },
          { type: "text", text: "B" },
        ],
        isError: true,
      }),
    ).toEqual({ text: "A\nB", isError: true });
  });
});
