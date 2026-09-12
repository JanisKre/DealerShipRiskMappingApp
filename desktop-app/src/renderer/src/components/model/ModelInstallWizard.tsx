import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ModelDownloadChunk } from "@shared/ipc-schema";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Progress } from "@renderer/components/ui/progress";

type Phase = "idle" | "downloading" | "done" | "error" | "unavailable";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Install wizard for the vehicle-detection model: checks on startup whether
 * an ONNX file is present, and otherwise offers a download (or — if no
 * download source is (yet) configured — manual instructions with the exact
 * target path. Can be permanently dismissed once in settings.
 */
export function ModelInstallWizard(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [installDir, setInstallDir] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{
    received: number;
    total: number | null;
  }>({ received: 0, total: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check(): Promise<void> {
      const settings = await window.api.getSettings();
      if (settings.modelWizardDismissed) return;
      const status = await window.api.modelStatus();
      if (cancelled || status.available) return;
      setInstallDir(status.installDir);
      setPhase(status.downloadConfigured ? "idle" : "unavailable");
      setOpen(true);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  function startDownload(): void {
    setPhase("downloading");
    setError(null);
    window.api.downloadModel((chunk: ModelDownloadChunk) => {
      if (chunk.type === "progress") {
        setProgress({ received: chunk.receivedBytes, total: chunk.totalBytes });
      } else if (chunk.type === "done") {
        setPhase("done");
      } else if (chunk.type === "unavailable") {
        setPhase("unavailable");
      } else if (chunk.type === "error") {
        setPhase("error");
        setError(chunk.message);
      }
    });
  }

  async function dismissForever(): Promise<void> {
    await window.api.setSettings({ modelWizardDismissed: true });
    setOpen(false);
  }

  const pct =
    progress.total != null && progress.total > 0
      ? Math.round((progress.received / progress.total) * 100)
      : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && phase !== "downloading") setOpen(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install vehicle-detection model</DialogTitle>
          <DialogDescription>
            Without this model, the app only roughly estimates vehicle
            counts from the lot area instead of detecting them with AI on
            the aerial imagery.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" && (
          <p className="text-sm text-muted-foreground">
            The model (YOLOv26s, approx. 36&nbsp;MB) will be downloaded once
            and stored locally.
          </p>
        )}

        {phase === "downloading" && (
          <div className="space-y-2">
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">
              {mb(progress.received)}
              {progress.total != null && ` / ${mb(progress.total)}`}
            </p>
          </div>
        )}

        {phase === "done" && (
          <p className="text-sm text-emerald-600">
            Model installed — real AI vehicle detection is now active.
          </p>
        )}

        {phase === "error" && (
          <p className="text-sm text-destructive">
            Download failed: {error}
          </p>
        )}

        {phase === "unavailable" && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Automatic download is not yet set up. Please place the model
              file here manually:
            </p>
            <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">
              {installDir}
            </code>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => void dismissForever()}>
            Don't show again
          </Button>
          {(phase === "idle" || phase === "error") && (
            <Button size="sm" onClick={startDownload}>
              <Download className="size-4" />
              Download now
            </Button>
          )}
          {(phase === "done" || phase === "unavailable") && (
            <Button size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          )}
          {phase === "downloading" && (
            <Button size="sm" disabled>
              <Loader2 className="size-4 animate-spin" />
              Downloading…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
