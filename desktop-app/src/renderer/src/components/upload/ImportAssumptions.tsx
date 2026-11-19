import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Check, ScanEye, TriangleAlert } from "lucide-react";
import type { RiskParameters } from "@shared/types";
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
import {
  formatParameterValue,
  parseLocaleNumber,
} from "@renderer/components/parameters/parameterInput";
import {
  DEFAULT_TEMPLATE_ID,
  useParameterTemplates,
} from "@renderer/lib/useParameterTemplates";
import { useModelAvailable } from "@renderer/lib/useModelAvailable";

/** Template id for "keep the values of the portfolio in use". */
const CURRENT = "__current__";

/** The assumptions most portfolios set before the first analysis. */
const KEY_FIELDS = [
  { key: "vehicleValueCarEur", unit: "€", min: 0, max: 1_000_000 },
  { key: "capacitySqmPerVehicle", unit: "m²", min: 0.1, max: 1000 },
  { key: "accumulationRadiusKm", unit: "km", min: 0.1, max: 1000 },
  { key: "alertHailZone", unit: "", min: 1, max: 6, integer: true },
] as const satisfies ReadonlyArray<{
  key: keyof RiskParameters;
  unit: string;
  min: number;
  max: number;
  integer?: boolean;
}>;

/**
 * Last step before an import is analysed: whether the vehicle detection is
 * ready (without it there is no hail EAL), which parameter set the new
 * portfolio starts from, and the few values that set exposure and review
 * notes. Everything else stays on the parameters page.
 */
export function ImportAssumptions({
  value,
  onChange,
  editable,
  onLeave,
}: Readonly<{
  value: RiskParameters;
  onChange: (next: RiskParameters) => void;
  /** False for an import into a filled portfolio: its parameters stay. */
  editable: boolean;
  /** Called before leaving the dialog for the settings. */
  onLeave: () => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language;
  const modelAvailable = useModelAvailable();
  const { templates, parametersOf } = useParameterTemplates();
  const [current] = useState(value);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  function applyTemplate(id: string): void {
    const next = id === CURRENT ? current : parametersOf(id);
    if (!next) return;
    setDrafts({});
    setErrors({});
    onChange(next);
  }

  function commit(field: (typeof KEY_FIELDS)[number], raw: string): void {
    const parsed = parseLocaleNumber(raw, locale);
    const valid =
      Number.isFinite(parsed) &&
      parsed >= field.min &&
      parsed <= field.max &&
      (!("integer" in field) || Number.isInteger(parsed));
    setErrors((e) => ({ ...e, [field.key]: !valid }));
    if (!valid) return;
    setDrafts((d) => {
      const next = { ...d };
      delete next[field.key];
      return next;
    });
    onChange({
      ...value,
      [field.key]: parsed,
      // One vehicle value, as on the parameters page.
      ...(field.key === "vehicleValueCarEur" &&
      value.vehicleValueDefaultEur === value.vehicleValueCarEur
        ? { vehicleValueDefaultEur: parsed }
        : {}),
    });
  }

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 text-sm font-semibold">
        {t("importAssumptions.title")}
      </legend>

      {modelAvailable === false ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p>
              <span className="font-medium">
                {t("importAssumptions.modelMissing")}
              </span>{" "}
              {t("importAssumptions.modelMissingHint")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                onLeave();
                navigate("/settings?section=data");
              }}
            >
              <ScanEye className="size-3" />
              {t("map.page.setupDetection")}
            </Button>
          </div>
        </div>
      ) : modelAvailable ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-success" />
          {t("importAssumptions.modelReady")}
        </p>
      ) : null}

      {editable ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground">
              {t("importAssumptions.template")}
            </Label>
            <Select defaultValue={CURRENT} onValueChange={applyTemplate}>
              <SelectTrigger
                className="h-8 w-64 text-xs"
                aria-label={t("importAssumptions.template")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CURRENT}>
                  {t("importAssumptions.currentValues")}
                </SelectItem>
                <SelectItem value={DEFAULT_TEMPLATE_ID}>
                  {t("parameters.templates.defaults")}
                </SelectItem>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.name} value={tpl.name}>
                    {tpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {KEY_FIELDS.map((field) => {
              const id = `import-assumption-${field.key}`;
              const shown =
                drafts[field.key] ??
                formatParameterValue(value[field.key], locale);
              return (
                <div key={field.key} className="space-y-0.5">
                  <Label htmlFor={id} className="text-xs">
                    {t(`parameters.parameterFields.${field.key}.label`)}
                  </Label>
                  <div className="flex h-8 items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
                    <Input
                      id={id}
                      type="text"
                      inputMode={"integer" in field ? "numeric" : "decimal"}
                      value={shown}
                      aria-invalid={errors[field.key] || undefined}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [field.key]: e.target.value,
                        }))
                      }
                      onBlur={() => commit(field, shown)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commit(field, shown);
                        }
                      }}
                      className="h-full min-w-0 flex-1 border-0 px-2 text-right tabular-nums shadow-none focus-visible:ring-0"
                    />
                    <span className="shrink-0 pr-2 text-xs text-muted-foreground">
                      {field.unit || t("parameters.units.hailZone")}
                    </span>
                  </div>
                  {errors[field.key] && (
                    <p className="text-xs text-destructive" role="alert">
                      {t("importAssumptions.invalid", {
                        min: formatParameterValue(field.min, locale),
                        max: formatParameterValue(field.max, locale),
                      })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("importAssumptions.more")}
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("importAssumptions.keepsParameters")}
        </p>
      )}
    </fieldset>
  );
}
