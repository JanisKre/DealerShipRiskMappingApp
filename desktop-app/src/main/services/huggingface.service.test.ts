import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGgufFiles, searchGgufModels } from "./huggingface.service";

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("Hugging Face discovery", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("searches GGUF text-generation models live, sorted by the Hub metric", async () => {
    fetchMock.mockResolvedValueOnce(
      json([
        { id: "owner/Model-GGUF", downloads: 10, likes: 2 },
        { id: "owner/private-GGUF", private: true },
      ]),
    );

    const result = await searchGgufModels("qwen", "trending");

    expect(result).toEqual([
      { id: "owner/Model-GGUF", downloads: 10, likes: 2, createdAt: undefined },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin).toBe("https://huggingface.co");
    expect(url.searchParams.get("filter")).toBe("gguf");
    expect(url.searchParams.get("pipeline_tag")).toBe("text-generation");
    expect(url.searchParams.get("sort")).toBe("trendingScore");
    expect(url.searchParams.get("search")).toBe("qwen");
  });

  it("lists pullable quantizations smallest first", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: "owner/Model-GGUF",
        gated: false,
        gguf: { total: 3_000_000_000, context_length: 131072 },
        siblings: [
          { rfilename: "README.md", size: 1 },
          { rfilename: "Model-Q8_0.gguf", size: 3_000 },
          { rfilename: "Model-Q4_K_M.gguf", size: 2_000 },
          { rfilename: "Model-F16-00001-of-00002.gguf", size: 5_000 },
        ],
      }),
    );

    const info = await getGgufFiles("owner/Model-GGUF");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://huggingface.co/api/models/owner/Model-GGUF?blobs=true",
    );
    expect(info).toEqual({
      repoId: "owner/Model-GGUF",
      gated: false,
      parameters: 3_000_000_000,
      contextLength: 131072,
      quants: [
        { tag: "Q4_K_M", file: "Model-Q4_K_M.gguf", sizeBytes: 2_000 },
        { tag: "Q8_0", file: "Model-Q8_0.gguf", sizeBytes: 3_000 },
      ],
    });
  });

  it("rejects malformed repository IDs before fetching", async () => {
    await expect(getGgufFiles("../whoami")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
