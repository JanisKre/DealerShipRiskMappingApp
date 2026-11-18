import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { useAppStore } from "@renderer/store/appStore";
import { eur, num } from "@renderer/lib/format";
import { isAreaEstimatedDetection } from "@shared/risk-math";
import { Metric } from "./shared";

/** Detected and manual vehicle count, capacity and utilisation. */
export function VehiclePanel({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [adjusting, setAdjusting] = useState(false);
  const manual = d.detection?.manualVehicleCount;
  useEffect(() => setAdjusting(false), [d.id]);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">{t("common.vehicles")}</h4>
        {!adjusting && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setAdjusting(true)}
          >
            <Pencil className="size-3" />
            {manual != null
              ? t("dashboard.detailDialog.vehiclesChangeManual")
              : t("dashboard.detailDialog.vehiclesAdjust")}
          </Button>
        )}
      </div>
      <Metric
        label={
          isAreaEstimatedDetection(d.detection)
            ? t("dashboard.detailDialog.estimatedVehicleCount")
            : t("dashboard.detailDialog.machineVehicleCount")
        }
        value={num(d.detection?.vehicleCount)}
      />
      {manual != null && !adjusting && (
        <p className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.manualVehicleCountSaved", {
            count: manual,
          })}
        </p>
      )}
      {adjusting && (
        <ManualVehicleCountEditor d={d} onDone={() => setAdjusting(false)} />
      )}
    </div>
  );
}

function ManualVehicleCountEditor({
  d,
  onDone,
}: {
  d: AnalyzedDealership;
  onDone: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const updateManualVehicleCount = useAppStore(
    (state) => state.updateManualVehicleCount,
  );
  const [draft, setDraft] = useState(
    () => d.detection?.manualVehicleCount?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);

  const parsed = draft.trim() === "" ? null : Number(draft);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0);

  async function save(value: number | null): Promise<void> {
    if (!valid) return;
    setSaving(true);
    const before = d.risk?.exposureEur;
    try {
      await updateManualVehicleCount(d.id, value);
      // The count replaces the area estimate in the exposure, often by an
      // order of magnitude: say so instead of changing it silently (UX-04).
      const after = useAppStore
        .getState()
        .dealerships.find((x) => x.id === d.id)?.risk?.exposureEur;
      if (before != null && after != null && before !== after) {
        toast.info(
          t("dashboard.detailDialog.exposureChanged", {
            from: eur(before),
            to: eur(after),
          }),
          value != null
            ? {
                description: t("dashboard.detailDialog.exposureChangedDetail", {
                  count: num(value),
                }),
              }
            : undefined,
        );
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-1 rounded-md border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save(parsed);
      }}
    >
      <Label htmlFor={`manual-count-${d.id}`} className="text-xs">
        {t("dashboard.detailDialog.manualVehicleCount")}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={`manual-count-${d.id}`}
          autoFocus
          type="number"
          min={0}
          step={1}
          value={draft}
          className="h-8"
          placeholder={t(
            "dashboard.detailDialog.manualVehicleCountPlaceholder",
          )}
          aria-invalid={!valid}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={saving || !valid}>
          {t("dashboard.detailDialog.vehicleCountSave")}
        </Button>
        {d.detection?.manualVehicleCount != null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => void save(null)}
          >
            {t("dashboard.detailDialog.vehiclesUseDetected")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("dashboard.detailDialog.websiteCancel")}
        </Button>
      </div>
      {!valid && (
        <p role="alert" className="text-xs text-destructive">
          {t("dashboard.detailDialog.manualCountInvalid")}
        </p>
      )}
    </form>
  );
}
