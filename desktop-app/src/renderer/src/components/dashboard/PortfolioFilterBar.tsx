import { useMemo } from "react";
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
import { useAppStore, type PortfolioFilters } from "@renderer/store/appStore";

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
 * Filter bar for the portfolio view: sub-portfolio, sales partner, and
 * group. Writes to the store's `filters` slice; the table, cluster view,
 * and map read from it. Only shown if at least one field has data.
 */
export function PortfolioFilterBar({
  dealerships,
}: Readonly<{
  dealerships: AnalyzedDealership[];
}>): React.JSX.Element | null {
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const resetFilters = useAppStore((s) => s.resetFilters);

  const partners = useMemo(() => distinct(dealerships, "salesPartner"), [dealerships]);
  const subs = useMemo(() => distinct(dealerships, "subPortfolio"), [dealerships]);
  const groups = useMemo(() => distinct(dealerships, "group"), [dealerships]);

  // Nothing to show if no metadata is present.
  if (partners.length === 0 && subs.length === 0 && groups.length === 0)
    return null;

  const active =
    filters.subPortfolio ||
    filters.salesPartner ||
    filters.group ||
    filters.clusterId;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {subs.length > 0 && (
        <FilterSelect
          label="Sub-portfolio"
          value={filters.subPortfolio}
          options={subs}
          onChange={(v) => setFilters({ subPortfolio: v })}
        />
      )}
      {partners.length > 0 && (
        <FilterSelect
          label="Sales Partner"
          value={filters.salesPartner}
          options={partners}
          onChange={(v) => setFilters({ salesPartner: v })}
        />
      )}
      {groups.length > 0 && (
        <FilterSelect
          label="Group"
          value={filters.group}
          options={groups}
          onChange={(v) => setFilters({ group: v })}
        />
      )}
      {filters.clusterId && (
        <span className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">
          Cluster {filters.clusterId}
        </span>
      )}
      {active && (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="size-4" /> Reset Filters
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}>): React.JSX.Element {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? null : v)}
    >
      <SelectTrigger className="h-9 w-48 text-sm">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All · {label}</SelectItem>
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
      (!filters.subPortfolio || d.subPortfolio === filters.subPortfolio) &&
      (!filters.salesPartner || d.salesPartner === filters.salesPartner) &&
      (!filters.group || d.group === filters.group),
  );
}
