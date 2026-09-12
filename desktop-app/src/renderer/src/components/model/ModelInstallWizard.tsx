import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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

type Phase =
  | "ready"
  | "idle"
  | "downloading"
  | "done"
  | "error"
  | "unavailable";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * First-run installation wizard for local AI prerequisites. It is shown once
 * for every new installation, even when the model is already bundled, and
 * offers the model download when it is missing.
 */
export function ModelInstallWizard(): React.JSX.Element | null {
  const { t } = useTranslation();
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
      if (settings.setupWizardCompleted || settings.modelWizardDismissed)
        return;
      const status = await window.api.modelStatus();
      if (cancelled) return;
      setInstallDir(status.installDir);
      setPhase(
        status.available
          ? "ready"
          : status.downloadConfigured
            ? "idle"
            : "unavailable",
      );
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
    await window.api.setSettings({
      modelWizardDismissed: true,
      setupWizardCompleted: true,
    });
    setOpen(false);
  }

  async function finish(): Promise<void> {
    await window.api.setSettings({ setupWizardCompleted: true });
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
          <DialogTitle>{t("model.title")}</DialogTitle>
          <DialogDescription>{t("model.description")}</DialogDescription>
        </DialogHeader>

        {phase === "ready" && (
          <p className="text-sm text-emerald-600">{t("model.ready")}</p>
        )}

        {(phase === "idle" || phase === "unavailable") && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("model.idle")}</p>
            {phase === "unavailable" && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("model.unavailable")}
                </p>
                <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">
                  {installDir}
                </code>
              </>
            )}
          </div>
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
          <p className="text-sm text-emerald-600">{t("model.done")}</p>
        )}

        {phase === "error" && (
          <p className="text-sm text-destructive">
            {t("model.downloadFailed", { error })}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void dismissForever()}
          >
            {t("model.dismiss")}
          </Button>
          {(phase === "idle" || phase === "error") && (
            <Button size="sm" onClick={startDownload}>
              <Download className="size-4" />
              {t("model.downloadNow")}
            </Button>
          )}
          {(phase === "ready" ||
            phase === "done" ||
            phase === "unavailable") && (
            <Button size="sm" onClick={() => void finish()}>
              {phase === "unavailable"
                ? t("common.close")
                : t("model.continue")}
            </Button>
          )}
          {phase === "downloading" && (
            <Button size="sm" disabled>
              <Loader2 className="size-4 animate-spin" />
              {t("model.downloading")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
