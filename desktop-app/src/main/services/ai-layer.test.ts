import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzedDealership, Settings } from "@shared/types";
import type { AiLogDetail } from "@shared/ai-log";

const mocks = vi.hoisted(() => ({
  settings: { language: "de" } as Settings,
  tokens: new Map<string, string>(),
}));

vi.mock("./settings.service", () => ({
  getSettings: () => mocks.settings,
  getLlmApiKey: () => "sk-test",
  getMcpServerToken: (id: string) => mocks.tokens.get(id) ?? null,
}));
vi.mock("./tiles.service", () => ({}));
vi.mock("./wayback.service", () => ({}));

import { configureAiLog, withAiFeature } from "./ai-log.service";
import {
  extractQuestionnaireAnswers,
  explainSystemPrompt,
  writeEvidenceMemo,
} from "./llm-agents.service";
import { chatComplete, chatCompleteStream } from "./llm.service";
import {
  callMcpServerTool,
  listMcpServerTools,
  mcpChatLookup,
  readRpcResponse,
} from "./mcp-client.service";
import sharp from "sharp";
import {
  SITE_CHECK_IMAGE_MAX_PX,
  encodeAerialImage,
  outlinePath,
} from "./site-check.service";
import type { AerialCapture } from "./tiles.service";

const fetchMock = vi.fn<typeof fetch>();

function llmReply(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const logged: Array<Omit<AiLogDetail, "id">> = [];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.settings = {
    language: "de",
    llm: { provider: "openai", model: "gpt-test" },
  };
  mocks.tokens.clear();
  logged.length = 0;
  configureAiLog(
    (entry) => logged.push(entry),
    () => mocks.settings.aiLogEnabled !== false,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureAiLog(null);
});

describe("AI record book", () => {
  it("records a request with its origin, destination and texts", async () => {
    fetchMock.mockResolvedValueOnce(llmReply("Hallo"));
    await withAiFeature("llm:test", () =>
      chatComplete([{ role: "user", content: "Frage" }]),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      feature: "llm:test",
      provider: "openai",
      model: "gpt-test",
      endpointHost: "api.openai.com",
      local: false,
      status: "ok",
      response: "Hallo",
      imageCount: 0,
    });
    expect(logged[0].request).toContain("[user]\nFrage");
  });

  it("records failures and never stores the API key or an image", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(
      chatComplete([{ role: "user", content: "Bild" }], 100, [
        { mediaType: "image/jpeg", base64: "QUJDREVG" },
      ]),
    ).rejects.toThrow("LLM 500");
    expect(logged[0]).toMatchObject({ status: "error", imageCount: 1 });
    const stored = JSON.stringify(logged[0]);
    expect(stored).not.toContain("sk-test");
    expect(stored).not.toContain("QUJDREVG");
    // The image itself did go to the provider, attached to the user turn.
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: unknown }>;
    };
    expect(JSON.stringify(body.messages[0].content)).toContain(
      "data:image/jpeg;base64,QUJDREVG",
    );
  });

  it("marks a local runtime as staying on this computer", async () => {
    mocks.settings = {
      language: "de",
      llm: { provider: "local", model: "llama" },
    };
    fetchMock.mockResolvedValueOnce(llmReply("ok"));
    await chatComplete([{ role: "user", content: "x" }]);
    expect(logged[0]).toMatchObject({ local: true, feature: "other" });
  });

  it("records a stream once, with the full answer", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hal"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    fetchMock.mockResolvedValueOnce(
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    let text = "";
    for await (const token of chatCompleteStream([
      { role: "user", content: "x" },
    ]))
      text += token;
    expect(text).toBe("Hallo");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: "ok", response: "Hallo" });
  });

  it("writes nothing when the user switched the record off", async () => {
    mocks.settings = { ...mocks.settings, aiLogEnabled: false };
    fetchMock.mockResolvedValueOnce(llmReply("ok"));
    await chatComplete([{ role: "user", content: "x" }]);
    expect(logged).toEqual([]);
  });
});

const site: AnalyzedDealership = {
  id: "a",
  name: "Autohaus A",
  lat: 48,
  lon: 11,
  notes: "GEHEIM",
  detection: { vehicleCount: 120, confidence: 0.8, model: "yolo" },
  risk: {
    overallScore: 60,
    perils: [],
    eal: 4812,
    ealBreakdown: {
      hail: 4812,
      total: 4812,
      hailDetail: {
        vehicles: 120,
        exposedVehicles: 120,
        vehicleSource: "detected",
        zone: 4,
        zoneSource: "postcode",
        frequency: 0.1,
        meanSeverityEur: 401,
      },
    },
    computedAt: "2026-10-01T00:00:00Z",
  },
};

