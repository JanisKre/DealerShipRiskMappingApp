import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RISK_MODEL_VERSION } from "@shared/constants";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { notify } from "@renderer/lib/notify";
import type { AnalyzedDealership, RiskParameters } from "@shared/types";
import { ealCoverage, hasEalBasis } from "@shared/estimates";
import {
  DEFAULT_TEMPLATE_ID,
  useParameterTemplates,
} from "@renderer/lib/useParameterTemplates";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { meanHailSeverityEur } from "@shared/risk-math";
import { eur } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";
import { PageErrorBoundary } from "@renderer/components/common/PageErrorBoundary";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@renderer/components/ui/alert";
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
import { HintButton } from "@renderer/components/ui/hint-button";
import { Input } from "@renderer/components/ui/input";
import { TileInfo } from "@renderer/components/dashboard/TileInfo";
import {
  formatParameterValue,
  fromPercentDisplay,
  toPercentDisplay,
  parameterInputError,
  parseLocaleNumber,
  zonesWithFallingFrequency,
  zonesWithImplausibleFrequency,
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
  id: "exposure" | "risk" | "portfolio" | "quality" | "advanced";
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
        key: "capacityZone1Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone2Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone3Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone4Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone5Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone6Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
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
        key: "alertEalPortfolioShare",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  // Thresholds of the boundary and vehicle detection: rarely touched, kept
  // apart from the business assumptions above (UX review, November 2026).
  {
    id: "advanced",
    fields: [
      {
        key: "detectionConfidence",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
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
    ],
  },
];

const FIELD_BY_KEY = new Map(
  GROUPS.flatMap((g) => g.fields).map((field) => [field.key, field]),
);

/** Shares are shown and typed in percent. */
const isPercent = (field: ParameterField | undefined): boolean =>
  field?.unit === "fraction";

/** The stored value as the field shows it (percent for shares). */
function displayValue(
  key: ParameterKey,
  value: number,
  locale: string,
): string {
  const field = FIELD_BY_KEY.get(key);
  return formatParameterValue(
    isPercent(field) ? toPercentDisplay(value) : value,
    locale,
  );
}

/** Validation range in the unit the user types. */
function displayRule(field: ParameterField): ParameterField {
  return isPercent(field)
    ? { ...field, min: field.min * 100, max: (field.max ?? 1) * 100 }
    : field;
}

/** Unit label of a field (shares: "%"). */
function unitKey(field: ParameterField): string {
  return isPercent(field) ? "percent" : field.unit;
}

/**
 * "Fahrzeugwert Pkw" and "Standard-Fahrzeugwert" read as one value: the
 * second is shown only once a portfolio holds two different ones.
 */
function hiddenField(
  field: ParameterField,
  parameters: RiskParameters,
): boolean {
  return (
    field.key === "vehicleValueDefaultEur" &&
    parameters.vehicleValueDefaultEur === parameters.vehicleValueCarEur
  );
}

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
  // S above the vehicle value is capped there: say so, or Σ p·S does not
  // add up from the values in the table.
  const capped =
    parameters.vehicleValueCarEur > 0 &&
    [
      parameters.hailSeveritySmallEur,
      parameters.hailSeverityMediumEur,
      parameters.hailSeverityLargeEur,
    ].some((s) => s > parameters.vehicleValueCarEur);
  const fallingZones = zonesWithFallingFrequency([
    parameters.hailFrequencyZone1,
    parameters.hailFrequencyZone2,
    parameters.hailFrequencyZone3,
    parameters.hailFrequencyZone4,
    parameters.hailFrequencyZone5,
    parameters.hailFrequencyZone6,
  ]);
  // More than one damaging event a year is implausible for a zone rate;
  // allowed for stress tests, but said (UW-12).
  const highZones = zonesWithImplausibleFrequency(
    ([1, 2, 3, 4, 5, 6] as const).map(
      (z) => parameters[`hailFrequencyZone${z}`],
    ),
  );
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
      {capped && (
        <WarningLine className="text-xs">
          {t("parameters.hailEal.severityCapped", {
            value: eur(parameters.vehicleValueCarEur),
          })}
        </WarningLine>
      )}
      {Math.abs(shareSum - 1) > 0.001 && (
        <WarningLine className="text-xs">
          {t("parameters.hailEal.shareSum", {
            sum: formatParameterValue(Number(shareSum.toFixed(2)), locale),
          })}
        </WarningLine>
      )}
      {highZones.length > 0 && (
        <WarningLine className="text-xs">
          {t("parameters.hailEal.frequencyHigh", {
            count: highZones.length,
            zones: highZones.join(", "),
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
  errors: Partial<Record<ParameterKey, string>>;
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
    const standard = DEFAULT_RISK_PARAMETERS[key];
    const changed = bindings.parameters[key] !== standard;
    return (
      <div className="space-y-0.5">
        <ParameterEditor
          field={field}
          label={bindings.label(field)}
          unit=""
          value={
            bindings.draft[key] ??
            displayValue(key, bindings.parameters[key], bindings.locale)
          }
          locale={bindings.locale}
          onDraftChange={(value) => bindings.onDraftChange(key, value)}
          onCommit={(raw) => bindings.onCommit(field, raw)}
          onRevert={() => bindings.onRevert(field)}
          disabled={bindings.disabled}
          error={bindings.errors[key]}
          compact
        />
        {/* Like every other field: what the standard is, and a way back to
          it for this value alone. */}
        {changed && (
          <div className="flex items-center justify-end gap-0.5 text-[10px] text-muted-foreground">
            <span>
              {t("parameters.changedBadge", {
                value: displayValue(key, standard, bindings.locale),
              })}
            </span>
            <HintButton
              type="button"
              variant="ghost"
              size="icon"
              className="size-5"
              disabled={bindings.disabled}
              aria-label={t("parameters.resetField", {
                label: bindings.label(field),
              })}
              onClick={() =>
                bindings.onCommit(
                  field,
                  displayValue(key, standard, bindings.locale),
                )
              }
            >
              <RotateCcw className="size-3" />
            </HintButton>
          </div>
        )}
      </div>
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
          t("parameters.units.percent"),
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
  /** Why the typed value was not taken; shown under the field. */
  error?: string;
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
  error,
}: ParameterEditorProps): React.JSX.Element {
  const errorId = `parameter-${field.key}-error`;
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-full min-w-0 flex-1 border-0 px-2 text-right tabular-nums shadow-none focus-visible:ring-0"
        />
        {unit && (
          <span className="shrink-0 whitespace-nowrap pr-2 text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {error ? (
        // Inline, at the field it belongs to (UW-29): toasts piled up and
        // could be read as belonging to another field.
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        readable && (
          <p className="pr-2 text-right text-xs text-muted-foreground tabular-nums">
            = {readable}
          </p>
        )
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

/** Portfolio totals the parameters drive, for the impact bar. */
function portfolioTotals(dealerships: AnalyzedDealership[]): {
  eal: number;
  exposure: number;
  counted: number;
  analyzed: number;
} {
  let eal = 0;
  let exposure = 0;
  for (const d of dealerships) {
    if (!d.risk) continue;
    exposure += d.risk.exposureEur ?? 0;
    if (hasEalBasis(d)) eal += d.risk.eal;
  }
  const { withBasis, analyzed } = ealCoverage(dealerships);
  return { eal, exposure, counted: withBasis, analyzed };
}

function signedPercent(now: number, before: number): string | null {
  if (before <= 0 || Math.abs(now - before) < 0.5) return null;
  const change = ((now - before) / before) * 100;
  return `${change > 0 ? "+" : ""}${change.toFixed(Math.abs(change) < 10 ? 1 : 0)} %`;
}

/**
 * What the values on this page mean for the open portfolio, and how much
 * that moved since the page was opened, so a change is seen, not guessed.
 */
function ImpactBar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const updating = useAppStore((s) => s.parametersUpdating);
  const totals = portfolioTotals(dealerships);
  // Results of an older risk model are not what these values give; they are
  // recalculated with the first change. A change against them would show
  // the model update as the effect of the edit.
  const stale = dealerships.some(
    (d) => d.risk && d.risk.modelVersion !== RISK_MODEL_VERSION,
  );
  const [baseline, setBaseline] = useState({ totals, stale });
  useEffect(() => {
    if (baseline.stale && !stale && !updating)
      setBaseline({ totals, stale: false });
  }, [baseline.stale, stale, updating, totals]);
  if (totals.analyzed === 0) return null;
  const comparable = !baseline.stale && !stale;
  const ealDelta = comparable
    ? signedPercent(totals.eal, baseline.totals.eal)
    : null;
  const exposureDelta = comparable
    ? signedPercent(totals.exposure, baseline.totals.exposure)
    : null;
  return (
    <div
      role="status"
      className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-card/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur"
    >
      <span className="font-medium">
        {stale
          ? t("parameters.impact.titleStale")
          : t("parameters.impact.title")}
      </span>
      <span className="tabular-nums">
        {t("parameters.impact.eal")}{" "}
        <strong>{totals.counted > 0 ? eur(totals.eal) : "–"}</strong>
        {ealDelta && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({ealDelta})
          </span>
        )}
      </span>
      <span className="tabular-nums">
        {t("parameters.impact.exposure")}{" "}
        <strong>{eur(totals.exposure)}</strong>
        {exposureDelta && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({exposureDelta})
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {updating
          ? t("parameters.recalculating")
          : t("parameters.impact.coverage", {
              counted: totals.counted,
              analyzed: totals.analyzed,
            })}
      </span>
    </div>
  );
}

/** Apply a saved parameter set, or save the current values as one. */
function TemplateControls({
  disabled,
}: Readonly<{ disabled: boolean }>): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const updateParameters = useAppStore((s) => s.updateParameters);
  const { templates, parametersOf, save, remove } = useParameterTemplates();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  async function apply(id: string): Promise<void> {
    const next = parametersOf(id);
    if (!next) return;
    const previous = parameters;
    await updateParameters(next);
    notify.success(
      t("parameters.templates.applied", {
        name:
          id === DEFAULT_TEMPLATE_ID ? t("parameters.templates.defaults") : id,
      }),
      {
        action: {
          label: t("parameters.resetUndo"),
          onClick: () => void updateParameters(previous),
        },
      },
    );
  }
  async function confirmSave(): Promise<void> {
    if (!name.trim()) return;
    try {
      await save(name, parameters);
      notify.success(t("parameters.templates.saved", { name: name.trim() }));
      setSaveOpen(false);
      setName("");
    } catch (error) {
      notify.failed(error, t("common.saveFailed"));
    }
  }
  return (
    <>
      <Select
        value=""
        onValueChange={(id) => void apply(id)}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-9 w-52"
          aria-label={t("parameters.templates.apply")}
        >
          <SelectValue placeholder={t("parameters.templates.apply")} />
        </SelectTrigger>
        <SelectContent>
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
      <Button variant="outline" onClick={() => setSaveOpen(true)}>
        <Save className="mr-2 size-4" />
        {t("parameters.templates.save")}
      </Button>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("parameters.templates.saveTitle")}</DialogTitle>
            <DialogDescription>
              {t("parameters.templates.saveDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="parameter-template-name">
              {t("parameters.templates.name")}
            </Label>
            <Input
              id="parameter-template-name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmSave();
              }}
            />
          </div>
          {templates.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {templates.map((tpl) => (
                <li
                  key={tpl.name}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <button
                    type="button"
                    className="min-w-0 truncate text-left hover:underline"
                    onClick={() => setName(tpl.name)}
                  >
                    {tpl.name}
                  </button>
                  <HintButton
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("parameters.templates.delete", {
                      name: tpl.name,
                    })}
                    onClick={() => void remove(tpl.name)}
                  >
                    <Trash2 className="size-3.5" />
                  </HintButton>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!name.trim()} onClick={() => void confirmSave()}>
              {t("parameters.templates.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ParametersPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <PageErrorBoundary
      area="Parameters page"
      title={t("parameters.loadErrorTitle")}
      description={t("parameters.loadErrorDescription")}
      retry={t("parameters.retry")}
    >
      <ParametersContent />
    </PageErrorBoundary>
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
  const [errors, setErrors] = useState<Partial<Record<ParameterKey, string>>>(
    {},
  );
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          displayValue(key as ParameterKey, value, locale),
        ]),
      ),
    );
  }, [parameters, locale]);
  function setError(key: ParameterKey, message?: string): void {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }
  function revertDraft(field: ParameterField): void {
    setError(field.key);
    setDraft((current) => ({
      ...current,
      [field.key]: displayValue(field.key, parameters[field.key], locale),
    }));
  }
  function ruleText(shown: ParameterField): string {
    const field = displayRule(shown);
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
    const error = parameterInputError(raw, displayRule(field), locale);
    if (error) {
      // Keep what was typed and say, at this field, why it was not taken;
      // Escape restores the stored value.
      setError(
        field.key,
        t(`parameters.validation.${error}`, {
          label: fieldLabel(field),
          rule: ruleText(field),
          value: displayValue(field.key, parameters[field.key], locale),
        }),
      );
      return;
    }
    setError(field.key);
    const typed = parseLocaleNumber(raw, locale);
    const value = isPercent(field) ? fromPercentDisplay(typed) : typed;
    // Unchanged ("30000" for 30.000): show it in the usual notation again.
    if (value === parameters[field.key]) {
      revertDraft(field);
      return;
    }
    // One vehicle value on the page: the hidden default follows it.
    const patch = {
      [field.key]: value,
      ...(field.key === "vehicleValueCarEur" &&
      parameters.vehicleValueDefaultEur === parameters.vehicleValueCarEur
        ? { vehicleValueDefaultEur: value }
        : {}),
    } as Partial<RiskParameters>;
    try {
      await updateParameters(patch);
    } catch (err) {
      setError(
        field.key,
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
      notify.info(t("parameters.resetNothing"));
      return;
    }
    setConfirmReset(true);
  }
  async function reset(): Promise<void> {
    setConfirmReset(false);
    const previous = parameters;
    await resetParameters();
    notify.success(t("parameters.resetDone"), {
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
    errors,
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
          <TemplateControls disabled={parametersUpdating} />
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
      <Alert variant="info">
        <AlertTitle>{t("parameters.startHereTitle")}</AlertTitle>
        <AlertDescription>
          {t("parameters.startHereDescription")}
        </AlertDescription>
        <AlertDescription>{t("parameters.fractionHint")}</AlertDescription>
      </Alert>
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
                      {[...recommendedFields, ...advancedFields]
                        .filter((field) => !hiddenField(field, parameters))
                        .map((field) => (
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
                                {parameters[field.key] !==
                                  DEFAULT_RISK_PARAMETERS[field.key] && (
                                  <>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {t("parameters.changedBadge", {
                                        value: `${displayValue(field.key, DEFAULT_RISK_PARAMETERS[field.key], locale)}${isPercent(field) ? " %" : ""}`,
                                      })}
                                    </Badge>
                                    <HintButton
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="size-6"
                                      disabled={parametersUpdating}
                                      aria-label={t("parameters.resetField", {
                                        label: fieldLabel(field),
                                      })}
                                      onClick={() =>
                                        void commitValue(
                                          field,
                                          displayValue(
                                            field.key,
                                            DEFAULT_RISK_PARAMETERS[field.key],
                                            locale,
                                          ),
                                        )
                                      }
                                    >
                                      <RotateCcw className="size-3" />
                                    </HintButton>
                                  </>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {fieldDescription(field)}
                              </p>
                            </div>
                            <ParameterEditor
                              field={field}
                              label={fieldLabel(field)}
                              unit={t(`parameters.units.${unitKey(field)}`)}
                              value={
                                draft[field.key] ??
                                displayValue(
                                  field.key,
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
                              error={errors[field.key]}
                            />
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </NativeDetails>
            </Card>
          );
        })}
      </div>
      <ImpactBar />
      <ResetDialog
        open={confirmReset}
        changedCount={changedFromDefaults}
        onOpenChange={setConfirmReset}
        onConfirm={() => void reset()}
      />
    </div>
  );
}
