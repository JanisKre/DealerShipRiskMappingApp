import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  ExternalLink,
  FileDown,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { UpdateStatus } from "@shared/ipc-schema";
import type { Settings } from "@shared/types";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Progress } from "@renderer/components/ui/progress";
import { Switch } from "@renderer/components/ui/switch";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The operation could not be completed.";
}

/** Live update status: initial value from main, then pushed changes. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.api
      .updateStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {});
    const unsubscribe = window.api.onUpdateStatus(setStatus);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return status;
}

/**
 * App version and updates, the support diagnostics export and "delete all
 * data" — the maintenance actions an administrator or support desk needs.
 */
export function AppSupportCard({
  settings,
  onUpdateSettings,
}: Readonly<{
  settings: Settings;
  onUpdateSettings: (partial: Partial<Settings>) => Promise<void>;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const status = useUpdateStatus();
  const [exporting, setExporting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const supported = status !== null && status.state !== "unsupported";
  const busy = status?.state === "checking" || status?.state === "downloading";

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setExporting(true);
    try {
      const { path } = await window.api.exportDiagnostics();
      if (path) toast.success(t("settings.support.diagnosticsSaved", { path }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  async function resetAllData(): Promise<void> {
    setResetting(true);
    try {
      await window.api.resetAllData();
      // The app restarts; nothing else to do here.
    } catch (error) {
      setResetting(false);
      toast.error(errorMessage(error));
    }
  }

  function statusText(): string {
    if (!status) return "";
    switch (status.state) {
      case "unsupported":
        return t("settings.support.update.unsupported");
      case "checking":
        return t("settings.support.update.checking");
      case "up-to-date":
        return t("settings.support.update.upToDate", {
          date: status.checkedAt
            ? new Date(status.checkedAt).toLocaleString(i18n.language)
            : "",
        });
      case "available":
        return status.canAutoInstall
          ? t("settings.support.update.availableInstall", {
              version: status.latestVersion,
            })
          : t("settings.support.update.availableManual", {
              version: status.latestVersion,
            });
      case "downloading":
        return t("settings.support.update.downloading", {
          pct: Math.round((status.progress ?? 0) * 100),
        });
      case "ready":
        return t("settings.support.update.ready", {
          version: status.latestVersion,
        });
      case "error":
        return t("settings.support.update.error", {
          message: status.message ?? "",
        });
      default:
        return t("settings.support.update.idle");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {t("settings.support.title")}
          </CardTitle>
          {/* Build version, as in the sidebar: app.getVersion() reads the
              Electron version when started unpackaged from out/. */}
          <Badge variant="outline">
            {t("settings.support.version", { version: __APP_VERSION__ })}
          </Badge>
        </div>
        <CardDescription>{t("settings.support.description")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y text-sm">
        <div className="space-y-3 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium" id="auto-update-label">
                {t("settings.support.update.autoCheck")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.support.update.autoCheckHint")}
              </p>
            </div>
            <Switch
              aria-labelledby="auto-update-label"
              checked={settings.autoUpdateCheck !== false}
              disabled={!supported}
              onCheckedChange={(checked) =>
                void onUpdateSettings({ autoUpdateCheck: checked })
              }
            />
          </div>

          <p
            role="status"
            className={
              status?.state === "error"
                ? "text-xs text-destructive"
                : status?.state === "available" || status?.state === "ready"
                  ? "text-xs font-medium"
                  : "text-xs text-muted-foreground"
            }
          >
            {statusText()}
          </p>
          {status?.state === "downloading" && (
            <Progress
              value={Math.round((status.progress ?? 0) * 100)}
              aria-label={t("settings.support.update.progressLabel")}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!supported || busy || status?.state === "ready"}
              onClick={() => void run(() => window.api.checkForUpdates())}
            >
              {status?.state === "checking" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              {t("settings.support.update.checkNow")}
            </Button>
            {status?.state === "available" && status.canAutoInstall && (
              <Button
                size="sm"
                onClick={() => void run(() => window.api.downloadUpdate())}
              >
                <Download className="size-3" />
                {t("settings.support.update.download")}
              </Button>
            )}
            {status?.state === "available" &&
              !status.canAutoInstall &&
              status.releaseUrl && (
                <Button size="sm" asChild>
                  <a href={status.releaseUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3" />
                    {t("settings.support.update.openRelease")}
                  </a>
                </Button>
              )}
            {status?.state === "ready" && (
              <Button
                size="sm"
                onClick={() => void run(() => window.api.installUpdate())}
              >
                <RotateCcw className="size-3" />
                {t("settings.support.update.restart")}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <p className="font-medium">
              {t("settings.support.diagnostics.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.support.diagnostics.hint")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={() => void exportDiagnostics()}
          >
            {exporting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <FileDown className="size-3" />
            )}
            {t("settings.support.diagnostics.export")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <div className="min-w-0">
            <p className="font-medium">{t("settings.support.reset.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("settings.support.reset.hint")}
            </p>
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmReset(true)}
          >
            <Trash2 className="size-3" />
            {t("settings.support.reset.button")}
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={confirmReset}
        onOpenChange={(open) => !resetting && setConfirmReset(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.support.reset.confirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.support.reset.confirmText")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={resetting}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={resetting}
              onClick={() => void resetAllData()}
            >
              {resetting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
              {t("settings.support.reset.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
