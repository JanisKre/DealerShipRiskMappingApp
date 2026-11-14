import { createHash } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, readFile, rename, unlink } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { parseVehicleModelManifest } from "@shared/model-manifest";
import {
  MODEL_RELEASE,
  modelReleaseFile,
  modelReleaseUrl,
  type ModelRelease,
} from "@shared/model-release";
import { modelsDir, resetDetector } from "./detection.service";
import { fetchWithResilience } from "./http.service";

/**
 * Download source of the vehicle detection model for the installation wizard:
 * the pinned model release (see @shared/model-release). Release builds bundle
 * the same files, so the wizard only downloads in builds without a model.
 * The files land in `userData/models/`, which survives app updates.
 */
export const MODEL_DOWNLOAD_URL = modelReleaseUrl(
  MODEL_RELEASE,
  modelReleaseFile(MODEL_RELEASE, "onnx").name,
);

/** Filename the wizard installs the model under. */
export const MODEL_INSTALL_FILENAME = modelReleaseFile(
  MODEL_RELEASE,
  "onnx",
).name;

/** Thrown when no download is configured (→ IPC reports `unavailable`). */
export class ModelDownloadUnavailableError extends Error {
  constructor() {
    super("No download source configured for the model.");
    this.name = "ModelDownloadUnavailableError";
  }
}

/**
 * Downloads the model and its manifest into `userData/models/`. Both files
 * are written to temp files and checked against the SHA-256 pinned in the
 * app; the manifest must also parse and name the same ONNX hash. Only then
 * are they renamed into place, manifest first, so an abort never leaves a
 * model that's recognized as "present" without its manifest.
 */
export async function downloadModel(
  onProgress: (receivedBytes: number, totalBytes: number | null) => void,
  signal: AbortSignal,
  release: ModelRelease = MODEL_RELEASE,
  targetDir: string = modelsDir(),
): Promise<void> {
  const onnx = modelReleaseFile(release, "onnx");
  const manifest = modelReleaseFile(release, "json");

  await mkdir(targetDir, { recursive: true });
  const onnxPath = join(targetDir, onnx.name);
  const manifestPath = join(targetDir, manifest.name);
  const onnxTmp = `${onnxPath}.download`;
  const manifestTmp = `${manifestPath}.download`;

  try {
    await downloadTo(
      modelReleaseUrl(release, manifest.name),
      manifestTmp,
      signal,
      30_000,
    );
    await verifySha256(manifestTmp, manifest.sha256, manifest.name);
    const parsed = parseVehicleModelManifest(
      JSON.parse(await readFile(manifestTmp, "utf8")),
    );
    if (!parsed || parsed.sha256 !== onnx.sha256) {
      throw new Error("Model manifest does not describe the pinned model");
    }

    await downloadTo(
      modelReleaseUrl(release, onnx.name),
      onnxTmp,
      signal,
      120_000,
      onProgress,
    );
    await verifySha256(onnxTmp, onnx.sha256, onnx.name);

    await rename(manifestTmp, manifestPath);
    await rename(onnxTmp, onnxPath);
    resetDetector();
  } catch (err) {
    for (const tmp of [onnxTmp, manifestTmp]) {
      await unlink(tmp).catch(() => {
        // Temp file doesn't exist or couldn't be removed — doesn't matter.
      });
    }
    throw err;
  }
}

async function downloadTo(
  url: string,
  path: string,
  signal: AbortSignal,
  timeoutMs: number,
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<void> {
  const res = await fetchWithResilience(
    url,
    { signal },
    { retries: 0, timeoutMs },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const totalBytes = Number(res.headers.get("content-length")) || null;
  let receivedBytes = 0;
  const nodeStream = Readable.fromWeb(
    res.body as unknown as import("stream/web").ReadableStream,
  );
  if (onProgress) {
    nodeStream.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      onProgress(receivedBytes, totalBytes);
    });
  }
  await pipeline(nodeStream, createWriteStream(path), { signal });
}

async function verifySha256(
  path: string,
  expected: string,
  name: string,
): Promise<void> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  if (hash.digest("hex") !== expected) {
    throw new Error(`Downloaded ${name} does not match its pinned checksum`);
  }
}
