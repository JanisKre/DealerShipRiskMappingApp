import {
  extractGermanDealers,
  type ExtractProgress,
  type ExtractResult,
} from "../services/dealer-directory/overture-dealers";

/**
 * Overture dealer extraction in an Electron utilityProcess: zstd-decompressing
 * a few hundred MB of GeoParquet in pure JS would otherwise block the main
 * process (and with it every IPC call) for minutes.
 *
 *   → { type: 'start' }
 *   ← { type: 'progress', progress } | { type: 'result', result } | { type: 'error', error }
 *
 * The parent kills the process to cancel.
 */
type WorkerMessage =
  | { type: "progress"; progress: ExtractProgress }
  | { type: "result"; result: ExtractResult }
  | { type: "error"; error: string };

const port = process.parentPort;

function post(message: WorkerMessage): void {
  port.postMessage(message);
}

port.on("message", (event: { data: unknown }) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type !== "start") return;
  extractGermanDealers({
    onProgress: (progress) => post({ type: "progress", progress }),
  })
    .then((result) => post({ type: "result", result }))
    .catch((err: unknown) =>
      post({
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
});
