import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import {
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Save,
  StickyNote,
  Tag,
} from "lucide-react";
import area from "@turf/area";
import type {
  AnalyzedDealership,
  BoundaryResult,
  EalBreakdown,
  OsmDetails,
  StructuredMemo,
} from "@shared/types";
import { asPolygon, outerRings } from "@shared/boundary-geometry-utils";
import { DEALERSHIP_NOTES_MAX_LENGTH } from "@shared/constants";
import { sourceLabel } from "@shared/natcat-catalog";
import { boundarySourceLabel } from "@renderer/lib/boundarySource";
import { LlmErrorMessage } from "@renderer/components/ai/LlmSetupNotice";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Separator } from "@renderer/components/ui/separator";
import { Switch } from "@renderer/components/ui/switch";
import { Textarea } from "@renderer/components/ui/textarea";
import { useAppStore } from "@renderer/store/appStore";
import { eur, num, pct } from "@renderer/lib/format";
import { riskColor } from "@renderer/lib/riskColor";
import { UnderwritingMessages } from "./UnderwritingMessages";
import { DetectionImageryNote } from "./DetectionImageryNote";

/**
 * Detail dialog for a location: area/capacity/utilisation, EAL breakdown
 * per peril, boundary source, and on-demand AI (structured memo + boundary
 * refinement). Controlled via `open`/`onOpenChange`.
 */
