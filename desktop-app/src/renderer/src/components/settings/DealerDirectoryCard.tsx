import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Database, Download, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Progress } from "@renderer/components/ui/progress";
import { useDealerDirectoryStore } from "@renderer/store/dealerDirectoryStore";

/**
 * Downloads and refreshes the local Overture Maps car-dealer directory that
 * backs the location search next to OSM.
 */
export function DealerDirectoryCard(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const {
    status,
    running,
    progress,
    error,
    loadStatus,
    startRefresh,
    cancelRefresh,
  } = useDealerDirectoryStore();

  useEffect(() => {
    if (status === undefined) void loadStatus();
  }, [status, loadStatus]);

  const number = new Intl.NumberFormat(i18n.language);
  const pct =
    progress && progress.totalRowGroups > 0
      ? Math.round((progress.doneRowGroups / progress.totalRowGroups) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-4" />
          {t("settings.dealerDirectory.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.dealerDirectory.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className={status ? "" : "text-muted-foreground"}>
          {status
            ? t("settings.dealerDirectory.loaded", {
                total: number.format(status.count),
                release: status.release,
                date: new Date(status.retrievedAt).toLocaleDateString(
                  i18n.language,
                ),
              })
            : t("settings.dealerDirectory.notLoaded")}
        </p>

        {running ? (
          <div className="space-y-2">
            <Progress value={pct} />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {!progress || progress.phase === "discover"
                  ? t("settings.dealerDirectory.discovering")
                  : t("settings.dealerDirectory.reading", {
                      pct,
                      found: number.format(progress.found),
                    })}
              </span>
              <Button size="sm" variant="ghost" onClick={cancelRefresh}>
                <X className="size-3" />
                {t("settings.dealerDirectory.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={startRefresh}>
            {status ? (
              <RefreshCw className="size-3" />
            ) : (
              <Download className="size-3" />
            )}
            {status
              ? t("settings.dealerDirectory.refresh")
              : t("settings.dealerDirectory.download")}
          </Button>
        )}
        {running && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t("settings.dealerDirectory.backgroundHint")}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">
          {t("settings.dealerDirectory.attribution")}
        </p>
      </CardContent>
    </Card>
  );
}
