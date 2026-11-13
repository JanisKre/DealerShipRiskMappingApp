import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ScanSearch } from "lucide-react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { ModelInstallWizard } from "@renderer/components/model/ModelInstallWizard";

/**
 * Status of the local vehicle detection model, with the way to install it
 * after the first-run prompt was closed or dismissed for good.
 */
export function DetectionModelCard(): React.JSX.Element {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.modelStatus();
      setAvailable(status.available);
    } catch (err) {
      console.warn("Model status unavailable:", err);
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {t("settings.detectionModel.title")}
          </CardTitle>
          {available !== undefined && (
            <Badge variant={available ? "outline" : "warning"}>
              {available
                ? t("settings.detectionModel.badgeInstalled")
                : t("settings.detectionModel.badgeMissing")}
            </Badge>
          )}
        </div>
        <CardDescription>
          {t("settings.detectionModel.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {available !== undefined && (
          <p className={available ? "" : "text-muted-foreground"}>
            {available
              ? t("settings.detectionModel.installed")
              : t("settings.detectionModel.missing")}
          </p>
        )}
        <Button
          variant={available === false ? "default" : "outline"}
          size="sm"
          onClick={() => setWizardOpen(true)}
        >
          {available === false ? (
            <Download className="size-3" />
          ) : (
            <ScanSearch className="size-3" />
          )}
          {available === false
            ? t("settings.detectionModel.install")
            : t("settings.detectionModel.manage")}
        </Button>
      </CardContent>
      <ModelInstallWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) void refresh();
        }}
      />
    </Card>
  );
}
