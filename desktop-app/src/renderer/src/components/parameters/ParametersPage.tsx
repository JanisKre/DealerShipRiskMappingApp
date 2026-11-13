import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Info,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import type { RiskParameters } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { meanHailSeverityEur } from "@shared/risk-math";
import { eur, pct } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Card } from "@renderer/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { TileInfo } from "@renderer/components/dashboard/TileInfo";
import {
  formatParameterValue,
  parameterInputError,
  parseLocaleNumber,
  zonesWithFallingFrequency,
} from "./parameterInput";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";

type ParameterKey = keyof RiskParameters;
type UnitKey =
  | "eur"
  | "squareMeters"
  | "fraction"
  | "factor"
  | "kilometers"
  | "eventsPerYear"
  | "eurPerVehicle"
  | "hailZone"
  | "meters";
type ParameterField = {
  key: ParameterKey;
  unit: UnitKey;
  min: number;
  max?: number;
  step: number;
  /** Only whole numbers are valid (e.g. a hail zone). */
  integer?: boolean;
  recommended?: boolean;
  tip?: boolean;
};
type ParameterGroup = {
  id: "exposure" | "risk" | "portfolio" | "quality";
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
        max: 1_000_000,
        step: 1000,
        recommended: true,
        tip: true,
      },
      {
        key: "vehicleValueDefaultEur",
        unit: "eur",
        min: 0,
        max: 1_000_000,
        step: 1000,
      },
      {
        key: "capacitySqmPerVehicle",
        unit: "squareMeters",
        min: 0.1,
        max: 1000,
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
        key: "hailFrequencyZone1",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone2",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone3",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone4",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone5",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone6",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailShareSmall",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.05,
        recommended: true,
      },
      {
        key: "hailShareMedium",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.05,
        recommended: true,
      },
      {
        key: "hailShareLarge",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.05,
        recommended: true,
      },
      {
        key: "hailSeveritySmallEur",
        unit: "eurPerVehicle",
        min: 0,
        max: 1_000_000,
        step: 100,
        recommended: true,
      },
      {
        key: "hailSeverityMediumEur",
        unit: "eurPerVehicle",
        min: 0,
        max: 1_000_000,
        step: 100,
        recommended: true,
      },
      {
        key: "hailSeverityLargeEur",
        unit: "eurPerVehicle",
        min: 0,
        max: 1_000_000,
        step: 100,
        recommended: true,
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
      {
        key: "pmlClusterRadiusKm",
        unit: "kilometers",
        min: 0.1,
        max: 1000,
        step: 5,
      },
      {
        key: "accumulationRadiusKm",
        unit: "kilometers",
        min: 0.1,
        max: 1000,
        step: 1,
        recommended: true,
        tip: true,
      },
      {
        key: "accumulationReinsureThresholdEur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
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
        key: "alertHailZone",
        unit: "hailZone",
        min: 1,
        max: 6,
        step: 1,
        integer: true,
        recommended: true,
        tip: true,
      },
      {
        key: "alertOvercapacity",
        unit: "factor",
        min: 0,
        max: 100,
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
      {
        key: "boundaryNearPointDistanceM",
        unit: "meters",
        min: 0,
        max: 10_000,
        step: 5,
      },
      {
        key: "syntheticBoundaryRadiusM",
        unit: "meters",
        min: 1,
        max: 10_000,
        step: 10,
      },
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

/** A warning sentence: the colour sits on the icon, the text stays readable. */
function WarningLine({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>): React.JSX.Element {
  return (
    <p className={`flex items-start gap-1.5 ${className ?? ""}`}>
      <TriangleAlert
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-warning-foreground"
      />
      <span>{children}</span>
    </p>
  );
}

/** Formula, placeholder status, and the class-share sum of the hail EAL. */
function HailEalNotice({
  parameters,
}: Readonly<{ parameters: RiskParameters }>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const shareSum =
    parameters.hailShareSmall +
    parameters.hailShareMedium +
    parameters.hailShareLarge;
  const mean = meanHailSeverityEur(parameters);
  const fallingZones = zonesWithFallingFrequency([
    parameters.hailFrequencyZone1,
    parameters.hailFrequencyZone2,
    parameters.hailFrequencyZone3,
    parameters.hailFrequencyZone4,
    parameters.hailFrequencyZone5,
    parameters.hailFrequencyZone6,
  ]);
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 p-4 text-sm">
      <p className="font-mono text-xs">
        EAL = N × λ<sub>z</sub> × (p<sub>S</sub>·S<sub>S</sub> + p<sub>M</sub>·S
        <sub>M</sub> + p<sub>L</sub>·S<sub>L</sub>)
      </p>
      <p className="text-muted-foreground">{t("parameters.hailEal.formula")}</p>
      <WarningLine className="font-medium">
        {t("parameters.hailEal.placeholders")}
      </WarningLine>
      <p className="text-xs text-muted-foreground">
        {t("parameters.hailEal.meanSeverity", { value: eur(mean) })}
      </p>
      {Math.abs(shareSum - 1) > 0.001 && (
        <WarningLine className="text-xs">
          {t("parameters.hailEal.shareSum", {
            sum: formatParameterValue(Number(shareSum.toFixed(2)), locale),
          })}
        </WarningLine>
      )}
      {fallingZones.length > 0 && (
        <WarningLine className="text-xs">
          {t("parameters.hailEal.frequencyOrder", {
            count: fallingZones.length,
            zones: fallingZones.join(", "),
          })}
        </WarningLine>
      )}
    </div>
  );
}

type EditorBindings = {
  parameters: RiskParameters;
  draft: Record<string, string>;
  disabled: boolean;
  label: (field: ParameterField) => string;
  onDraftChange: (key: ParameterKey, value: string) => void;
  onCommit: (field: ParameterField, raw: string) => void;
  onRevert: (field: ParameterField) => void;
  locale: string;
};

/**
 * Frequency (λ per zone), probability (p per class) and severity (S per
 * class) as three compact tables: one input row each, instead of twelve cards.
 */
function HailEalTables({
  bindings,
}: Readonly<{ bindings: EditorBindings }>): React.JSX.Element {
  const { t } = useTranslation();
  const riskFields = GROUPS.find((g) => g.id === "risk")!.fields;
  const fieldOf = (key: ParameterKey): ParameterField =>
    riskFields.find((f) => f.key === key)!;
  const cell = (key: ParameterKey): React.JSX.Element => {
    const field = fieldOf(key);
    return (
      <ParameterEditor
        field={field}
        label={bindings.label(field)}
        unit=""
        value={
          bindings.draft[key] ??
          formatParameterValue(bindings.parameters[key], bindings.locale)
        }
        locale={bindings.locale}
        onDraftChange={(value) => bindings.onDraftChange(key, value)}
        onCommit={(raw) => bindings.onCommit(field, raw)}
        onRevert={() => bindings.onRevert(field)}
        disabled={bindings.disabled}
        compact
      />
    );
  };
  const classes = [
    { id: "small", label: t("parameters.hailEal.small") },
    { id: "medium", label: t("parameters.hailEal.medium") },
    { id: "large", label: t("parameters.hailEal.large") },
  ] as const;
  const section = (
    title: string,
    unit: string,
    hint: string,
    columns: Array<{ id: string; label: string; key: ParameterKey }>,
  ): React.JSX.Element => (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold">
        {title}{" "}
        <span className="font-normal text-muted-foreground">({unit})</span>
      </h4>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.id} className="h-8 text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableCell key={c.id} className="px-2 py-1.5">
                {cell(c.key)}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
  return (
    <div className="space-y-4">
      {section(
        t("parameters.hailEal.frequency"),
        t("parameters.units.eventsPerYear"),
        t("parameters.hailEal.frequencyHint"),
        [1, 2, 3, 4, 5, 6].map((zone) => ({
          id: `z${zone}`,
          label: t("dashboard.zoneShort", { zone }),
          key: `hailFrequencyZone${zone}` as ParameterKey,
        })),
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {section(
          t("parameters.hailEal.probability"),
          t("parameters.units.fraction"),
          t("parameters.hailEal.probabilityHint"),
          classes.map((c) => ({
            id: c.id,
            label: c.label,
            key: `hailShare${c.id[0].toUpperCase()}${c.id.slice(1)}` as ParameterKey,
          })),
        )}
        {section(
          t("parameters.hailEal.severity"),
          t("parameters.units.eurPerVehicle"),
          t("parameters.hailEal.severityHint"),
          classes.map((c) => ({
            id: c.id,
            label: c.label,
            key: `hailSeverity${c.id[0].toUpperCase()}${c.id.slice(1)}Eur` as ParameterKey,
          })),
        )}
      </div>
    </div>
  );
}

/**
 * The value as the rest of the app shows it, under the field: confirms how a
 * typed number was read ("30.000" → "30.000 €") and shows shares in percent.
 */
function readableValue(field: ParameterField, value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (field.unit === "eur" && Math.abs(value) >= 10_000) return eur(value);
  if (field.unit === "fraction") return pct(value, 1);
  return null;
}

type ParameterEditorProps = {
  field: ParameterField;
  label: string;
  unit: string;
  value: string;
  /** UI language: the field reads and shows numbers in its notation. */
  locale: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  /** Receives the raw field text so an empty field isn't read as 0. */
  onCommit: (raw: string) => void;
  /** Escape: drop the draft and show the stored value again. */
  onRevert: () => void;
  /** Narrow table cell: smaller minimum width, no readable-value line. */
  compact?: boolean;
};

function ParameterEditor({
  field,
  label,
  unit,
  value,
  locale,
  disabled,
  onDraftChange,
  onCommit,
  onRevert,
  compact = false,
}: ParameterEditorProps): React.JSX.Element {
  const readable = compact
    ? null
    : readableValue(field, parseLocaleNumber(value, locale));
  // Unit as an in-field suffix with its own width: units range from
  // "€" to "Schläge/km²/Jahr", so a fixed right padding can't fit them.
  return (
    <div className="space-y-0.5">
      <div
        className={`flex h-8 w-full items-center rounded-md border border-input shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring has-[input:read-only]:opacity-60 ${
          compact ? "min-w-14" : "min-w-24"
        }`}
      >
        <Input
          id={`parameter-${field.key}`}
          aria-label={label}
          // Text, not type="number": Chromium reads "30.000" as 30 there.
          type="text"
          inputMode={field.integer ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={() => onCommit(value)}
          onKeyDown={(event) => {
            // Enter commits and keeps the focus; Escape discards the draft.
            if (event.key === "Enter") onCommit(value);
            if (event.key === "Escape") {
              event.preventDefault();
              onRevert();
            }
          }}
          // Read-only, not disabled, while scores recalculate: a disabled
          // field drops the focus right after Enter.
          readOnly={disabled}
          aria-busy={disabled || undefined}
          className="h-full min-w-0 flex-1 border-0 px-2 text-right tabular-nums shadow-none focus-visible:ring-0"
        />
        {unit && (
          <span className="shrink-0 whitespace-nowrap pr-2 text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {readable && (
        <p className="pr-2 text-right text-xs text-muted-foreground tabular-nums">
          = {readable}
        </p>
      )}
    </div>
  );
}

/** Confirms a reset that would overwrite values differing from the defaults. */
function ResetDialog({
  open,
  changedCount,
  onOpenChange,
  onConfirm,
}: Readonly<{
  open: boolean;
  changedCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("parameters.resetConfirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("parameters.resetConfirmDescription", { count: changedCount })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <RotateCcw className="size-4" />
            {t("parameters.reset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  // `group` on <details>: its `open` attribute drives the chevron.
  return (
    <details ref={setRef} className="group">
      {children}
    </details>
  );
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
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const parameters = useAppStore((s) => s.parameters);
  const parametersUpdating = useAppStore((s) => s.parametersUpdating);
  const updateParameters = useAppStore((s) => s.updateParameters);
  const resetParameters = useAppStore((s) => s.resetParameters);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          formatParameterValue(value, locale),
        ]),
      ),
    );
  }, [parameters, locale]);
  function revertDraft(field: ParameterField): void {
    setDraft((current) => ({
      ...current,
      [field.key]: formatParameterValue(parameters[field.key], locale),
    }));
  }
  function ruleText(field: ParameterField): string {
    const fmt = (n: number): string => formatParameterValue(n, locale);
    if (field.max == null)
      return t("parameters.validation.atLeast", { min: fmt(field.min) });
    return t(
      field.integer
        ? "parameters.validation.wholeBetween"
        : "parameters.validation.between",
      { min: fmt(field.min), max: fmt(field.max) },
    );
  }
  async function commitValue(
    field: ParameterField,
    raw: string,
  ): Promise<void> {
    const error = parameterInputError(raw, field, locale);
    if (error) {
      revertDraft(field);
      // Say why the value jumped back instead of reverting silently.
      toast.error(
        t(`parameters.validation.${error}`, {
          label: fieldLabel(field),
          rule: ruleText(field),
          value: formatParameterValue(parameters[field.key], locale),
        }),
      );
      return;
    }
    const value = parseLocaleNumber(raw, locale);
    // Unchanged ("30000" for 30.000): show it in the usual notation again.
    if (value === parameters[field.key]) {
      revertDraft(field);
      return;
    }
    try {
      await updateParameters({ [field.key]: value } as Partial<RiskParameters>);
    } catch (err) {
      revertDraft(field);
      toast.error(
        t("parameters.validation.rejected", {
          label: fieldLabel(field),
          error: (err as Error).message,
        }),
      );
    }
  }
  const changedFromDefaults = (
    Object.keys(DEFAULT_RISK_PARAMETERS) as ParameterKey[]
  ).filter((key) => parameters[key] !== DEFAULT_RISK_PARAMETERS[key]).length;
  function requestReset(): void {
    if (changedFromDefaults === 0) {
      toast.info(t("parameters.resetNothing"));
      return;
    }
    setConfirmReset(true);
  }
  async function reset(): Promise<void> {
    setConfirmReset(false);
    const previous = parameters;
    await resetParameters();
    toast.success(t("parameters.resetDone"), {
      action: {
        label: t("parameters.resetUndo"),
        onClick: () => void updateParameters(previous),
      },
    });
  }
  const fieldLabel = (field: ParameterField): string =>
    t(`parameters.parameterFields.${field.key}.label`);
  const fieldDescription = (field: ParameterField): string =>
    t(`parameters.parameterFields.${field.key}.description`);
  const bindings: EditorBindings = {
    parameters,
    draft,
    disabled: parametersUpdating,
    label: fieldLabel,
    onDraftChange: (key, value) =>
      setDraft((current) => ({ ...current, [key]: value })),
    onCommit: (field, raw) => void commitValue(field, raw),
    onRevert: revertDraft,
    locale,
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      {/* Changes autosave (header: "Automatisch gespeichert · …"), so the
          page has no Save button; only the recalculation state and reset. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{t("parameters.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("parameters.description")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {parametersUpdating && (
            <Badge variant="secondary">
              <Loader2 className="mr-1 size-3 animate-spin" />
              {t("parameters.recalculating")}
            </Badge>
          )}
          <Button
            variant="outline"
            onClick={requestReset}
            disabled={parametersUpdating}
          >
            <RotateCcw className="mr-2 size-4" />
            {t("parameters.reset")}
          </Button>
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
          const recommendedCount = recommendedFields.length;
          return (
            <Card key={group.id} className="overflow-hidden">
              <NativeDetails initiallyOpen={group.defaultOpen}>
                <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {t(`parameters.groups.${group.id}.title`)}
                      </span>
                      {recommendedCount > 0 && group.id !== "risk" && (
                        <Badge variant="secondary" className="text-[10px]">
                          {recommendedCount} {t("parameters.recommended")}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {t(`parameters.groups.${group.id}.description`)}
                    </span>
                  </span>
                </summary>
                <div className="space-y-4 px-5 pb-5">
                  {group.id === "risk" ? (
                    <>
                      <HailEalNotice parameters={parameters} />
                      <HailEalTables bindings={bindings} />
                    </>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {[...recommendedFields, ...advancedFields].map(
                        (field) => (
                          <div
                            key={field.key}
                            className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_180px] sm:items-center"
                          >
                            <div className="min-w-0">
                              {/* Tips sit behind an ⓘ popover: Electron
                                  doesn't show native `title` tooltips. */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <label
                                  htmlFor={`parameter-${field.key}`}
                                  className="text-sm font-medium"
                                >
                                  {fieldLabel(field)}
                                </label>
                                {field.recommended && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px]"
                                  >
                                    {t("parameters.recommended")}
                                  </Badge>
                                )}
                                {field.tip && (
                                  <TileInfo
                                    label={fieldLabel(field)}
                                    text={t(
                                      `parameters.parameterFields.${field.key}.tip`,
                                    )}
                                  />
                                )}
                              </div>
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
                                formatParameterValue(
                                  parameters[field.key],
                                  locale,
                                )
                              }
                              locale={locale}
                              onRevert={() => revertDraft(field)}
                              onDraftChange={(value) =>
                                setDraft((current) => ({
                                  ...current,
                                  [field.key]: value,
                                }))
                              }
                              onCommit={(raw) => void commitValue(field, raw)}
                              disabled={parametersUpdating}
                            />
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </NativeDetails>
            </Card>
          );
        })}
      </div>
      <ResetDialog
        open={confirmReset}
        changedCount={changedFromDefaults}
        onOpenChange={setConfirmReset}
        onConfirm={() => void reset()}
      />
    </div>
  );
}