describe("evidence memo agent", () => {
  it("sends facts without notes and drops sentences with invented figures", async () => {
    fetchMock.mockResolvedValueOnce(
      llmReply({
        sentences: [
          {
            text: "Gezählt wurden 120 Fahrzeuge in Hagelzone 4.",
            facts: ["f1"],
          },
          {
            text: "Ein Selbstbehalt von 5.000 EUR wäre angemessen.",
            facts: [],
          },
        ],
      }),
    );
    const memo = await writeEvidenceMemo(site);
    expect(memo.sentences.map((s) => s.text)).toEqual([
      "Gezählt wurden 120 Fahrzeuge in Hagelzone 4.",
    ]);
    expect(memo.removed).toHaveLength(1);
    const sent = String(fetchMock.mock.calls[0][1]?.body);
    expect(sent).toContain("[f1] Vehicles on the lot (N): 120");
    expect(sent).not.toContain("GEHEIM");
  });
});

describe("questionnaire answers agent", () => {
  it("keeps only answers quoted from the reply", async () => {
    const reply = "Wir haben Hagelnetze über 80 Stellplätzen installiert.";
    fetchMock.mockResolvedValueOnce(
      llmReply({
        answers: [
          {
            questionId: "hailProtection",
            answer: "Hagelnetze über 80 Stellplätzen.",
            quote: "Hagelnetze über 80 Stellplätzen",
          },
          {
            questionId: "pastLosses",
            answer: "Keine Schäden.",
            quote: "keine Schäden in den letzten Jahren",
          },
        ],
      }),
    );
    const answers = await extractQuestionnaireAnswers(
      [
        { id: "hailProtection", text: "Gibt es Hagelschutz?" },
        { id: "pastLosses", text: "Gab es Schäden?" },
      ],
      reply,
    );
    expect(answers.map((a) => a.questionId)).toEqual(["hailProtection"]);
  });
});

describe("explanation prompts", () => {
  it("forbid amounts in the counter-argument and damage claims in the notice", () => {
    expect(explainSystemPrompt("challenge", "German")).toContain(
      "Never write amounts or percentages",
    );
    expect(explainSystemPrompt("eventNotice", "German")).toContain(
      "do not state or imply that damage occurred",
    );
  });
});

describe("site check image", () => {
  it("maps the lot outline into image pixels", () => {
    const path = outlinePath(
      {
        type: "Polygon",
        coordinates: [
          [
            [11, 48.01],
            [11.01, 48.01],
            [11.01, 48],
            [11, 48.01],
          ],
        ],
      },
      [11, 48, 11.02, 48.02],
      200,
      100,
    );
    expect(path).toBe("M0.0,50.0L100.0,50.0L100.0,100.0L0.0,50.0Z");
  });
});

describe("site check image encoding", () => {
  // Found with a real capture: sharp resizes before it composites, so an
  // outline drawn at capture size no longer fitted a downscaled image.
  it("draws the outline on a capture larger than the output size", async () => {
    const width = 2304;
    const height = 1792;
    const capture = {
      rgba: new Uint8Array(width * height * 4).fill(120),
      width,
      height,
      bbox: [11, 48, 11.02, 48.02],
      validTileCount: 1,
      tileCount: 1,
    } as unknown as AerialCapture;
    const image = await encodeAerialImage(capture, {
      source: "manual",
      polygon: {
        type: "Polygon",
        coordinates: [
          [
            [11.005, 48.015],
            [11.015, 48.015],
            [11.015, 48.005],
            [11.005, 48.015],
          ],
        ],
      },
      areaSqm: 1,
      confidence: 1,
    });
    expect(image?.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(image!.base64, "base64")).metadata();
    expect(meta.width).toBe(SITE_CHECK_IMAGE_MAX_PX);
    expect(meta.height).toBe(Math.round((height * 1568) / width));
    // The outline is pink: somewhere the red channel clearly beats green.
    const { data, info } = await sharp(Buffer.from(image!.base64, "base64"))
      .raw()
      .toBuffer({ resolveWithObject: true });
    let pink = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] > 200 && data[i + 1] < 120) pink += 1;
    expect(pink).toBeGreaterThan(100);
  });

  it("returns nothing without imagery", async () => {
    expect(
      await encodeAerialImage({
        rgba: null,
        width: 0,
        height: 0,
        bbox: [0, 0, 1, 1],
        validTileCount: 0,
        tileCount: 1,
      } as unknown as AerialCapture),
    ).toBeNull();
  });
});

