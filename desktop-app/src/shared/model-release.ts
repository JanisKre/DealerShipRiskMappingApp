import { z } from "zod";
import releaseJson from "./model-release.json";

/**
 * The vehicle-detection model the app ships with: a GitHub release that holds
 * only the ONNX model and its manifest, pinned by tag and SHA-256. The release
 * build (`scripts/fetch-release-model.mjs`) bundles these files into the
 * installer; the installation wizard downloads the same files when a build
 * has no model (development builds). Pinning the hashes here means neither
 * path trusts whatever the release currently serves.
 *
 * To publish a new model: upload `dealer_vehicles.onnx` and
 * `dealer_vehicles.json` from `training/export/` to a new
 * `model-dealer-vehicles-<version>` release (not marked latest), then update
 * the tag and both hashes in `model-release.json`. See
 * docs/detection-benchmark.md, "Shipped model".
 */

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ModelReleaseSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  tag: z.string().regex(/^model-[a-z0-9._-]+$/),
  files: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9_]+\.(onnx|json)$/),
        sha256: Sha256,
      }),
    )
    .refine(
      (files) =>
        files.filter((f) => f.name.endsWith(".onnx")).length === 1 &&
        files.filter((f) => f.name.endsWith(".json")).length === 1,
      "a model release holds exactly one .onnx and one .json manifest",
    ),
});
export type ModelRelease = z.infer<typeof ModelReleaseSchema>;

export const MODEL_RELEASE: ModelRelease =
  ModelReleaseSchema.parse(releaseJson);

export function modelReleaseFile(
  release: ModelRelease,
  extension: "onnx" | "json",
): ModelRelease["files"][number] {
  const file = release.files.find((f) => f.name.endsWith(`.${extension}`));
  if (!file) throw new Error(`model release has no .${extension} file`);
  return file;
}

export function modelReleaseUrl(release: ModelRelease, name: string): string {
  return `https://github.com/${release.repository}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(name)}`;
}
