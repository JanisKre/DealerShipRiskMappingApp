import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import {
  computeAccumulationClusters,
  dealershipHailZone,
} from "@shared/risk-math";
import { Button } from "@renderer/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  businessType,
  locationStatus,
  useAppStore,
  type LocationStatus,
  type PortfolioFilters,
} from "@renderer/store/appStore";

/** Zone filter value of a location ("none" while it has no zone yet). */
function zoneKey(d: AnalyzedDealership): number | "none" {
  return dealershipHailZone(d)?.zone ?? "none";
}

function statusMatches(d: AnalyzedDealership, status: LocationStatus): boolean {
  if (status === "review") return d.boundary?.reviewRequired === true;
  return locationStatus(d) === status;
}

/** Counts per hail zone and per processing state, for the filter options. */
function useOptionCounts(dealerships: AnalyzedDealership[]): {
  zones: Array<{ key: number | "none"; count: number }>;
  status: Record<LocationStatus, number>;
} {
  return useMemo(() => {
    const zones = new Map<number | "none", number>();
    const status: Record<LocationStatus, number> = {
      analyzed: 0,
      pending: 0,
      review: 0,
    };
    for (const d of dealerships) {
      const key = zoneKey(d);
      zones.set(key, (zones.get(key) ?? 0) + 1);
      status[locationStatus(d)]++;
      if (d.boundary?.reviewRequired) status.review++;
    }
    return {
      zones: [...zones]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) =>
          a.key === "none" ? 1 : b.key === "none" ? -1 : a.key - b.key,
        ),
      status,
    };
  }, [dealerships]);
}

/** Trigger that sizes to its label instead of clipping it. */
const TRIGGER = "h-9 w-auto min-w-36 gap-2 bg-background text-sm";

const ALL = "__all__";

/** Sorted, unique, non-empty values of a metadata field. */
function distinct(
  dealerships: AnalyzedDealership[],
  key: "salesPartner" | "subPortfolio" | "group",
): string[] {
  const set = new Set<string>();
  for (const d of dealerships) {
    const v = d[key];
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "de"));
}

/**
 * Filter bar for the portfolio view: business type (existing vs. new),
 * sub-portfolio, sales partner, and group. Writes to the store's `filters` slice; the table, cluster view,
 * and map read from it. Only shown if at least one field has data.
 * `variant="panel"` stacks the selects full-width for the map layer panel.
 */
