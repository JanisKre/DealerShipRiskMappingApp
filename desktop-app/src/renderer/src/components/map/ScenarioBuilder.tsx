import { useMemo } from "react";
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

const INTENSITY_LABEL: Record<HailstormScenario["intensityLevel"], string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  EXTREME: "Extreme",
};

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
  const dealerships = useAppStore((s) => s.dealerships);
  const scenario = useAppStore((s) => s.scenario);
  const setScenario = useAppStore((s) => s.setScenario);

  const impact = useMemo(
    () => (scenario ? computeScenarioImpact(scenario, dealerships) : null),
    [scenario, dealerships],
  );

  function patch(partial: Partial<HailstormScenario>): void {
    if (!scenario) return;
    setScenario({ ...scenario, ...partial });
  }

  return (
    <div className="glass w-full space-y-2.5 rounded-lg border p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Zap className="size-4" /> Hailstorm scenario
        </h3>
        {scenario && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScenario(null)}
            title="Delete"
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
        <PenLine /> {drawing ? "Finish drawing" : "Draw corridor"}
      </Button>

      {drawing && (
        <p className="text-xs text-muted-foreground">
          Click waypoints on the map; double-click finishes the path.
        </p>
      )}

      {scenario && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="scenario-width">
              Width: {num(scenario.widthKm)} km
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
            <Label>Intensity</Label>
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
                    {INTENSITY_LABEL[lvl]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="scenario-return-period">Return period</Label>
              <Select
                value={String(scenario.returnPeriodYears ?? 100)}
                onValueChange={(v) =>
                  patch({ returnPeriodYears: Number(v) as 10 | 50 | 100 })
                }
              >
                <SelectTrigger id="scenario-return-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 50, 100].map((years) => (
                    <SelectItem key={years} value={String(years)}>{years} years</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scenario-exposure-multiplier">Exposure ×</Label>
              <Input
                id="scenario-exposure-multiplier"
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={scenario.exposureMultiplier ?? 1}
                onChange={(e) =>
                  patch({ exposureMultiplier: Math.max(0.1, Number(e.target.value) || 1) })
                }
              />
            </div>
          </div>

          {impact && (
            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Affected</span>
                <span className="font-medium">
                  {impact.affectedDealershipIds.length} locations
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Exposure</span>
                <span className="font-medium">
                  {eur(impact.totalExposureEur)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Expected loss
                </span>
                <span className="font-semibold text-destructive">
                  {eur(impact.estimatedLossEur)}
                </span>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">
                Model {impact.modelVersion} · {impact.scenario.returnPeriodYears ?? "—"} year return period
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
