import type { AnalyzedDealership } from "@shared/types";

/** One of the four numbers in the dialog header. */
/** Address without a leading copy of the name ("Autohaus X, 01219 …"). */
export function addressLine(d: AnalyzedDealership): string {
  const address = d.address ?? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`;
  const prefix = `${d.name}, `;
  return address.startsWith(prefix) ? address.slice(prefix.length) : address;
}

export function formatIsoDate(iso: string, locale: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(locale, { timeZone: "UTC" });
}

export function Metric({
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
