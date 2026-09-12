import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Info, Loader2, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { RiskParameters } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Card } from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import { Slider } from "@renderer/components/ui/slider";

type ParameterKey = keyof RiskParameters;
type ParameterField = {
  key: ParameterKey;
  label: string;
  description: string;
  unit: string;
  min: number;
  max?: number;
  step: number;
  recommended?: boolean;
  tip?: string;
};

type ParameterGroup = {
  title: string;
  description: string;
  fields: ParameterField[];
  defaultOpen?: boolean;
};

const GROUPS: ParameterGroup[] = [
  {
    title: "Exposition & Kapazität",
    description: "Werte und Flächenannahmen, die die finanzielle Exposition bestimmen.",
    defaultOpen: true,
    fields: [
      { key: "vehicleValueCarEur", label: "Fahrzeugwert Pkw", description: "Durchschnittlicher Wert pro Pkw.", unit: "€", min: 0, step: 1000, recommended: true, tip: "Anpassen, wenn der typische Fahrzeugmix deutlich vom Standardwert abweicht." },
      { key: "vehicleValueVanEur", label: "Fahrzeugwert Transporter", description: "Durchschnittlicher Wert pro Transporter.", unit: "€", min: 0, step: 1000 },
      { key: "vehicleValueTruckEur", label: "Fahrzeugwert Lkw", description: "Durchschnittlicher Wert pro Lkw.", unit: "€", min: 0, step: 1000 },
      { key: "vehicleValueBusEur", label: "Fahrzeugwert Bus", description: "Durchschnittlicher Wert pro Bus.", unit: "€", min: 0, step: 1000 },
      { key: "vehicleValueDefaultEur", label: "Standard-Fahrzeugwert", description: "Fallback, wenn keine Klasse bekannt ist.", unit: "€", min: 0, step: 1000 },
      { key: "capacitySqmPerVehicle", label: "Fläche pro Fahrzeug", description: "Annahme für die Grundstücks-Kapazität.", unit: "m²", min: 0.1, step: 1, recommended: true, tip: "Der wichtigste Hebel für die geschätzte Kapazität, wenn keine verlässliche Fahrzeugzählung vorliegt." },
    ],
  },
  {
    title: "Risiko & EAL",
    description: "Schadenquoten und Eintrittswahrscheinlichkeiten für die EAL-Berechnung.",
    defaultOpen: true,
    fields: [
      { key: "hailDamageFraction", label: "Hagelschadenquote", description: "Schadenanteil je getroffenem Ereignis.", unit: "Anteil", min: 0, max: 1, step: 0.01, recommended: true, tip: "Schätzt, welcher Anteil der exponierten Fahrzeugwerte bei einem Treffer beschädigt wird." },
      { key: "hailSiteHitProbability", label: "Hagel-Treffwahrscheinlichkeit", description: "Wahrscheinlichkeit, dass der Standort getroffen wird.", unit: "Anteil", min: 0, max: 1, step: 0.01, recommended: true, tip: "Nur anpassen, wenn eigene Schadenhistorie oder ein anderes Gefahrenmodell vorliegt." },
      { key: "climateLoadingFactor", label: "Klimaaufschlag", description: "Multiplikativer Aufschlag auf die Hagelfrequenz.", unit: "Anteil", min: 0, step: 0.01, recommended: true, tip: "Erhöht die modellierte Hagelfrequenz; 0,15 entspricht einem Aufschlag von 15 %." },
      { key: "windStormThresholdKmh", label: "Sturmschwelle", description: "Ab dieser Windgeschwindigkeit wird Windschaden modelliert.", unit: "km/h", min: 0, step: 1 },
      { key: "windDamageFraction", label: "Wind-Schadenquote", description: "Schadenanteil pro modelliertem Sturmtag.", unit: "Anteil", min: 0, max: 1, step: 0.01, recommended: true, tip: "Beschreibt die durchschnittliche Schadenhöhe an einem als Sturm gewerteten Tag." },
      { key: "windSiteHitProbability", label: "Wind-Treffwahrscheinlichkeit", description: "Standortwahrscheinlichkeit für Windschaden.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "lightningDamageFraction", label: "Blitz-Schadenquote", description: "Schadenanteil je Blitzereignis.", unit: "Anteil", min: 0, max: 1, step: 0.001 },
      { key: "lightningDensityScale", label: "Blitzdichte-Skalierung", description: "Umrechnung der Blitzdichte in die EAL.", unit: "Faktor", min: 0, step: 0.0001 },
      { key: "snowLoadDamageFractionPer30cm", label: "Schneelastquote je 30 cm", description: "Schadenanteil pro 30 cm Schneehöhe.", unit: "Anteil", min: 0, max: 1, step: 0.001 },
      { key: "floodDamageHq10", label: "Hochwasserquote HQ10", description: "Schadenquote im 10-jährlichen Proxy-Szenario.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "floodDamageHq100", label: "Hochwasserquote HQ100", description: "Schadenquote im 100-jährlichen Proxy-Szenario.", unit: "Anteil", min: 0, max: 1, step: 0.01, recommended: true, tip: "Nur ändern, wenn für die betrachteten Standorte belastbare Hochwasserannahmen vorliegen." },
      { key: "floodDamageHqExtrem", label: "Hochwasserquote Extrem", description: "Schadenquote im extremen Proxy-Szenario.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "heatHotdaysScoreMax", label: "Hitzetage für Score 100", description: "Anzahl heißer Tage für den maximalen Hitze-Score.", unit: "Tage/Jahr", min: 1, step: 1 },
      { key: "heatDamageFractionPerHotday", label: "Hitzequote je Hitzetag", description: "Schadenanteil pro heißem Tag.", unit: "Anteil", min: 0, max: 1, step: 0.0001 },
    ],
  },
  {
    title: "Peril-Scores",
    description: "Grenzwerte, ab denen Messwerte einen maximalen Gefahren-Score erreichen.",
    fields: [
      { key: "windScoreMaxKmh", label: "Wind bei Score 100", description: "Windgeschwindigkeit für den maximalen Wind-Score.", unit: "km/h", min: 1, step: 1, recommended: true, tip: "Sinnvoll, wenn der Score an ein eigenes internes Schwellenmodell angepasst werden soll." },
      { key: "lightningScoreMaxDensity", label: "Blitzdichte bei Score 100", description: "Blitzdichte für den maximalen Blitz-Score.", unit: "Schläge/km²/Jahr", min: 0.1, step: 0.1 },
      { key: "snowScoreMaxCm", label: "Schnee bei Score 100", description: "Schneehöhe für den maximalen Schnee-Score.", unit: "cm", min: 1, step: 1 },
      { key: "floodScoreMaxAnnualPrecipMm", label: "Niederschlag bei Score 100", description: "Jahresniederschlag für den maximalen Hochwasser-Score.", unit: "mm/Jahr", min: 1, step: 50, recommended: true, tip: "Definiert, bei welchem Jahresniederschlag der Hochwasser-Score den Höchstwert erreicht." },
    ],
  },
  {
    title: "Portfolio, PML & Szenarien",
    description: "Konzentrationsrisiken, Rückversicherung und Stressszenarien auf Portfolioebene.",
    fields: [
      { key: "pmlDamageFraction10", label: "PML-Schadenquote 10 Jahre", description: "Schadenquote für das 10-Jahres-PML.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "pmlDamageFraction50", label: "PML-Schadenquote 50 Jahre", description: "Schadenquote für das 50-Jahres-PML.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "pmlDamageFraction100", label: "PML-Schadenquote 100 Jahre", description: "Schadenquote für das 100-Jahres-PML.", unit: "Anteil", min: 0, max: 1, step: 0.01, recommended: true, tip: "Die wichtigste PML-Annahme für ein seltenes, aber schweres Ereignis." },
      { key: "pmlClusterRadiusKm", label: "PML-Cluster-Radius", description: "Radius für die größte PML-Exposition.", unit: "km", min: 0.1, step: 5 },
      { key: "accumulationRadiusKm", label: "Akkumulationsradius", description: "Entfernung, in der Standorte zusammengefasst werden.", unit: "km", min: 0.1, step: 1, recommended: true, tip: "Legt fest, ab welcher Nähe mehrere Standorte als ein Konzentrationsrisiko betrachtet werden." },
      { key: "accumulationReinsureThresholdEur", label: "Rückversicherungs-Schwelle", description: "Ab dieser akkumulierten Exposition wird Rückversicherung empfohlen.", unit: "€", min: 0, step: 1000000, recommended: true, tip: "Dient als organisatorischer Schwellenwert für die Rückversicherungswarnung." },
      { key: "scenarioDamageLow", label: "Szenarioquote Niedrig", description: "Schadenquote im niedrigen Stressszenario.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "scenarioDamageMedium", label: "Szenarioquote Mittel", description: "Schadenquote im mittleren Stressszenario.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "scenarioDamageHigh", label: "Szenarioquote Hoch", description: "Schadenquote im hohen Stressszenario.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "scenarioDamageExtreme", label: "Szenarioquote Extrem", description: "Schadenquote im extremen Stressszenario.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Warnungen & Datenqualität",
    description: "Schwellenwerte für Hinweise, Prüfbedarf und die Qualität automatischer Ergebnisse.",
    fields: [
      { key: "alertExtremeScore", label: "Warnschwelle Risiko-Score", description: "Ab diesem Score wird ein kritischer Hinweis erzeugt.", unit: "von 100", min: 0, max: 100, step: 1, recommended: true, tip: "Niedriger = mehr Warnungen; höher = nur die kritischsten Standorte hervorheben." },
      { key: "alertOvercapacity", label: "Warnschwelle Überkapazität", description: "Auslastung oberhalb dieses Faktors erzeugt einen Hinweis.", unit: "Faktor", min: 0, step: 0.05, recommended: true, tip: "1,0 entspricht 100 % Auslastung. Werte über 1,0 erlauben den entsprechenden Puffer." },
      { key: "alertLowBoundaryConfidence", label: "Warnschwelle Boundary-Konfidenz", description: "Darunter gilt die Grundstücksgrenze als unsicher.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "alertEalPortfolioShare", label: "Warnschwelle EAL-Anteil", description: "Portfolioanteil, ab dem ein Standort hervorgehoben wird.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "boundaryReviewConfidence", label: "Boundary-Review-Konfidenz", description: "Unterhalb dieser Konfidenz ist eine Prüfung erforderlich.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "boundaryReviewTop2Margin", label: "Boundary-Review Top-2-Abstand", description: "Mindestabstand zwischen bestem und zweitbestem Kandidaten.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "boundaryReviewSourceAgreement", label: "Boundary-Review Quellenübereinstimmung", description: "Mindestübereinstimmung unabhängiger Geometrien.", unit: "Anteil", min: 0, max: 1, step: 0.01 },
      { key: "boundaryNearPointDistanceM", label: "Boundary-Nähe zum Referenzpunkt", description: "Maximale Distanz für die Relation nahe.", unit: "m", min: 0, step: 5 },
      { key: "syntheticBoundaryRadiusM", label: "Synthetischer Boundary-Radius", description: "Fallback-Radius, wenn keine Geometrie verfügbar ist.", unit: "m", min: 1, step: 10 },
      { key: "detectionConfidence", label: "Erkennungs-Konfidenz", description: "Mindestkonfidenz des Fahrzeugmodells.", unit: "Anteil", min: 0, max: 1, step: 0.01, recommended: true, tip: "Niedriger findet mehr Fahrzeuge, kann aber mehr Fehlalarme erzeugen; höher ist konservativer." },
    ],
  },
];

function displayValue(value: number): string {
  return String(value);
}

type ParameterEditorProps = {
  field: ParameterField;
  value: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onCommit: (value: number) => void;
};

function ParameterEditor({
  field,
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
            aria-label={field.label}
            min={field.min}
            max={field.max}
            step={field.step}
            value={sliderValue}
            onValueChange={(nextValue) => onDraftChange(String(nextValue))}
            onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
            onKeyUp={(event) => {
              if (event.key === "Enter" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
                onCommit(Number(event.currentTarget.value));
              }
            }}
            disabled={disabled}
            className="min-w-0 flex-1"
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
            {field.max === 1 ? `${Math.round(sliderValue * 100)}%` : Math.round(sliderValue)}
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
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          disabled={disabled}
          className="pr-16 text-right tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{field.unit}</span>
      </div>
    </div>
  );
}

export function ParametersPage(): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const parametersUpdating = useAppStore((s) => s.parametersUpdating);
  const updateParameters = useAppStore((s) => s.updateParameters);
  const resetParameters = useAppStore((s) => s.resetParameters);
  const saveSession = useAppStore((s) => s.saveSession);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDraft(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, displayValue(value)])));
  }, [parameters]);

  const fieldCount = useMemo(() => GROUPS.reduce((sum, group) => sum + group.fields.length, 0), []);

  async function commitValue(field: ParameterField, value: number): Promise<void> {
    if (!Number.isFinite(value) || value < field.min || (field.max != null && value > field.max)) {
      setDraft((current) => ({ ...current, [field.key]: String(parameters[field.key]) }));
      return;
    }
    if (value === parameters[field.key]) return;
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 text-primary" />
            <h2 className="text-2xl font-semibold">{t("parameters.title")}</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("parameters.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/60 p-2">
          <Badge variant="outline">{fieldCount} {t("parameters.fields")}</Badge>
          {parametersUpdating && <Badge variant="secondary"><Loader2 className="mr-1 size-3 animate-spin" />{t("parameters.recalculating")}</Badge>}
          {!parametersUpdating && lastSavedAt && <Badge variant="secondary">{t("parameters.autosaved")}</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => void reset()} disabled={parametersUpdating}>
              <RotateCcw className="mr-2 size-4" />{t("parameters.reset")}
            </Button>
            <Button onClick={() => void save()} disabled={parametersUpdating}>
              <Save className="mr-2 size-4" />{t("common.save")}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-medium">{t("parameters.startHereTitle")}</p>
          <p className="text-muted-foreground">{t("parameters.startHereDescription")}</p>
          <p className="text-xs text-muted-foreground">{t("parameters.fractionHint")}</p>
        </div>
      </div>

      <div className="space-y-4">
        {GROUPS.map((group) => {
          const recommendedFields = group.fields.filter((field) => field.recommended);
          const advancedFields = group.fields.filter((field) => !field.recommended);
          const isOpen = openGroups[group.title] ?? group.defaultOpen ?? false;

          return (
            <Card key={group.title} className="overflow-hidden">
              <details
                open={isOpen}
                onToggle={(event) => setOpenGroups((current) => ({ ...current, [group.title]: event.currentTarget.open }))}
              >
                <summary className="group flex cursor-pointer list-none items-start gap-3 p-5 [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{group.title}</span>
                      {recommendedFields.length > 0 && <Badge variant="secondary" className="text-[10px]">{recommendedFields.length} {t("parameters.recommended")}</Badge>}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">{group.description}</span>
                  </span>
                </summary>
                <div className="space-y-4 px-5 pb-5">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {recommendedFields.map((field) => (
                      <div key={field.key} className="rounded-lg border border-primary/15 bg-primary/[0.03] p-4">
                        <div className="mb-3 min-w-0">
                          <label htmlFor={`parameter-${field.key}`} className="text-sm font-medium">{field.label}</label>
                          <p className="text-xs text-muted-foreground">{field.description}</p>
                        </div>
                        <ParameterEditor
                          field={field}
                          value={draft[field.key] ?? String(parameters[field.key])}
                          onDraftChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                          onCommit={(value) => commitValue(field, value)}
                          disabled={parametersUpdating}
                        />
                        {field.tip && <p className="mt-3 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Wofür?</span> {field.tip}</p>}
                      </div>
                    ))}
                  </div>
                  {advancedFields.length > 0 && (
                    <details className="rounded-lg border bg-muted/20">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="size-4 text-muted-foreground" />
                        {t("parameters.advancedParameters")} <span className="font-normal text-muted-foreground">({advancedFields.length})</span>
                      </summary>
                      <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
                        {advancedFields.map((field) => (
                          <div key={field.key} className="grid gap-2 sm:grid-cols-[1fr_160px] sm:items-center">
                            <div className="min-w-0">
                              <label htmlFor={`parameter-${field.key}`} className="text-sm font-medium">{field.label}</label>
                              <p className="text-xs text-muted-foreground">{field.description}</p>
                            </div>
                            <ParameterEditor
                              field={field}
                              value={draft[field.key] ?? String(parameters[field.key])}
                              onDraftChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                              onCommit={(value) => commitValue(field, value)}
                              disabled={parametersUpdating}
                            />
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
