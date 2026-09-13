import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Info,
  Loader2,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import type { RiskParameters } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Card } from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import { Slider } from "@renderer/components/ui/slider";

type ParameterKey = keyof RiskParameters;
type UnitKey =
  | "eur"
  | "squareMeters"
  | "fraction"
  | "kmh"
  | "factor"
  | "strikesPerSqKmYear"
  | "daysPerYear"
  | "centimeters"
  | "millimetersPerYear"
  | "kilometers"
  | "outOf100"
  | "meters";
type ParameterField = {
  key: ParameterKey;
  unit: UnitKey;
  min: number;
  max?: number;
  step: number;
  recommended?: boolean;
  tip?: boolean;
};
type ParameterGroup = {
  id: "exposure" | "risk" | "scores" | "portfolio" | "quality";
  fields: ParameterField[];
  defaultOpen?: boolean;
};

const GROUPS: ParameterGroup[] = [
  {
    id: "exposure",
    defaultOpen: true,
    fields: [
      {
        key: "vehicleValueCarEur",
        unit: "eur",
        min: 0,
        step: 1000,
        recommended: true,
        tip: true,
      },
      { key: "vehicleValueDefaultEur", unit: "eur", min: 0, step: 1000 },
      {
        key: "capacitySqmPerVehicle",
        unit: "squareMeters",
        min: 0.1,
        step: 1,
        recommended: true,
        tip: true,
      },
    ],
  },
  {
    id: "risk",
    defaultOpen: true,
    fields: [
      {
        key: "hailDamageFraction",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
        recommended: true,
        tip: true,
      },
      {
        key: "hailSiteHitProbability",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
        recommended: true,
        tip: true,
      },
      {
        key: "climateLoadingFactor",
        unit: "fraction",
        min: 0,
        step: 0.01,
        recommended: true,
        tip: true,
      },
      { key: "windStormThresholdKmh", unit: "kmh", min: 0, step: 1 },
      {
        key: "windDamageFraction",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
        recommended: true,
        tip: true,
      },
      {
        key: "windSiteHitProbability",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "lightningDamageFraction",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.001,
      },
      { key: "lightningDensityScale", unit: "factor", min: 0, step: 0.0001 },
      {
        key: "snowLoadDamageFractionPer30cm",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.001,
      },
      { key: "floodDamageHq10", unit: "fraction", min: 0, max: 1, step: 0.01 },
      {
        key: "floodDamageHq100",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
        recommended: true,
        tip: true,
      },
      {
        key: "floodDamageHqExtrem",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      { key: "heatHotdaysScoreMax", unit: "daysPerYear", min: 1, step: 1 },
      {
        key: "heatDamageFractionPerHotday",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.0001,
      },
    ],
  },
  {
    id: "scores",
    fields: [
      {
        key: "windScoreMaxKmh",
        unit: "kmh",
        min: 1,
        step: 1,
        recommended: true,
        tip: true,
      },
      {
        key: "lightningScoreMaxDensity",
        unit: "strikesPerSqKmYear",
        min: 0.1,
        step: 0.1,
      },
      { key: "snowScoreMaxCm", unit: "centimeters", min: 1, step: 1 },
      {
        key: "floodScoreMaxAnnualPrecipMm",
        unit: "millimetersPerYear",
        min: 1,
        step: 50,
        recommended: true,
        tip: true,
      },
    ],
  },
  {
    id: "portfolio",
    fields: [
      {
        key: "pmlDamageFraction10",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "pmlDamageFraction50",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "pmlDamageFraction100",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
        recommended: true,
        tip: true,
      },
      { key: "pmlClusterRadiusKm", unit: "kilometers", min: 0.1, step: 5 },
      {
        key: "accumulationRadiusKm",
        unit: "kilometers",
        min: 0.1,
        step: 1,
        recommended: true,
        tip: true,
      },
      {
        key: "accumulationReinsureThresholdEur",
        unit: "eur",
        min: 0,
        step: 1000000,
        recommended: true,
        tip: true,
      },
      {
        key: "scenarioDamageLow",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "scenarioDamageMedium",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "scenarioDamageHigh",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "scenarioDamageExtreme",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    id: "quality",
    fields: [
      {
        key: "alertExtremeScore",
        unit: "outOf100",
        min: 0,
        max: 100,
        step: 1,
        recommended: true,
        tip: true,
      },
      {
        key: "alertOvercapacity",
        unit: "factor",
        min: 0,
        step: 0.05,
        recommended: true,
        tip: true,
      },
      {
        key: "alertLowBoundaryConfidence",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "alertEalPortfolioShare",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "boundaryReviewConfidence",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "boundaryReviewTop2Margin",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "boundaryReviewSourceAgreement",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      { key: "boundaryNearPointDistanceM", unit: "meters", min: 0, step: 5 },
      { key: "syntheticBoundaryRadiusM", unit: "meters", min: 1, step: 10 },
      {
        key: "detectionConfidence",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
        recommended: true,
        tip: true,
      },
    ],
  },
];

function displayValue(value: number): string {
  return String(value);
}

type ParameterEditorProps = {
  field: ParameterField;
  label: string;
  unit: string;
  value: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onCommit: (value: number) => void;
};

function ParameterEditor({
  field,
  label,
  unit,
  value,
  disabled,
  onDraftChange,
  onCommit,
}: ParameterEditorProps): React.JSX.Element {
  const numericValue = Number(value);
  const sliderEnabled = field.max != null && field.max <= 100;
  const sliderValue = Number.isFinite(numericValue)
    ? Math.min(field.max ?? numericValue, Math.max(field.min, numericValue))
    : field.min;
  return (
    <div className="space-y-2">
      {sliderEnabled && (
        <div className="flex items-center gap-3">
          <Slider
            aria-label={label}
            min={field.min}
            max={field.max}
            step={field.step}
            value={sliderValue}
            onValueChange={(nextValue) => onDraftChange(String(nextValue))}
            onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
            onKeyUp={(event) => {
              if (
                event.key === "Enter" ||
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight"
              )
                onCommit(Number(event.currentTarget.value));
            }}
            disabled={disabled}
            className="min-w-0 flex-1"
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
            {field.unit === "fraction"
              ? `${Math.round(sliderValue * 100)}%`
              : Math.round(sliderValue)}
          </span>
        </div>
      )}
      <div className="relative">
        <Input
          id={`parameter-${field.key}`}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={value}
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={() => onCommit(Number(value))}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={disabled}
          className="pr-16 text-right tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}

function NativeDetails({
  initiallyOpen,
  children,
}: {
  initiallyOpen?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const setRef = useCallback(
    (node: HTMLDetailsElement | null) => {
      if (node) node.open = initiallyOpen ?? false;
    },
    [initiallyOpen],
  );

  return <details ref={setRef}>{children}</details>;
}

type ParametersErrorBoundaryProps = {
  children: ReactNode;
  title: string;
  description: string;
  retry: string;
};
type ParametersErrorBoundaryState = { failed: boolean };

class ParametersErrorBoundary extends Component<
  ParametersErrorBoundaryProps,
  ParametersErrorBoundaryState
> {
  state: ParametersErrorBoundaryState = { failed: false };
  static getDerivedStateFromError(): ParametersErrorBoundaryState {
    return { failed: true };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Parameters page failed to render", error, errorInfo);
  }
  render(): ReactNode {
    if (this.state.failed)
      return (
        <div className="mx-auto max-w-2xl p-8">
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="text-lg font-semibold">{this.props.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {this.props.description}
              </p>
            </div>
            <Button onClick={() => this.setState({ failed: false })}>
              {this.props.retry}
            </Button>
          </Card>
        </div>
      );
    return this.props.children;
  }
}

export function ParametersPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ParametersErrorBoundary
      title={t("parameters.loadErrorTitle")}
      description={t("parameters.loadErrorDescription")}
      retry={t("parameters.retry")}
    >
      <ParametersContent />
    </ParametersErrorBoundary>
  );
}

function ParametersContent(): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const parametersUpdating = useAppStore((s) => s.parametersUpdating);
  const updateParameters = useAppStore((s) => s.updateParameters);
  const resetParameters = useAppStore((s) => s.resetParameters);
  const saveSession = useAppStore((s) => s.saveSession);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          displayValue(value),
        ]),
      ),
    );
  }, [parameters]);
  const fieldCount = useMemo(
    () => GROUPS.reduce((sum, group) => sum + group.fields.length, 0),
    [],
  );
  async function commitValue(
    field: ParameterField,
    value: number,
  ): Promise<void> {
    if (
      !Number.isFinite(value) ||
      value < field.min ||
      (field.max != null && value > field.max)
    ) {
      setDraft((current) => ({
        ...current,
        [field.key]: String(parameters[field.key]),
      }));
      return;
    }
    if (value !== parameters[field.key])
      await updateParameters({ [field.key]: value } as Partial<RiskParameters>);
  }
  async function reset(): Promise<void> {
    await resetParameters();
    toast.success(t("parameters.resetDone"));
  }
  async function save(): Promise<void> {
    await saveSession();
    toast.success(t("common.saved"));
  }
  const fieldLabel = (field: ParameterField): string =>
    t(`parameters.parameterFields.${field.key}.label`);
  const fieldDescription = (field: ParameterField): string =>
    t(`parameters.parameterFields.${field.key}.description`);
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 text-primary" />
            <h2 className="text-2xl font-semibold">{t("parameters.title")}</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("parameters.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/60 p-2">
          <Badge variant="outline">
            {fieldCount} {t("parameters.fields")}
          </Badge>
          {parametersUpdating && (
            <Badge variant="secondary">
              <Loader2 className="mr-1 size-3 animate-spin" />
              {t("parameters.recalculating")}
            </Badge>
          )}
          {!parametersUpdating && lastSavedAt && (
            <Badge variant="secondary">{t("parameters.autosaved")}</Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => void reset()}
              disabled={parametersUpdating}
            >
              <RotateCcw className="mr-2 size-4" />
              {t("parameters.reset")}
            </Button>
            <Button onClick={() => void save()} disabled={parametersUpdating}>
              <Save className="mr-2 size-4" />
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-medium">{t("parameters.startHereTitle")}</p>
          <p className="text-muted-foreground">
            {t("parameters.startHereDescription")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("parameters.fractionHint")}
          </p>
        </div>
      </div>
      <div className="space-y-4">
        {GROUPS.map((group) => {
          const recommendedFields = group.fields.filter(
            (field) => field.recommended,
          );
          const advancedFields = group.fields.filter(
            (field) => !field.recommended,
          );
          return (
            <Card key={group.id} className="overflow-hidden">
              <NativeDetails initiallyOpen={group.defaultOpen}>
                <summary className="group flex cursor-pointer list-none items-start gap-3 p-5 [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {t(`parameters.groups.${group.id}.title`)}
                      </span>
                      {recommendedFields.length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {recommendedFields.length}{" "}
                          {t("parameters.recommended")}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {t(`parameters.groups.${group.id}.description`)}
                    </span>
                  </span>
                </summary>
                <div className="space-y-4 px-5 pb-5">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {recommendedFields.map((field) => (
                      <div
                        key={field.key}
                        className="rounded-lg border border-primary/15 bg-primary/[0.03] p-4"
                      >
                        <div className="mb-3 min-w-0">
                          <label
                            htmlFor={`parameter-${field.key}`}
                            className="text-sm font-medium"
                          >
                            {fieldLabel(field)}
                          </label>
                          <p className="text-xs text-muted-foreground">
                            {fieldDescription(field)}
                          </p>
                        </div>
                        <ParameterEditor
                          field={field}
                          label={fieldLabel(field)}
                          unit={t(`parameters.units.${field.unit}`)}
                          value={
                            draft[field.key] ?? String(parameters[field.key])
                          }
                          onDraftChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              [field.key]: value,
                            }))
                          }
                          onCommit={(value) => commitValue(field, value)}
                          disabled={parametersUpdating}
                        />
                        {field.tip && (
                          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {t("parameters.whatFor")}
                            </span>{" "}
                            {t(`parameters.parameterFields.${field.key}.tip`)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  {advancedFields.length > 0 && (
                    <details className="rounded-lg border bg-muted/20">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="size-4 text-muted-foreground" />
                        {t("parameters.advancedParameters")}{" "}
                        <span className="font-normal text-muted-foreground">
                          ({advancedFields.length})
                        </span>
                      </summary>
                      <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
                        {advancedFields.map((field) => (
                          <div
                            key={field.key}
                            className="grid gap-2 sm:grid-cols-[1fr_160px] sm:items-center"
                          >
                            <div className="min-w-0">
                              <label
                                htmlFor={`parameter-${field.key}`}
                                className="text-sm font-medium"
                              >
                                {fieldLabel(field)}
                              </label>
                              <p className="text-xs text-muted-foreground">
                                {fieldDescription(field)}
                              </p>
                            </div>
                            <ParameterEditor
                              field={field}
                              label={fieldLabel(field)}
                              unit={t(`parameters.units.${field.unit}`)}
                              value={
                                draft[field.key] ??
                                String(parameters[field.key])
                              }
                              onDraftChange={(value) =>
                                setDraft((current) => ({
                                  ...current,
                                  [field.key]: value,
                                }))
                              }
                              onCommit={(value) => commitValue(field, value)}
                              disabled={parametersUpdating}
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </NativeDetails>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
