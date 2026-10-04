import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Info, Satellite } from "lucide-react";
import { riskLevelColor, type RiskLevel } from "@renderer/lib/riskColor";
import { cn } from "@renderer/lib/utils";
import { sourceColor } from "./BoundaryLayer";
import type { BoundarySource } from "@shared/types";
import {
  IMAGERY_STALE_AFTER_YEARS,
  imageryAgeYears,
  satelliteSensorName,
} from "@shared/imagery-metadata";
import type { ImagerySelection } from "@shared/imagery-sources";

const RISK_LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "EXTREME"];

const SOURCES: Array<{
  source: BoundarySource;
  labelKey?: string;
  label?: string;
}> = [
  { source: "alkis", label: "ALKIS" },
  { source: "osm", label: "OSM" },
  { source: "overture", label: "Overture" },
  { source: "aerial", label: "Aerial surface" },
  { source: "synthetic", labelKey: "map.legend.estimated" },
  { source: "manual", labelKey: "map.legend.manual" },
];

/**
 * Karten-Legende: Risiko-Skala, Grenzquellen, Fahrzeugklassen und die
 * Metadaten des Satellitenbilds mit den wichtigsten Angaben auf der ersten
 * Ebene und weiteren Details hinter einer zweiten Aufklappstufe.
 */