describe("MCP client", () => {
  function rpcReply(
    result: unknown,
    init: { sse?: boolean; id?: number } = {},
  ): (input: unknown, request?: RequestInit) => Promise<Response> {
    return async (_input, request) => {
      const sent = JSON.parse(String(request?.body)) as { id?: number };
      if (sent.id === undefined) return new Response(null, { status: 202 });
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: init.id ?? sent.id,
        result,
      });
      return init.sse
        ? new Response(`event: message\ndata: ${body}\n\n`, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
        : new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    };
  }

  const server = {
    id: "claims",
    name: "Schäden",
    url: "https://mcp.example.com/mcp",
    enabled: true,
  };

  function serve(tools: unknown[], callResult: unknown = {}): void {
    fetchMock.mockImplementation(async (input, request) => {
      const sent = JSON.parse(String(request?.body)) as { method: string };
      const result =
        sent.method === "initialize"
          ? { protocolVersion: "2025-06-18", serverInfo: { name: "claims-db" } }
          : sent.method === "tools/list"
            ? { tools }
            : callResult;
      return rpcReply(result, { sse: sent.method === "tools/list" })(
        input,
        request,
      );
    });
  }

  beforeEach(() => {
    mocks.settings = { ...mocks.settings, mcpServers: [server] };
  });

  it("reads a response from JSON and from an event stream", () => {
    expect(
      readRpcResponse(
        '{"jsonrpc":"2.0","id":3,"result":1}',
        "application/json",
        3,
      ),
    ).toMatchObject({ result: 1 });
    expect(
      readRpcResponse(
        'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":4,"result":2}\n\n',
        "text/event-stream",
        4,
      ),
    ).toMatchObject({ result: 2 });
    expect(readRpcResponse("<html>", "text/html", 1)).toBeNull();
  });

  it("lists tools and sends the stored token only to that server", async () => {
    mocks.tokens.set("claims", "tok-123");
    serve([
      {
        name: "claims_by_postcode",
        description: "x",
        annotations: { readOnlyHint: true },
      },
      { name: "close_claim", description: "y" },
    ]);
    const listed = await listMcpServerTools("claims");
    expect(listed.serverName).toBe("claims-db");
    expect(listed.tools.map((t) => [t.name, t.readOnly])).toEqual([
      ["claims_by_postcode", true],
      ["close_claim", false],
    ]);
    for (const [url, request] of fetchMock.mock.calls) {
      expect(String(url)).toBe("https://mcp.example.com/mcp");
      expect((request?.headers as Record<string, string>).Authorization).toBe(
        "Bearer tok-123",
      );
    }
  });

  it("refuses tools the server does not mark read-only", async () => {
    serve([{ name: "close_claim", description: "y" }]);
    await expect(
      callMcpServerTool("claims", "close_claim", {}),
    ).rejects.toThrow("read-only");
    await expect(callMcpServerTool("claims", "missing", {})).rejects.toThrow(
      "does not offer",
    );
    await expect(callMcpServerTool("other", "x", {})).rejects.toThrow(
      "Unknown MCP server",
    );
    expect(
      fetchMock.mock.calls.some(([, request]) =>
        String(request?.body).includes('"tools/call"'),
      ),
    ).toBe(false);
  });

  it("makes no request at all without an enabled server", async () => {
    mocks.settings = {
      ...mocks.settings,
      mcpServers: [{ ...server, enabled: false }],
    };
    expect(await mcpChatLookup("Gab es Schäden?")).toEqual({
      results: "",
      used: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs only planned calls that match an offered read-only tool", async () => {
    fetchMock.mockImplementation(async (input, request) => {
      if (new URL(String(input)).hostname === "api.openai.com") {
        return llmReply({
          calls: [
            { server: "claims", tool: "close_claim", arguments: {} },
            {
              server: "claims",
              tool: "claims_by_postcode",
              arguments: { postcode: "80331" },
            },
          ],
        });
      }
      const sent = JSON.parse(String(request?.body)) as { method: string };
      const result =
        sent.method === "initialize"
          ? { protocolVersion: "2025-06-18" }
          : sent.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "claims_by_postcode",
                    description: "x",
                    annotations: { readOnlyHint: true },
                  },
                  { name: "close_claim", description: "y" },
                ],
              }
            : { content: [{ type: "text", text: "2 Hagelschäden 2024" }] };
      return rpcReply(result)(input, request);
    });
    const lookup = await mcpChatLookup("Gab es Hagelschäden in 80331?");
    expect(lookup.used).toEqual([
      { server: "Schäden", tool: "claims_by_postcode", ok: true },
    ]);
    expect(lookup.results).toContain("[external:Schäden/claims_by_postcode]");
    expect(lookup.results).toContain("2 Hagelschäden 2024");
  });
});
