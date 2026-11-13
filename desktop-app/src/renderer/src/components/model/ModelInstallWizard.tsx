import { useEffect, useRef, useState } from "react";
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
import { useAppStore } from "@renderer/store/appStore";

type Phase =
  "ready" | "idle" | "downloading" | "done" | "error" | "unavailable";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Installation wizard for the vehicle detection model.
 *
 * Without props it is the first-run prompt: shown once per installation, but
 * only after the first portfolio has analysed sites — a dialog about vehicle
 * detection means nothing on an empty start screen. With `open` it is opened
 * from Settings → Data sources ("Fahrzeugerkennung"), any number of times.
 */
export function ModelInstallWizard({
  open: controlledOpen,
  onOpenChange,
}: Readonly<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}> = {}): React.JSX.Element | null {
  const { t } = useTranslation();
  const controlled = controlledOpen !== undefined;
  const [autoOpen, setAutoOpen] = useState(false);
  const open = controlled ? controlledOpen : autoOpen;
  const setOpen = (next: boolean): void => {
    if (controlled) onOpenChange?.(next);
    else setAutoOpen(next);
  };
  const hasSites = useAppStore((s) => s.dealerships.length > 0 && !s.analyzing);
  const autoChecked = useRef(false);
  const [installDir, setInstallDir] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{
    received: number;
    total: number | null;
  }>({ received: 0, total: null });
  const [error, setError] = useState<string | null>(null);

  async function loadStatus(): Promise<boolean> {
    const status = await window.api.modelStatus();
    setInstallDir(status.installDir);
    setPhase(
      status.available
        ? "ready"
        : status.downloadConfigured
          ? "idle"
          : "unavailable",
    );
    return status.available;
  }

  // First-run prompt: once, when there are analysed sites to improve.
  useEffect(() => {
    if (controlled || !hasSites || autoChecked.current) return;
    autoChecked.current = true;
    let cancelled = false;
    async function check(): Promise<void> {
      const settings = await window.api.getSettings();
      if (settings.setupWizardCompleted || settings.modelWizardDismissed)
        return;
      await loadStatus();
      if (!cancelled) setAutoOpen(true);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [controlled, hasSites]);

  // Opened from Settings: show the current state, never a stale "done".
  useEffect(() => {
    if (!controlled || !controlledOpen) return;
    setError(null);
    setProgress({ received: 0, total: null });
    void loadStatus();
  }, [controlled, controlledOpen]);

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
          <p className="text-sm text-success">{t("model.ready")}</p>
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
          <p className="text-sm text-success">{t("model.done")}</p>
        )}

        {phase === "error" && (
          <p className="text-sm text-destructive">
            {t("model.downloadFailed", { error })}
          </p>
        )}

        <DialogFooter className="gap-2">
          {/* "Don't show again" only belongs to the first-run prompt. */}
          {!controlled && (
            <Button
              variant="ghost"
              size="sm"
              className="sm:mr-auto"
              onClick={() => void dismissForever()}
            >
              {t("model.dismiss")}
            </Button>
          )}
          {(phase === "idle" || phase === "error") && (
            <Button size="sm" autoFocus onClick={startDownload}>
              <Download className="size-4" />
              {t("model.downloadNow")}
            </Button>
          )}
          {(phase === "ready" ||
            phase === "done" ||
            phase === "unavailable") && (
            <Button size="sm" autoFocus onClick={() => void finish()}>
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
