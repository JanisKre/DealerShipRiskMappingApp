import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRight,
  CalendarClock,
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
  ShieldCheck,
  Tag,
} from "lucide-react";
import type {
  AnalyzedDealership,
  BoundarySuggestion,
  OsmDetails,
  StructuredMemo,
  TemporalChangeResult,
} from "@shared/types";
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
import { useAppStore } from "@renderer/store/appStore";
import { eur, num, pct } from "@renderer/lib/format";
import { riskColor } from "@renderer/lib/riskColor";
import { UnderwritingMessages } from "./UnderwritingMessages";

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
                  <span className="capitalize">{p.peril}</span>
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

      {eb && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            {t("dashboard.ealBreakdown")}
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Metric
              label={t("dashboard.detailDialog.ealPeril.hail")}
              value={eur(eb.hail)}
            />
            <Metric
              label={t("dashboard.detailDialog.ealPeril.wind")}
              value={eur(eb.wind)}
            />
            <Metric
              label={t("dashboard.detailDialog.ealPeril.flood")}
              value={eur(eb.flood)}
            />
            <Metric
              label={t("dashboard.detailDialog.ealPeril.lightning")}
              value={eur(eb.lightning)}
            />
            <Metric
              label={t("dashboard.detailDialog.ealPeril.snow")}
              value={eur(eb.snow)}
            />
            <Metric
              label={t("dashboard.detailDialog.ealPeril.heat")}
              value={eur(eb.heat)}
            />
            <Metric
              label={t("dashboard.detailDialog.ealPeril.total")}
              value={eur(eb.total)}
            />
          </div>
        </div>
      )}

      <div className="space-y-1 text-sm">
        <h4 className="font-semibold">
          {t("dashboard.detailDialog.boundaryTitle")}
        </h4>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>
            {t("dashboard.detailDialog.boundarySourceLabel", {
              source: d.boundary?.source ?? "–",
            })}
          </span>
          {d.boundary?.confidence != null && (
            <span>
              {t("dashboard.detailDialog.boundaryConfidenceLabel", {
                confidence: pct(d.boundary.confidence, 0),
              })}
            </span>
          )}
          {d.boundary?.role && (
            <span>
              {t("dashboard.detailDialog.boundaryRoleLabel", {
                role: d.boundary.role,
              })}
            </span>
          )}
          {d.boundary?.quality && (
            <span>
              {t("dashboard.detailDialog.boundaryAgreementLabel", {
                agreement: pct(d.boundary.quality.sourceAgreement, 0),
              })}
            </span>
          )}
          {d.boundary?.reviewRequired && (
            <Badge
              variant="outline"
              className="border-amber-500 text-amber-600"
            >
              {t("dashboard.detailDialog.boundaryReviewLabel")}
            </Badge>
          )}
        </div>
        {d.boundary?.candidates && d.boundary.candidates.length > 1 && (
          <details className="mt-2 rounded-md border bg-muted/20 p-2 text-xs">
            <summary className="cursor-pointer font-medium">
              {t("dashboard.detailDialog.boundaryCandidatesTitle", {
                count: d.boundary.candidates.length,
              })}
            </summary>
            <div className="mt-2 space-y-1.5 text-muted-foreground">
              {d.boundary.candidates.slice(0, 5).map((candidate, index) => (
                <div
                  key={`${candidate.source}-${candidate.label ?? "candidate"}-${index}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    {candidate.label ?? candidate.source}
                  </span>
                  <span className="shrink-0">
                    {num(candidate.areaSqm)} m² · {pct(candidate.confidence, 0)}
                    {candidate.role ? ` · ${candidate.role}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {d.risk && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="font-semibold">{t("ui.modelConfidence")}</span>
            <span>
              {pct(d.risk.confidence, 0)} · {d.risk.modelVersion ?? "unknown"}
            </span>
          </div>
          {d.risk.limitations && d.risk.limitations.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {d.risk.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          )}
          {d.risk.evidence && d.risk.evidence.length > 0 && (
            <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
              {d.risk.evidence.map((item) => (
                <div key={`${item.source}-${item.method}`}>
                  {item.source} · {item.method} · {pct(item.confidence, 0)}
                  {item.fallbackUsed ? " · fallback" : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Separator />

      <TemporalSection d={d} />

      <Separator />

      <AiSection d={d} />
    </>
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

function NatCatSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const refreshCatNet = useAppStore((state) => state.refreshCatNet);
  const [refreshing, setRefreshing] = useState(false);
  const assessment = d.natCat ?? d.risk?.natCat;

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      await refreshCatNet(d.id);
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
            {assessment.provider} · {assessment.dataVersion ?? "unknown"}
          </div>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            {assessment.hazards.map((hazard) => (
              <div key={`${hazard.peril}-${hazard.unit}`}>
                {t("dashboard.detailDialog.natCatHazard", {
                  peril: hazard.peril,
                  score: hazard.score.toFixed(0),
                  unit: hazard.unit,
                })}
              </div>
            ))}
          </div>
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

/** ISO date (YYYY-MM-DD) for today minus `days` days. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function fmtDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Two-point-in-time comparison of vehicle detection. Requires a date-capable
 * tile source (WMS template with {time}); otherwise the main service reports
 * a clear error that is displayed here.
 */
function TemporalSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const [fromDate, setFromDate] = useState(() => isoDaysAgo(365));
  const [toDate, setToDate] = useState(() => isoDaysAgo(0));
  const [result, setResult] = useState<TemporalChangeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await window.api.compareTemporal(
          d.lat,
          d.lon,
          fromDate,
          toDate,
          d.boundary,
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const delta = result?.deltaCount ?? 0;
  const deltaColor =
    delta > 0
      ? "text-emerald-600"
      : delta < 0
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4" />
        <h4 className="text-sm font-semibold">
          {t("dashboard.detailDialog.temporalTitle")}
        </h4>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
          {t("dashboard.detailDialog.fromLabel")}
          <Input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
          {t("dashboard.detailDialog.toLabel")}
          <Input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={run}
          disabled={busy || !fromDate || !toDate}
        >
          {busy ? <Loader2 className="animate-spin" /> : <CalendarClock />}{" "}
          {t("dashboard.detailDialog.compareButton")}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-mono">{result.fromCount}</span>
            <ArrowRight className="size-4 text-muted-foreground" />
            <span className="font-mono">{result.toCount}</span>
            <span className={`font-medium ${deltaColor}`}>
              {t("dashboard.detailDialog.deltaVehicles", {
                delta: fmtDelta(delta),
              })}
              {result.deltaPct != null &&
                ` (${(result.deltaPct * 100).toFixed(0)} %)`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
            <Metric
              label={t("dashboard.detailDialog.carLabel")}
              value={fmtDelta(result.classDeltas.car)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("dashboard.detailDialog.sourceConfidence", {
              provider: result.provider,
              from: pct(result.fromConfidence, 0),
              to: pct(result.toConfidence, 0),
            })}
          </p>
        </div>
      )}
    </div>
  );
}

function AiSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const [memo, setMemo] = useState<StructuredMemo | null>(null);
  const [suggestion, setSuggestion] = useState<BoundarySuggestion | null>(null);
  const [busy, setBusy] = useState<"memo" | "boundary" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function genMemo(): Promise<void> {
    setBusy("memo");
    setError(null);
    try {
      setMemo(await window.api.llmMemo(d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function refine(): Promise<void> {
    setBusy("boundary");
    setError(null);
    try {
      setSuggestion(await window.api.llmRefineBoundary(d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={genMemo}
          disabled={busy !== null}
        >
          {busy === "memo" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FileText />
          )}{" "}
          {t("ai.memo")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={refine}
          disabled={busy !== null}
        >
          {busy === "boundary" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ShieldCheck />
          )}{" "}
          {t("ai.boundaryRefine")}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          {t("dashboard.detailDialog.errorPrefix", { error })}
        </p>
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

      {suggestion && (
        <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
          <Badge variant="secondary">{suggestion.recommendedAction}</Badge>
          {suggestion.expandMeters != null && (
            <span className="ml-2 text-muted-foreground">
              +{suggestion.expandMeters} m
            </span>
          )}
          <p className="mt-1">{suggestion.reasoning}</p>
        </div>
      )}
    </div>
  );
}
