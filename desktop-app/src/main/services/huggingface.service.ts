import { z } from "zod";
import type {
  HfModelFiles,
  HfModelSort,
  HfModelSummary,
} from "@shared/ipc-schema";
import { ggufQuantFromFilename, HF_REPO_ID_PATTERN } from "@shared/llm-config";
import { fetchWithResilience } from "./http.service";

/**
 * Read-only Hugging Face Hub discovery for local models. Queries the public
 * Hub API at runtime, so the list always shows the current models without an
 * app update. Only the search text leaves the device; no key is sent.
 */

const HF_API = "https://huggingface.co/api/models";
const SEARCH_LIMIT = 25;

const SORT_FIELD: Record<HfModelSort, string> = {
  trending: "trendingScore",
  downloads: "downloads",
  likes: "likes",
};

const SearchResponseSchema = z.array(
  z.object({
    id: z.string(),
    downloads: z.number().optional(),
    likes: z.number().optional(),
    createdAt: z.string().optional(),
    private: z.boolean().optional(),
  }),
);

const ModelInfoSchema = z.object({
  id: z.string(),
  // false, or the gating mode ("auto" / "manual")
  gated: z.union([z.boolean(), z.string()]).optional(),
  gguf: z
    .object({
      total: z.number().optional(),
      context_length: z.number().optional(),
    })
    .optional(),
  siblings: z
    .array(z.object({ rfilename: z.string(), size: z.number().optional() }))
    .optional(),
});

/** GGUF text-generation repositories, sorted by the chosen Hub metric. */
export async function searchGgufModels(
  query: string,
  sort: HfModelSort,
): Promise<HfModelSummary[]> {
  const params = new URLSearchParams({
    filter: "gguf",
    pipeline_tag: "text-generation",
    sort: SORT_FIELD[sort],
    direction: "-1",
    limit: String(SEARCH_LIMIT),
  });
  if (query) params.set("search", query);
  const res = await fetchWithResilience(`${HF_API}?${params.toString()}`);
  if (!res.ok) throw new Error(`Hugging Face ${res.status}`);
  const models = SearchResponseSchema.parse(await res.json());
  return models
    .filter((m) => !m.private && HF_REPO_ID_PATTERN.test(m.id))
    .map((m) => ({
      id: m.id,
      downloads: m.downloads ?? 0,
      likes: m.likes ?? 0,
      createdAt: m.createdAt,
    }));
}

/** Single-file GGUF quantizations of a repository, smallest first. */
export async function getGgufFiles(repoId: string): Promise<HfModelFiles> {
  if (!HF_REPO_ID_PATTERN.test(repoId)) {
    throw new Error("Invalid Hugging Face repository ID");
  }
  const path = repoId.split("/").map(encodeURIComponent).join("/");
  const res = await fetchWithResilience(`${HF_API}/${path}?blobs=true`);
  if (!res.ok) throw new Error(`Hugging Face ${res.status}`);
  const info = ModelInfoSchema.parse(await res.json());

  const seen = new Set<string>();
  const quants: HfModelFiles["quants"] = [];
  for (const file of info.siblings ?? []) {
    const tag = ggufQuantFromFilename(file.rfilename);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    quants.push({ tag, file: file.rfilename, sizeBytes: file.size });
  }
  quants.sort(
    (a, b) =>
      (a.sizeBytes ?? Number.MAX_SAFE_INTEGER) -
      (b.sizeBytes ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    repoId,
    gated: Boolean(info.gated),
    parameters: info.gguf?.total,
    contextLength: info.gguf?.context_length,
    quants,
  };
}
