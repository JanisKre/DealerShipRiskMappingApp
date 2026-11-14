import { createHash } from "crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_RELEASE, type ModelRelease } from "@shared/model-release";

const fetchMock = vi.fn();
const resetDetectorMock = vi.fn();

vi.mock("./http.service", () => ({
  fetchWithResilience: (...args: unknown[]) => fetchMock(...args),
}));
vi.mock("./detection.service", () => ({
  modelsDir: () => "/unused",
  resetDetector: () => resetDetectorMock(),
}));

const { downloadModel, MODEL_DOWNLOAD_URL, MODEL_INSTALL_FILENAME } =
  await import("./model.service");

const sha = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

const onnxBytes = Buffer.from("fake onnx model bytes");
function manifestFor(onnxSha: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    name: "dealer_vehicles",
    version: "test",
    task: "obb",
    imgsz: 640,
    gsdM: 0.1,
    classes: { "0": "car" },
    vehicleClasses: { "0": "car" },
    sha256: onnxSha,
  });
}

function releaseFor(manifest: string, onnx: Buffer): ModelRelease {
  return {
    repository: "owner/repo",
    tag: "model-test-1",
    files: [
      { name: "dealer_vehicles.json", sha256: sha(manifest) },
      { name: "dealer_vehicles.onnx", sha256: sha(onnx) },
    ],
  };
}

function serve(files: Record<string, Buffer | string>): void {
  fetchMock.mockImplementation((url: string) => {
    const name = decodeURIComponent(url.split("/").pop() ?? "");
    const body = files[name];
    return Promise.resolve(
      body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(typeof body === "string" ? body : new Uint8Array(body), {
            headers: { "content-length": String(Buffer.byteLength(body)) },
          }),
    );
  });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "model-download-"));
  fetchMock.mockReset();
  resetDetectorMock.mockReset();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("model release pin", () => {
  it("downloads the fine-tuned model from a pinned, non-latest release", () => {
    expect(MODEL_INSTALL_FILENAME).toBe("dealer_vehicles.onnx");
    expect(MODEL_DOWNLOAD_URL).toBe(
      `https://github.com/JanisKre/DealerShipRiskMappingApp/releases/download/${MODEL_RELEASE.tag}/dealer_vehicles.onnx`,
    );
    expect(MODEL_DOWNLOAD_URL).not.toContain("/latest/");
  });
});

describe("downloadModel", () => {
  it("installs model and manifest after both checksums match", async () => {
    const manifest = manifestFor(sha(onnxBytes));
    serve({
      "dealer_vehicles.json": manifest,
      "dealer_vehicles.onnx": onnxBytes,
    });
    const progress = vi.fn();

    await downloadModel(
      progress,
      new AbortController().signal,
      releaseFor(manifest, onnxBytes),
      dir,
    );

    expect(readFileSync(join(dir, "dealer_vehicles.onnx"))).toEqual(onnxBytes);
    expect(readFileSync(join(dir, "dealer_vehicles.json"), "utf8")).toBe(
      manifest,
    );
    expect(progress).toHaveBeenLastCalledWith(
      onnxBytes.length,
      onnxBytes.length,
    );
    expect(resetDetectorMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://github.com/owner/repo/releases/download/model-test-1/dealer_vehicles.json",
    );
  });

  it("rejects a model whose bytes differ from the pinned hash and leaves nothing behind", async () => {
    const manifest = manifestFor(sha(onnxBytes));
    serve({
      "dealer_vehicles.json": manifest,
      "dealer_vehicles.onnx": Buffer.from("tampered"),
    });

    await expect(
      downloadModel(
        vi.fn(),
        new AbortController().signal,
        releaseFor(manifest, onnxBytes),
        dir,
      ),
    ).rejects.toThrow(/pinned checksum/);
    expect(readdirSync(dir)).toEqual([]);
    expect(resetDetectorMock).not.toHaveBeenCalled();
  });

  it("rejects a manifest that describes a different model", async () => {
    const manifest = manifestFor(sha("another model"));
    serve({
      "dealer_vehicles.json": manifest,
      "dealer_vehicles.onnx": onnxBytes,
    });

    await expect(
      downloadModel(
        vi.fn(),
        new AbortController().signal,
        releaseFor(manifest, onnxBytes),
        dir,
      ),
    ).rejects.toThrow(/does not describe the pinned model/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reports a missing release asset as a failed download", async () => {
    const manifest = manifestFor(sha(onnxBytes));
    serve({ "dealer_vehicles.json": manifest });

    await expect(
      downloadModel(
        vi.fn(),
        new AbortController().signal,
        releaseFor(manifest, onnxBytes),
        dir,
      ),
    ).rejects.toThrow(/HTTP 404/);
    expect(existsSync(join(dir, "dealer_vehicles.onnx"))).toBe(false);
    expect(existsSync(join(dir, "dealer_vehicles.json"))).toBe(false);
  });
});
