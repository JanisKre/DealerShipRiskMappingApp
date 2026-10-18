import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
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
  useAppStore,
  type PortfolioFilters,
} from "@renderer/store/appStore";

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
  const fallbackCount = useMemo(
    () => dealerships.filter((d) => d.boundary?.source === "synthetic").length,
    [dealerships],
  );

  // Nothing to show if no metadata is present.
  if (
    !mixedBusiness &&
    !filters.business &&
    partners.length === 0 &&
    subs.length === 0 &&
    groups.length === 0 &&
    fallbackCount === 0
  )
    return null;

  const panel = variant === "panel";
  const selectClass = panel ? "h-8 w-full bg-background text-xs" : undefined;
  const active =
    filters.business ||
    filters.subPortfolio ||
    filters.salesPartner ||
    filters.group ||
    filters.clusterId ||
    filters.boundarySource;

  return (
    <div
      className={
        panel ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"
      }
    >
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
            className={selectClass ?? "h-9 w-52 bg-background text-sm"}
          >
            <SelectValue placeholder={t("ui.boundarySource")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t("ui.allBoundaries")} · {t("ui.boundarySource")}
            </SelectItem>
            <SelectItem value="fallback">
              {t("ui.fallbackBoundary")} ({fallbackCount})
            </SelectItem>
          </SelectContent>
        </Select>
      )}
      {filters.clusterId && (
        <span className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">
          {t("ui.clusterLabel", { id: filters.clusterId })}
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
  className = "h-9 w-52 bg-background text-sm",
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
  className = "h-9 w-48 bg-background text-sm",
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
      <SelectTrigger className={className}>
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
          d.boundary?.source === "synthetic")),
  );
}
