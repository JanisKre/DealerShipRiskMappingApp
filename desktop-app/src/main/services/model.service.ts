import { createWriteStream } from "fs";
import { mkdir, rename, unlink } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { MODEL_FILENAME, modelsDir, resetDetector } from "./detection.service";

/**
 * Download source of the vehicle detection model for the installation wizard.
 * The model is published as a release asset so it is downloaded outside the
 * application bundle and survives app updates.
 */
export const MODEL_DOWNLOAD_URL =
  "https://github.com/JanisKre/DealerShipRiskMappingApp/releases/latest/download/yolov26s_aerial_vehicles.onnx";

/** Thrown when no download is configured (→ IPC reports `unavailable`). */
export class ModelDownloadUnavailableError extends Error {
  constructor() {
    super("No download source configured for the model.");
    this.name = "ModelDownloadUnavailableError";
  }
}

/**
 * Downloads the ONNX model into `userData/models/` (survives app updates,
 * unlike `resources/` in the app bundle). Writes to a temp file and only
 * renames it after success — an abort therefore never leaves a broken
 * file that's recognized as "present".
 */
export async function downloadModel(
  onProgress: (receivedBytes: number, totalBytes: number | null) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!MODEL_DOWNLOAD_URL) throw new ModelDownloadUnavailableError();

  const dir = modelsDir();
  await mkdir(dir, { recursive: true });
  const finalPath = join(dir, MODEL_FILENAME);
  const tmpPath = `${finalPath}.download`;

  const res = await fetch(MODEL_DOWNLOAD_URL, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const totalBytes = Number(res.headers.get("content-length")) || null;
  let receivedBytes = 0;

  const nodeStream = Readable.fromWeb(
    res.body as unknown as import("stream/web").ReadableStream,
  );
  nodeStream.on("data", (chunk: Buffer) => {
    receivedBytes += chunk.length;
    onProgress(receivedBytes, totalBytes);
  });

  try {
    await pipeline(nodeStream, createWriteStream(tmpPath), { signal });
    await rename(tmpPath, finalPath);
    resetDetector();
  } catch (err) {
    await unlink(tmpPath).catch(() => {
      // Temp file doesn't exist or couldn't be removed — doesn't matter.
    });
    throw err;
  }
}