export function PortfolioFilterBar({
  dealerships,
  variant = "bar",
}: Readonly<{
  dealerships: AnalyzedDealership[];
  variant?: "bar" | "panel";
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const resetFilters = useAppStore((s) => s.resetFilters);

  const partners = useMemo(
    () => distinct(dealerships, "salesPartner"),
    [dealerships],
  );
  const subs = useMemo(
    () => distinct(dealerships, "subPortfolio"),
    [dealerships],
  );
  const groups = useMemo(() => distinct(dealerships, "group"), [dealerships]);
  const businessCounts = useBusinessCounts(dealerships);
  const mixedBusiness = businessCounts.existing > 0 && businessCounts.fresh > 0;
  const parameters = useAppStore((s) => s.parameters);
  // Readable name for an active cluster filter ("Autohaus X + 1 weiterer")
  // instead of the internal cluster id.
  const clusterName = useMemo(() => {
    if (!filters.clusterId) return null;
    const located = dealerships.filter((d) => d.lat != null && d.lon != null);
    const cluster = computeAccumulationClusters(
      located,
      parameters.accumulationRadiusKm,
      parameters,
    ).find((c) => c.clusterId === filters.clusterId);
    if (!cluster) return null;
    const largest = cluster.memberIds
      .map((id) => located.find((d) => d.id === id))
      .filter((d): d is AnalyzedDealership => d != null)
      .sort(
        (a, b) => (b.risk?.exposureEur ?? 0) - (a.risk?.exposureEur ?? 0),
      )[0];
    if (!largest) return null;
    return cluster.count > 1
      ? `${largest.name} ${t("dashboard.accumulations.more", { count: cluster.count - 1 })}`
      : largest.name;
  }, [dealerships, filters.clusterId, parameters, t]);
  const counts = useOptionCounts(dealerships);
  const showZone = counts.zones.length > 1 || filters.hailZone != null;
  const showStatus =
    counts.status.pending > 0 ||
    counts.status.review > 0 ||
    filters.status != null;
  const fallbackCount = useMemo(
    () => dealerships.filter((d) => d.boundary?.source === "synthetic").length,
    [dealerships],
  );

  const active =
    filters.hailZone != null ||
    filters.status ||
    filters.business ||
    filters.subPortfolio ||
    filters.salesPartner ||
    filters.group ||
    filters.clusterId ||
    filters.boundarySource;

  // Nothing to show if no metadata is present — unless a filter is active
  // (e.g. a cluster set from "Show on map"), which must stay visible and
  // resettable even when the tile that set it is hidden.
  if (
    !active &&
    !mixedBusiness &&
    partners.length === 0 &&
    subs.length === 0 &&
    groups.length === 0 &&
    fallbackCount === 0 &&
    !showZone &&
    !showStatus
  )
    return null;

  const panel = variant === "panel";
  const selectClass = panel ? "h-8 w-full bg-background text-xs" : undefined;

  return (
    <div
      className={
        panel ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"
      }
    >
      {showZone && (
        <Select
          value={filters.hailZone == null ? ALL : String(filters.hailZone)}
          onValueChange={(v) =>
            setFilters({
              hailZone: v === ALL ? null : v === "none" ? "none" : Number(v),
            })
          }
        >
          <SelectTrigger
            className={selectClass ?? TRIGGER}
            aria-label={t("dashboard.hailZone")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("ui.filter.allZones")}</SelectItem>
            {counts.zones.map(({ key, count }) => (
              <SelectItem key={key} value={String(key)}>
                {key === "none"
                  ? t("ui.filter.noZone", { count })
                  : t("ui.filter.zone", { zone: key, count })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {showStatus && (
        <Select
          value={filters.status ?? ALL}
          onValueChange={(v) =>
            setFilters({ status: v === ALL ? null : (v as LocationStatus) })
          }
        >
          <SelectTrigger
            className={selectClass ?? TRIGGER}
            aria-label={t("ui.filter.statusLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("ui.filter.allStatus")}</SelectItem>
            <SelectItem value="analyzed">
              {t("ui.filter.analyzed", { count: counts.status.analyzed })}
            </SelectItem>
            {counts.status.pending > 0 && (
              <SelectItem value="pending">
                {t("ui.filter.pending", { count: counts.status.pending })}
              </SelectItem>
            )}
            {counts.status.review > 0 && (
              <SelectItem value="review">
                {t("ui.filter.review", { count: counts.status.review })}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      )}
      <BusinessTypeSelect dealerships={dealerships} className={selectClass} />
      {subs.length > 0 && (
        <FilterSelect
          label={t("ui.subPortfolio")}
          value={filters.subPortfolio}
          options={subs}
          onChange={(v) => setFilters({ subPortfolio: v })}
          className={selectClass}
        />
      )}
      {partners.length > 0 && (
        <FilterSelect
          label={t("ui.salesPartner")}
          value={filters.salesPartner}
          options={partners}
          onChange={(v) => setFilters({ salesPartner: v })}
          className={selectClass}
        />
      )}
      {groups.length > 0 && (
        <FilterSelect
          label={t("ui.group")}
          value={filters.group}
          options={groups}
          onChange={(v) => setFilters({ group: v })}
          className={selectClass}
        />
      )}
      {fallbackCount > 0 && (
        <Select
          value={filters.boundarySource ?? ALL}
          onValueChange={(v) =>
            setFilters({
              boundarySource: v === ALL ? null : (v as "fallback"),
            })
          }
        >
          <SelectTrigger
            className={selectClass ?? TRIGGER}
            aria-label={t("ui.boundarySource")}
          >
            <SelectValue placeholder={t("ui.boundarySource")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("ui.allBoundaries")}</SelectItem>
            <SelectItem value="fallback">
              {t("ui.fallbackBoundary")} ({fallbackCount})
            </SelectItem>
          </SelectContent>
        </Select>
      )}
      {filters.clusterId && (
        <span className="rounded-md border bg-muted px-2 py-1 text-xs">
          {clusterName
            ? t("ui.clusterFilterLabel", { name: clusterName })
            : t("ui.clusterLabel", { id: filters.clusterId })}
        </span>
      )}
      {active && (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="size-4" /> {t("ui.resetFilters")}
        </Button>
      )}
    </div>
  );
}

function useBusinessCounts(dealerships: AnalyzedDealership[]): {
  existing: number;
  fresh: number;
} {
  return useMemo(() => {
    let existing = 0;
    for (const d of dealerships) if (businessType(d) === "existing") existing++;
    return { existing, fresh: dealerships.length - existing };
  }, [dealerships]);
}

/**
 * Business-type filter (existing vs. new). Only rendered when the portfolio
 * mixes both types, or while a business filter is still active.
 */
function BusinessTypeSelect({
  dealerships,
  className = TRIGGER,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  className?: string;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const business = useAppStore((s) => s.filters.business);
  const setFilters = useAppStore((s) => s.setFilters);
  const counts = useBusinessCounts(dealerships);
  const mixed = counts.existing > 0 && counts.fresh > 0;
  if (!mixed && !business) return null;
  return (
    <Select
      value={business ?? ALL}
      onValueChange={(v) =>
        setFilters({ business: v === ALL ? null : (v as "existing" | "new") })
      }
    >
      <SelectTrigger className={className} aria-label={t("ui.businessType")}>
        <SelectValue placeholder={t("ui.businessType")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("ui.allBusiness")}</SelectItem>
        <SelectItem value="existing">
          {t("ui.existingBusiness")} ({counts.existing})
        </SelectItem>
        <SelectItem value="new">
          {t("ui.newBusiness")} ({counts.fresh})
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  className = TRIGGER,
}: Readonly<{
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
  className?: string;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? null : v)}
    >
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>
          {t("ui.all")} · {label}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Applies the active metadata filters to a dealership list (without cluster). */
export function applyMetaFilters(
  dealerships: AnalyzedDealership[],
  filters: PortfolioFilters,
): AnalyzedDealership[] {
  return dealerships.filter(
    (d) =>
      (!filters.business || businessType(d) === filters.business) &&
      (!filters.subPortfolio || d.subPortfolio === filters.subPortfolio) &&
      (!filters.salesPartner || d.salesPartner === filters.salesPartner) &&
      (!filters.group || d.group === filters.group) &&
      (!filters.boundarySource ||
        (filters.boundarySource === "fallback" &&
          d.boundary?.source === "synthetic")) &&
      (filters.hailZone == null || zoneKey(d) === filters.hailZone) &&
      (!filters.status || statusMatches(d, filters.status)),
  );
}
