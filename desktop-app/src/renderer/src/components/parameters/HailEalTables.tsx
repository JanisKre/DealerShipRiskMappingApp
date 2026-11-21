import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, TriangleAlert } from "lucide-react";
import type { RiskParameters } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { meanHailSeverityEur } from "@shared/risk-math";
import { eur } from "@renderer/lib/format";
import { HintButton } from "@renderer/components/ui/hint-button";
import {
  formatParameterValue,
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
import {
  GROUPS,
  type ParameterField,
  type ParameterKey,
  displayValue,
} from "./parameterFields";
import { ParameterEditor } from "./ParameterEditor";

/** Hail EAL parameters: the notice on placeholder values and the per-zone tables. */

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
export function HailEalNotice({
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

export type EditorBindings = {
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
export function HailEalTables({
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