export function DealershipDetailDialog({
  dealership,
  open,
  onOpenChange,
}: {
  dealership: AnalyzedDealership | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
        {dealership && <DetailBody d={dealership} />}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const score = d.risk?.overallScore ?? 0;
  const hailScore =
    d.risk?.perils.find((peril) => peril.peril === "hail")?.score ?? score;
  const [showAdditionalScores, setShowAdditionalScores] = useState(false);
  const eb = d.risk?.ealBreakdown;
  const { details: osmDetails, loading: osmLoading } = useOsmDetails(
    d.lat,
    d.lon,
    d.name,
    d.address,
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {d.name}
          <Badge style={{ backgroundColor: riskColor(score), color: "white" }}>
            {t("dashboard.detailDialog.hailScoreLabel")} ·{" "}
            {hailScore.toFixed(0)}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {d.address ?? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`}
        </DialogDescription>
      </DialogHeader>

      <QuickLinksRow d={d} website={osmDetails?.website} />

      <OsmDetailsSection details={osmDetails} loading={osmLoading} />

      <PortfolioMetaSection d={d} />

      <NotesSection d={d} />

      <NatCatSection d={d} />

      <UnderwritingMessages d={d} />

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Metric
          label={t("dashboard.detailDialog.machineVehicleCount")}
          value={num(d.detection?.vehicleCount)}
        />
        <ManualVehicleCountEditor d={d} />
        <Metric
          label={t("dashboard.capacity")}
          value={num(d.risk?.capacityEstimate)}
        />
        <Metric
          label={t("dashboard.utilisation")}
          value={pct(d.risk?.utilisation, 0)}
        />
        <Metric
          label={t("dashboard.area")}
          value={`${num(d.boundary?.areaSqm)} m²`}
        />
        <Metric
          label={t("dashboard.detailDialog.exposureLabel")}
          value={eur(d.risk?.exposureEur)}
        />
        <Metric
          label={t("dashboard.detailDialog.totalEalLabel")}
          value={eur(d.risk?.eal)}
        />
      </div>

      <DetectionImageryNote detection={d.detection} />

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">
            {t("dashboard.detailDialog.mainScoreTitle")}
          </h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => setShowAdditionalScores((visible) => !visible)}
          >
            {showAdditionalScores
              ? t("dashboard.detailDialog.hideAdditionalScores")
              : t("dashboard.detailDialog.showAdditionalScores")}
            <ChevronDown
              className={`size-3.5 transition-transform ${showAdditionalScores ? "rotate-180" : ""}`}
            />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1">
            <span>{t("dashboard.detailDialog.hailScoreLabel")}</span>
            <span className="font-mono" style={{ color: riskColor(hailScore) }}>
              {hailScore.toFixed(0)}
            </span>
          </Badge>
          {showAdditionalScores &&
            d.risk?.perils
              .filter((peril) => peril.peril !== "hail")
              .map((p) => (
                <Badge key={p.peril} variant="outline" className="gap-1">
                  <span>{t(`dashboard.detailDialog.ealPeril.${p.peril}`)}</span>
                  <span
                    className="font-mono"
                    style={{ color: riskColor(p.score) }}
                  >
                    {p.score.toFixed(0)}
                  </span>
                </Badge>
              ))}
        </div>

        {d.hailZone != null && (
          <div className="flex items-center gap-2 rounded-md border bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/20">
            <span className="text-lg">🌨</span>
            <div>
              <span className="font-semibold">
                {t("dashboard.detailDialog.hailZoneLabel", {
                  zone: d.hailZone,
                })}
              </span>
              <span className="ml-2 text-muted-foreground">
                {t("dashboard.detailDialog.hailZoneKasko", {
                  tier: d.hailRiskTier,
                })}
              </span>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {t("dashboard.detailDialog.hailZoneScore", {
                score: (((d.hailZone - 1) / 5) * 100).toFixed(0),
              })}
            </div>
          </div>
        )}
      </div>

      {eb && <HailEalSection eb={eb} />}

      <BoundarySummary d={d} />

      <ModelConfidenceSummary d={d} />

      <Separator />

      <AiSection d={d} />
    </>
  );
}

/** Shows how the hail EAL was derived: N × λ_z × S̄, with each input's source. */
function HailEalSection({
  eb,
}: Readonly<{ eb: EalBreakdown }>): React.JSX.Element {
  const { t } = useTranslation();
  const detail = eb.hailDetail;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">
        {t("dashboard.hailEalDetail.title")}
      </h4>
      {detail ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Metric
              label={t("dashboard.hailEalDetail.vehicles")}
              value={t("dashboard.hailEalDetail.vehiclesValue", {
                exposed: num(detail.exposedVehicles),
                total: num(detail.vehicles),
              })}
            />
            <Metric
              label={t("dashboard.hailEalDetail.frequency")}
              value={t("dashboard.hailEalDetail.frequencyValue", {
                frequency: num(detail.frequency, 3),
                zone: detail.zone,
              })}
            />
            <Metric
              label={t("dashboard.hailEalDetail.severity")}
              value={eur(detail.meanSeverityEur)}
            />
            <Metric label={t("dashboard.hailEal")} value={eur(eb.hail)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("dashboard.hailEalDetail.formula", {
              exposed: num(detail.exposedVehicles),
              frequency: num(detail.frequency, 3),
              severity: eur(detail.meanSeverityEur),
              eal: eur(eb.hail),
            })}{" "}
            {t(`dashboard.hailEalDetail.vehicleSource.${detail.vehicleSource}`)}{" "}
            {t(`dashboard.hailEalDetail.zoneSource.${detail.zoneSource}`)}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.hailEalDetail.legacy", { eal: eur(eb.total) })}
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

/** Human-readable label for a raw boundary role code, falling back to it verbatim. */
function boundaryRoleLabel(t: TFunction, role: string | undefined): string {
  if (!role) return "";
  return t(`dashboard.detailDialog.boundaryRole.${role}`, {
    defaultValue: role,
  });
}

/**
 * Drops every extra `MultiPolygon` part except the largest, producing a
 * plain `Polygon` (docs/boundary-improvement-plan.de.md P6 — a reviewer
 * rejecting a separately-confirmed component, P3, should not have to
 * redraw the whole site by hand).
 */
function withoutExtraComponents(boundary: BoundaryResult): BoundaryResult {
  if (boundary.polygon.type !== "MultiPolygon") return boundary;
  const rings = outerRings(boundary.polygon);
  const largest = rings.reduce((best, ring) =>
    Math.abs(area(asPolygon(ring) as never)) >
    Math.abs(area(asPolygon(best) as never))
      ? ring
      : best,
  );
  const polygon = asPolygon(largest);
  let areaSqm = boundary.areaSqm;
  try {
    areaSqm = area(polygon as never);
  } catch {
    // Area stays unchanged on error.
  }
  return { ...boundary, source: "manual", polygon, areaSqm };
}

/**
 * Boundary provenance: one always-visible summary line (source, confidence,
 * a review badge when needed) plus every other technical detail — role,
 * source agreement, alternative candidates — behind a single "Show details"
 * disclosure. The data itself isn't reduced, just not all shown at once.
 */
function BoundarySummary({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const boundary = d.boundary;
  const hasDetails =
    !!boundary?.role ||
    !!boundary?.quality ||
    boundary?.polygon.type === "MultiPolygon" ||
    (boundary?.candidates?.length ?? 0) > 1;

  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">
          {t("dashboard.detailDialog.boundaryTitle")}
        </h4>
        {boundary?.reviewRequired && (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            {t("dashboard.detailDialog.boundaryReviewLabel")}
          </Badge>
        )}
      </div>
      <p className="text-muted-foreground">
        {t("dashboard.detailDialog.boundarySummary", {
          source: boundarySourceLabel(t, boundary?.source),
          confidence: pct(boundary?.confidence, 0),
        })}
      </p>
      {hasDetails && (
        <details className="rounded-md border bg-muted/20 text-xs">
          <summary className="cursor-pointer px-2 py-1.5 font-medium text-muted-foreground">
            {t("dashboard.detailDialog.showDetails")}
          </summary>
          <div className="space-y-1.5 border-t px-2 py-2 text-muted-foreground">
            {boundary?.role && (
              <div>
                {t("dashboard.detailDialog.boundaryRoleLabel", {
                  role: boundaryRoleLabel(t, boundary.role),
                })}
              </div>
            )}
            {boundary?.quality && (
              <div>
                {t("dashboard.detailDialog.boundaryAgreementLabel", {
                  agreement: pct(boundary.quality.sourceAgreement, 0),
                })}
              </div>
            )}
            {boundary?.quality?.usedEngine && (
              <div>
                {t("dashboard.detailDialog.boundaryEngineLabel", {
                  engine: t(
                    `dashboard.detailDialog.boundaryEngine.${boundary.quality.usedEngine}`,
                  ),
                })}
                {boundary.quality.requestedEngine &&
                  boundary.quality.requestedEngine !==
                    boundary.quality.usedEngine && (
                    <span>
                      {" "}
                      {t(
                        "dashboard.detailDialog.boundaryEngineFallbackSuffix",
                        {
                          requested: t(
                            `dashboard.detailDialog.boundaryEngine.${boundary.quality.requestedEngine}`,
                          ),
                          reason:
                            boundary.quality.fallbackReason ??
                            t(
                              "dashboard.detailDialog.boundaryEngineUnknownReason",
                            ),
                        },
                      )}
                    </span>
                  )}
              </div>
            )}
            {boundary?.polygon.type === "MultiPolygon" && (
              <div className="flex items-center justify-between gap-2 border-t pt-1.5">
                <span>
                  {t("dashboard.detailDialog.boundaryMultiPartLabel", {
                    count: boundary.polygon.coordinates.length,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  onClick={() =>
                    void useAppStore
                      .getState()
                      .updateBoundaryAndRescore(
                        d.id,
                        withoutExtraComponents(boundary),
                      )
                  }
                >
                  {t("dashboard.detailDialog.boundaryExcludePartAction")}
                </Button>
              </div>
            )}
            {boundary?.candidates && boundary.candidates.length > 1 && (
              <div className="space-y-1 border-t pt-1.5">
                <div className="font-medium text-foreground">
                  {t("dashboard.detailDialog.boundaryCandidatesTitle", {
                    count: boundary.candidates.length,
                  })}
                </div>
                {boundary.candidates.slice(0, 5).map((candidate, index) => (
                  <div
                    key={`${candidate.source}-${candidate.label ?? "candidate"}-${index}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {candidate.label ??
                        boundarySourceLabel(t, candidate.source)}
                    </span>
                    <span className="shrink-0">
                      {num(candidate.areaSqm)} m² ·{" "}
                      {pct(candidate.confidence, 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Risk-model provenance: confidence at a glance, with the full limitations
 * and evidence-source list (required to stay reproducible/source-aware)
 * behind a single "Show details" disclosure rather than always spelled out.
 */
function ModelConfidenceSummary({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!d.risk) return null;
  const limitations = d.risk.limitations ?? [];
  const evidence = d.risk.evidence ?? [];
  const hasDetails = limitations.length > 0 || evidence.length > 0;

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{t("ui.modelConfidence")}</span>
        <span className="text-muted-foreground">
          {pct(d.risk.confidence, 0)}
        </span>
      </div>
      {hasDetails && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            {t("dashboard.detailDialog.showDetails")}
          </summary>
          <div className="mt-1.5 space-y-2 border-t pt-2">
            {d.risk.modelVersion && (
              <div className="text-muted-foreground">
                {t("dashboard.detailDialog.modelVersionLabel", {
                  version: d.risk.modelVersion,
                })}
              </div>
            )}
            {limitations.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                {limitations.map((limitation) => (
                  <li key={limitation}>{localizedRiskText(t, limitation)}</li>
                ))}
              </ul>
            )}
            {evidence.length > 0 && (
              <div className="space-y-1 border-t pt-1.5 text-muted-foreground">
                {evidence.map((item) => (
                  <div key={`${item.source}-${item.method}`}>
                    {localizedRiskText(t, item.source)} ·{" "}
                    {localizedRiskText(t, item.method)} ·{" "}
                    {pct(item.confidence, 0)}
                    {item.fallbackUsed
                      ? t("dashboard.detailDialog.evidenceFallbackSuffix")
                      : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** Localizes persisted provenance text while keeping unknown provider text intact. */
function localizedRiskText(t: TFunction, text: string): string {
  const exact: Record<string, string> = {
    "Hazard values are location-level proxies and should be validated before underwriting decisions":
      "dashboard.detailDialog.riskText.hazardProxy",
    "Not a catastrophe-model or engineering assessment":
      "dashboard.detailDialog.riskText.notEngineeringAssessment",
    "92-day weather window with screening proxies":
      "dashboard.detailDialog.riskText.weatherWindow",
    "synthetic radius fallback":
      "dashboard.detailDialog.riskText.syntheticBoundaryMethod",
    "geospatial boundary lookup":
      "dashboard.detailDialog.riskText.boundaryLookupMethod",
    "Manual boundary review recommended":
      "dashboard.detailDialog.riskText.manualBoundaryReview",
    "area-based estimate": "dashboard.detailDialog.riskText.areaEstimateMethod",
    "aerial object detection":
      "dashboard.detailDialog.riskText.aerialDetectionMethod",
    "Vehicle count is estimated; install the detector model":
      "dashboard.detailDialog.riskText.vehicleEstimate",
    "Synthetic lot boundary used":
      "dashboard.detailDialog.riskText.syntheticBoundary",
    "Boundary requires review before underwriting use":
      "dashboard.detailDialog.riskText.boundaryReviewRequired",
    "Boundary sources do not sufficiently agree":
      "dashboard.detailDialog.riskText.boundaryDisagreement",
    "Vehicle exposure is estimated because no ML model is installed":
      "dashboard.detailDialog.riskText.noMlModel",
    "Hail zone estimated from weather data; no postcode hail zone available":
      "dashboard.detailDialog.riskText.hailZoneEstimated",
    "Hail EAL frequency and severity parameters are uncalibrated placeholders":
      "dashboard.detailDialog.riskText.hailEalPlaceholders",
    "Hail EAL vehicle count derived from the declared asset value":
      "dashboard.detailDialog.riskText.hailVehiclesFromAssetValue",
    "Postcode hail zones": "dashboard.detailDialog.riskText.postcodeHailZones",
    "postcode hail-zone lookup":
      "dashboard.detailDialog.riskText.postcodeHailZoneMethod",
    "hail zone estimated from weather-based hail score":
      "dashboard.detailDialog.riskText.estimatedHailZoneMethod",
  };
  const key = exact[text];
  if (key) return t(key);
  const screening = text.match(/^Risk model (.+) is a screening model$/);
  if (screening)
    return t("dashboard.detailDialog.riskText.screeningModel", {
      version: screening[1],
    });
  const role = text.match(
    /^Boundary represents (.+), not a confirmed operational lot$/,
  );
  if (role)
    return t("dashboard.detailDialog.riskText.boundaryRole", {
      role: boundaryRoleLabel(t, role[1]),
    });
  return text;
}

function NatCatSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const refreshNatCat = useAppStore((state) => state.refreshNatCat);
  const [refreshing, setRefreshing] = useState(false);
  const assessment = d.natCat ?? d.risk?.natCat;

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      await refreshNatCat(d.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">
          {t("dashboard.detailDialog.natCatTitle")}
        </h4>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing
            ? t("dashboard.detailDialog.natCatRefreshing")
            : t("dashboard.detailDialog.natCatRefresh")}
        </Button>
      </div>
      {!assessment ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {assessment.evidence.source} · {assessment.dataVersion ?? "unknown"}
          </div>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            {assessment.hazards.map((hazard) => (
              <div key={`${hazard.peril}-${hazard.unit}`}>
                {t("dashboard.detailDialog.natCatHazard", {
                  peril: hazard.peril,
                  score: hazard.score.toFixed(0),
                  unit: hazard.unit,
                })}
                {/* Per-peril source when several providers are combined. */}
                {assessment.provider === "composite" && hazard.provider && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {sourceLabel(hazard.provider)}
                  </span>
                )}
              </div>
            ))}
          </div>
          {assessment.evidence.fallbackUsed && (
            <ul className="list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
              {assessment.evidence.limitations
                .filter((note) => note.includes(" used instead"))
                .map((note) => (
                  <li key={note}>{note}</li>
                ))}
            </ul>
          )}
          {Object.entries(assessment.attributes).map(([name, value]) => (
            <div key={name} className="text-xs text-muted-foreground">
              {t("dashboard.detailDialog.natCatAttribute", {
                name,
                value: String(value),
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ManualVehicleCountEditor({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t } = useTranslation();
  const updateManualVehicleCount = useAppStore(
    (state) => state.updateManualVehicleCount,
  );
  const [draft, setDraft] = useState(
    () => d.detection?.manualVehicleCount?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(d.detection?.manualVehicleCount?.toString() ?? "");
  }, [d.id, d.detection?.manualVehicleCount]);

  const parsed = draft.trim() === "" ? null : Number(draft);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0);

  async function save(): Promise<void> {
    if (!valid) return;
    setSaving(true);
    try {
      await updateManualVehicleCount(d.id, parsed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border p-2.5">
      <div className="text-xs text-muted-foreground">
        {t("dashboard.detailDialog.manualVehicleCount")}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={1}
          value={draft}
          placeholder={t(
            "dashboard.detailDialog.manualVehicleCountPlaceholder",
          )}
          aria-label={t("dashboard.detailDialog.manualVehicleCount")}
          aria-invalid={!valid}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={saving || !valid}
          onClick={() => void save()}
          title={t("dashboard.detailDialog.saveManualVehicleCount")}
        >
          <Save className="size-3.5" />
          <span className="sr-only">
            {t("dashboard.detailDialog.saveManualVehicleCount")}
          </span>
        </Button>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {parsed === null
          ? t("dashboard.detailDialog.manualVehicleCountNotSet")
          : t("dashboard.detailDialog.manualVehicleCountSaved", {
              count: parsed,
            })}
      </div>
      {!valid && (
        <div className="mt-1 text-[10px] text-destructive">
          {t("dashboard.detailDialog.manualCountInvalid")}
        </div>
      )}
    </div>
  );
}

/**
 * Loads additional OSM info (website, phone, opening hours, brand, ...) for a
 * coordinate — shared by `QuickLinksRow` (website link) and
 * `OsmDetailsSection` (full view) so it's only fetched once per location.
 */
function useOsmDetails(
  lat: number,
  lon: number,
  name?: string,
  address?: string,
): { details: OsmDetails | null; loading: boolean } {
  const [details, setDetails] = useState<OsmDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    window.api
      .getOsmDetails(lat, lon, name, address)
      .then((res) => {
        if (!cancelled) setDetails(res);
      })
      .catch(() => {
        if (!cancelled) setDetails(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, name, address]);

  return { details, loading };
}

/** Google Maps search for the actual dealership, with coordinates as context. */
function googleMapsUrl(d: AnalyzedDealership): string {
  const query = [d.name, d.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** OpenStreetMap link for the coordinate. */
function openStreetMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

/**
 * Always-visible link row: a dealership-specific Google Maps search, the
 * coordinate-based OpenStreetMap view, and the official website when OSM has
 * provided one.
 */
function QuickLinksRow({
  d,
  website,
}: {
  d: AnalyzedDealership;
  website?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <a
        href={googleMapsUrl(d)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-primary hover:underline"
      >
        <MapPin className="size-3.5" />
        Google Maps
      </a>
      <a
        href={openStreetMapUrl(d.lat, d.lon)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-primary hover:underline"
      >
        <ExternalLink className="size-3.5" />
        OpenStreetMap
      </a>
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1.5 text-primary hover:underline"
        >
          <Globe className="size-3.5 shrink-0" />
          <span className="truncate">{t("ui.website")}</span>
        </a>
      )}
    </div>
  );
}

/**
 * Additional info from OpenStreetMap (phone, opening hours, brand, ...) — the
 * website is already in `QuickLinksRow`, not duplicated here. Hides itself
 * entirely when OSM has none of these tags for the location.
 */
function OsmDetailsSection({
  details,
  loading,
}: {
  details: OsmDetails | null;
  loading: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />{" "}
        {t("dashboard.detailDialog.osmLoading")}
      </div>
    );
  }

  const hasInfo =
    details?.phone || details?.email || details?.openingHours || details?.brand;
  if (!hasInfo || !details) return null;

  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
      <h4 className="text-xs font-semibold text-muted-foreground">
        {t("dashboard.detailDialog.osmHeading")}
      </h4>
      <div className="space-y-1">
        {details.phone && (
          <a
            href={`tel:${details.phone}`}
            className="flex items-center gap-1.5 hover:underline"
          >
            <Phone className="size-3.5 shrink-0 text-muted-foreground" />
            {details.phone}
          </a>
        )}
        {details.email && (
          <a
            href={`mailto:${details.email}`}
            className="flex items-center gap-1.5 hover:underline"
          >
            <Mail className="size-3.5 shrink-0 text-muted-foreground" />
            {details.email}
          </a>
        )}
        {details.openingHours && (
          <div className="flex items-start gap-1.5">
            <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>{details.openingHours}</span>
          </div>
        )}
        {details.brand && (
          <div className="flex items-center gap-1.5">
            <Tag className="size-3.5 shrink-0 text-muted-foreground" />
            {details.brand}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Editable portfolio metadata: insured status (existing book vs. new customer),
 * sales partner, sub-portfolio, group, and product limit. Writes directly
 * to the store (`updateDealershipMeta`); text fields commit on blur.
 */
function PortfolioMetaSection({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t } = useTranslation();
  const updateMeta = useAppStore((s) => s.updateDealershipMeta);

  const textField = (
    label: string,
    key: "salesPartner" | "subPortfolio" | "group",
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        defaultValue={d[key] ?? ""}
        onBlur={(e) => updateMeta(d.id, { [key]: e.target.value || undefined })}
      />
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor={`insured-${d.id}`} className="text-sm font-semibold">
            {t("dashboard.detailDialog.insuredLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {d.insured
              ? t("dashboard.detailDialog.insuredYesDesc")
              : t("dashboard.detailDialog.insuredNoDesc")}
          </p>
        </div>
        <Switch
          id={`insured-${d.id}`}
          checked={d.insured ?? false}
          onCheckedChange={(v) => updateMeta(d.id, { insured: v })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {textField(
          t("dashboard.detailDialog.salesPartnerLabel"),
          "salesPartner",
        )}
        {textField(
          t("dashboard.detailDialog.subPortfolioLabel"),
          "subPortfolio",
        )}
        {textField(t("dashboard.detailDialog.groupLabel"), "group")}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("dashboard.detailDialog.productLimitLabel")}
          <Input
            type="number"
            min={0}
            defaultValue={d.productLimitEur ?? ""}
            onBlur={(e) => {
              const n = Number(e.target.value);
              updateMeta(d.id, {
                productLimitEur:
                  e.target.value && !Number.isNaN(n) ? n : undefined,
              });
            }}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Free-text underwriting notes for one location, stored with the portfolio.
 * Saves on the button, on blur, and when the dialog closes with unsaved
 * changes, so closing via Escape never discards typed text.
 */
function NotesSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const updateNotes = useAppStore((s) => s.updateDealershipNotes);
  const [draft, setDraft] = useState(d.notes ?? "");
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setDraft(d.notes ?? "");
  }, [d.id, d.notes]);

  // Flush unsaved text on unmount (dialog closed or another location opened).
  useEffect(() => {
    const id = d.id;
    return () => {
      void useAppStore
        .getState()
        .updateDealershipNotes(id, draftRef.current)
        .catch((err: unknown) => {
          console.error("Saving notes on close failed:", err);
        });
    };
  }, [d.id]);

  const dirty = (draft.trim() === "" ? "" : draft) !== (d.notes ?? "");

  async function save(): Promise<void> {
    if (!dirty) return;
    setSaving(true);
    try {
      await updateNotes(d.id, draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={`notes-${d.id}`}
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          <StickyNote className="size-3.5 text-muted-foreground" />
          {t("dashboard.detailDialog.notesTitle")}
        </Label>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {t("dashboard.detailDialog.notesSave")}
        </Button>
      </div>
      <Textarea
        id={`notes-${d.id}`}
        value={draft}
        rows={4}
        maxLength={DEALERSHIP_NOTES_MAX_LENGTH}
        placeholder={t("dashboard.detailDialog.notesPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
      />
      <p className="text-[10px] text-muted-foreground">
        {dirty
          ? t("dashboard.detailDialog.notesUnsaved")
          : d.notesUpdatedAt
            ? t("dashboard.detailDialog.notesUpdatedAt", {
                date: new Date(d.notesUpdatedAt).toLocaleString(i18n.language),
              })
            : t("dashboard.detailDialog.notesEmpty")}
      </p>
    </div>
  );
}

function AiSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const [memo, setMemo] = useState<StructuredMemo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function genMemo(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setMemo(await window.api.llmMemo(d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={genMemo} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <FileText />}{" "}
          {t("ai.memo")}
        </Button>
      </div>

      {error && (
        <LlmErrorMessage
          error={error}
          className="text-sm"
          format={(e) => t("dashboard.detailDialog.errorPrefix", { error: e })}
        />
      )}

      {memo && (
        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label={t("dashboard.detailDialog.recommendedDeductibleLabel")}
              value={eur(memo.recommendedDeductibleEur)}
            />
            <Metric
              label={t("dashboard.detailDialog.premiumLoadingLabel")}
              value={`${memo.suggestedPremiumLoadingPct.toFixed(0)} %`}
            />
          </div>
          {memo.sublimitNotes.length > 0 && (
            <ul className="list-inside list-disc text-muted-foreground">
              {memo.sublimitNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <p>{memo.reasoning}</p>
        </div>
      )}
    </div>
  );
}
