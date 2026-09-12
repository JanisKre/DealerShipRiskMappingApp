import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PenLine, Trash2, Zap } from "lucide-react";
import type { HailstormScenario } from "@shared/types";
import { computeScenarioImpact } from "@shared/risk-math";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { eur, num } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";
import { INTENSITY_LEVELS } from "./HailstormScenarioLayer";

/**
 * Control panel for the hailstorm scenario: draw a corridor, adjust width
 * and intensity, compute impact live. The drawn path update comes from
 * HailstormScenarioLayer via the store.
 */
export function ScenarioBuilder({
  drawing,
  onToggleDraw,
}: Readonly<{
  drawing: boolean;
  onToggleDraw: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const scenario = useAppStore((s) => s.scenario);
  const parameters = useAppStore((s) => s.parameters);
  const setScenario = useAppStore((s) => s.setScenario);

  const impact = useMemo(
    () => (scenario ? computeScenarioImpact(scenario, dealerships, parameters) : null),
    [scenario, dealerships, parameters],
  );

  function patch(partial: Partial<HailstormScenario>): void {
    if (!scenario) return;
    setScenario({ ...scenario, ...partial });
  }

  return (
    <div className="glass w-full space-y-2.5 rounded-lg border p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Zap className="size-4" /> {t("map.scenario")}
        </h3>
        {scenario && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScenario(null)}
            title={t("ui.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <Button
        variant={drawing ? "default" : "outline"}
        size="sm"
        className="w-full"
        onClick={onToggleDraw}
      >
        <PenLine /> {drawing ? t("ui.finishDrawing") : t("ui.drawCorridor")}
      </Button>

      {drawing && (
        <p className="text-xs text-muted-foreground">{t("ui.drawingHint")}</p>
      )}

      {scenario && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="scenario-width">
              {t("ui.width")}: {num(scenario.widthKm)} km
            </Label>
            <Input
              id="scenario-width"
              type="number"
              min={1}
              max={100}
              value={scenario.widthKm}
              onChange={(e) =>
                patch({ widthKm: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("ui.intensity")}</Label>
            <Select
              value={scenario.intensityLevel}
              onValueChange={(v) =>
                patch({
                  intensityLevel: v as HailstormScenario["intensityLevel"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTENSITY_LEVELS.map((lvl) => (
                  <SelectItem key={lvl} value={lvl}>
                    {t(`risk.${lvl}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="scenario-return-period">
                {t("ui.returnPeriod")}
              </Label>
              <Select
                value={String(scenario.returnPeriodYears ?? 100)}
                onValueChange={(v) =>
                  patch({ returnPeriodYears: Number(v) as 10 | 50 | 100 })
                }
              >
                <SelectTrigger id="scenario-return-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 50, 100].map((years) => (
                    <SelectItem key={years} value={String(years)}>
                      {years} {t("ui.years")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scenario-exposure-multiplier">
                {t("ui.exposureMultiplier")}
              </Label>
              <Input
                id="scenario-exposure-multiplier"
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={scenario.exposureMultiplier ?? 1}
                onChange={(e) =>
                  patch({
                    exposureMultiplier: Math.max(
                      0.1,
                      Number(e.target.value) || 1,
                    ),
                  })
                }
              />
            </div>
          </div>

          {impact && (
            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("ui.affected")}
                </span>
                <span className="font-medium">
                  {impact.affectedDealershipIds.length}{" "}
                  {t("dashboard.locations")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("dashboard.totalExposure")}
                </span>
                <span className="font-medium">
                  {eur(impact.totalExposureEur)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("ui.expectedLoss")}
                </span>
                <span className="font-semibold text-destructive">
                  {eur(impact.estimatedLossEur)}
                </span>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                {t("ui.modelReturnPeriod", {
                  model: impact.modelVersion,
                  years: impact.scenario.returnPeriodYears ?? "—",
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