export function MapLegend({
  imagery,
  showImagery = false,
}: Readonly<{
  /** Metadata at the map centre; null while the first lookup is pending. */
  imagery?: ImagerySelection | null;
  /** Whether the satellite basemap is active (the section is hidden otherwise). */
  showImagery?: boolean;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="glass w-64 rounded-lg border shadow-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold"
        aria-expanded={open}
      >
        <Info className="size-4" />
        {t("map.legend.title")}
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2.5 text-xs">
          <LegendGroup title={t("map.legend.risk")}>
            {RISK_LEVELS.map((lvl) => (
              <LegendRow
                key={lvl}
                color={riskLevelColor(lvl)}
                label={t(`risk.${lvl}`)}
              />
            ))}
          </LegendGroup>
          <LegendGroup title={t("map.legend.boundarySource")}>
            {SOURCES.map((s) => (
              <LegendRow
                key={s.source}
                color={sourceColor(s.source)}
                label={s.labelKey ? t(s.labelKey) : s.label!}
                outline
              />
            ))}
          </LegendGroup>
          <LegendGroup title={t("map.legend.vehicles")}>
            <LegendRow
              color="#2563eb"
              label={t("map.legend.carCategory")}
              dot
            />
          </LegendGroup>
          {showImagery && (
            <div className="border-t pt-2">
              <ImageryDetails selection={imagery ?? null} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Source, capture metadata and selection reason of the image at the map centre. */
function ImageryDetails({
  selection,
}: Readonly<{ selection: ImagerySelection | null }>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const title = (
    <div className="mb-1 flex items-center gap-1 font-semibold text-muted-foreground">
      <Satellite className="size-3.5" />
      {t("map.legend.imageryTitle")}
    </div>
  );

  if (!selection) {
    return (
      <div>
        {title}
        <div className="text-muted-foreground">
          {t("map.legend.imageryLoading")}
        </div>
      </div>
    );
  }
  const chosen = selection.chosen;

  // Non-breaking space keeps value and unit on one line in the narrow legend.
  const meters = (value: number): string =>
    `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value)}\u00a0m`;
  // dateStyle "medium" is unambiguous in every UI language (no 02/04 vs 04/02).
  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));
  const ageYears = chosen.capturedAt
    ? imageryAgeYears(chosen.capturedAt)
    : null;
  const stale = ageYears != null && ageYears >= IMAGERY_STALE_AFTER_YEARS;
  const esri = chosen.kind === "esri" ? chosen.esri : undefined;
  const sensor = esri ? satelliteSensorName(esri.description) : null;
  const resolution =
    chosen.resolutionM == null
      ? null
      : esri?.mosaicResolutionM != null &&
          esri.mosaicResolutionM !== chosen.resolutionM
        ? t("map.legend.imageryResolutionMosaic", {
            native: meters(chosen.resolutionM),
            mosaic: meters(esri.mosaicResolutionM),
          })
        : meters(chosen.resolutionM);
  const zoomRange =
    esri?.minZoom != null && esri.maxZoom != null
      ? t("map.legend.imageryZoomRange", {
          zoom: chosen.zoom,
          min: esri.minZoom,
          max: esri.maxZoom,
        })
      : String(chosen.zoom);
  const alternatives = selection.candidates.filter((c) => c.id !== chosen.id);

  return (
    <div>
      {title}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <MetaRow label={t("map.legend.imageryDate")}>
          <span
            className={cn(
              "font-semibold",
              stale && "text-amber-600 dark:text-amber-400",
            )}
          >
            {chosen.capturedAt
              ? formatDate(chosen.capturedAt)
              : t("map.legend.imageryUnknown")}
          </span>
          {stale && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              ({t("map.legend.imageryAge", { count: ageYears })})
            </span>
          )}
        </MetaRow>
        <MetaRow label={t("map.legend.imagerySourceLabel")}>
          {chosen.label}
        </MetaRow>
      </dl>
      <details className="mt-1 rounded-md border bg-muted/20">
        <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
          {t("map.legend.imageryMoreDetails")}
        </summary>
        <div className="space-y-1 border-t px-2 py-2">
          {chosen.kind === "custom" ? (
            <p className="text-muted-foreground">
              {t("map.legend.imageryNoMetadataWms")}
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              {esri?.source && (
                <MetaRow label={t("map.legend.imagerySource")}>
                  {esri.source}
                </MetaRow>
              )}
              {esri?.description && esri.description !== esri.collection && (
                <MetaRow
                  label={t(
                    sensor
                      ? "map.legend.imagerySensor"
                      : "map.legend.imageryDescription",
                  )}
                >
                  {sensor
                    ? `${sensor} (${esri.description})`
                    : esri.description}
                </MetaRow>
              )}
              {resolution && (
                <MetaRow label={t("map.legend.imageryResolution")}>
                  {resolution}
                </MetaRow>
              )}
              {esri?.accuracyM != null && (
                <MetaRow label={t("map.legend.imageryAccuracy")}>
                  {`±\u00a0${meters(esri.accuracyM)}`}
                </MetaRow>
              )}
              <MetaRow label={t("map.legend.imageryZoom")}>{zoomRange}</MetaRow>
              {chosen.dateSource !== "none" && (
                <MetaRow label={t("map.legend.imageryDateSource")}>
                  {t(`map.legend.imageryDateSources.${chosen.dateSource}`)}
                </MetaRow>
              )}
              {esri?.release && (
                <MetaRow label={t("map.legend.imageryRelease")}>
                  {esri.release}
                </MetaRow>
              )}
              {chosen.kind === "state-dop" && (
                <MetaRow label={t("map.legend.imageryAttribution")}>
                  {chosen.attribution}
                </MetaRow>
              )}
              <MetaRow label={t("map.legend.imagerySelection")}>
                {t(`map.legend.imageryReasons.${selection.reason}`)}
              </MetaRow>
            </dl>
          )}
          {alternatives.length > 0 && (
            <div className="mt-1">
              <div className="text-muted-foreground">
                {t("map.legend.imageryAlternatives")}
              </div>
              <ul className="space-y-0.5">
                {alternatives.map((c) => (
                  <li key={c.id} className="break-words">
                    {c.label}:{" "}
                    {c.capturedAt
                      ? formatDate(c.capturedAt)
                      : t("map.legend.imageryUnknown")}
                    {c.resolutionM != null && ` · ${meters(c.resolutionM)}`}
                    {c.note && (
                      <span className="text-muted-foreground"> ({c.note})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {t("map.legend.imageryHint")}
          </p>
        </div>
      </details>
    </div>
  );
}

function MetaRow({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>): React.JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function LegendGroup({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 font-semibold text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">{children}</div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  outline,
  dot,
}: Readonly<{
  color: string;
  label: string;
  outline?: boolean;
  dot?: boolean;
}>): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={dot ? "size-2 rounded-full" : "size-3 rounded-sm"}
        style={
          outline
            ? { border: `2px solid ${color}`, backgroundColor: `${color}33` }
            : { backgroundColor: color }
        }
      />
      {label}
    </div>
  );
}
