import { useState } from "react";
import { ChevronRight } from "lucide-react";
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

/**
 * One collapsible row of a detail tab: what the section is, its current
 * value in a few words, and the detail on demand. Every section below the
 * key facts of a tab uses it, so a tab reads as a short list instead of a
 * page of text. The content is created when the row is first opened (charts
 * need a visible box to size themselves) and then kept, so a result the
 * user produced inside survives closing the row.
 */
export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
}: Readonly<{
  title: string;
  /** The current value or state, shown while closed and open. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state, for a caller that opens it from elsewhere. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}>): React.JSX.Element {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const [mountedOnce, setMounted] = useState(defaultOpen);
  const mounted = mountedOnce || open;
  return (
    <details
      className="group rounded-md border text-sm"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setOwnOpen(next);
        onOpenChange?.(next);
        if (next) setMounted(true);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
        <span className="shrink-0 font-medium">{title}</span>
        {summary != null && summary !== "" && (
          <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
            {summary}
          </span>
        )}
      </summary>
      {mounted && <div className="border-t p-3">{children}</div>}
    </details>
  );
}
