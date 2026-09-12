import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { haversineKm, nearbyInsured } from "@shared/risk-math";
import { ACCUMULATION_RADIUS_KM } from "@shared/constants";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import {
  riskLevel,
  riskLevelColor,
  riskLevelLabel,
} from "@renderer/lib/riskColor";
import { useAppStore } from "@renderer/store/appStore";

interface Props {
  /** All locations with coordinates (full registry, independent of map text filters). */
  dealerships: AnalyzedDealership[];
  selectedId: string | null;
  /** IDs with an ongoing background analysis (spinner instead of score). */
  analyzingIds: string[];
  onSelect: (id: string) => void;
  onOpenDetails: (id: string) => void;
  /** Optional portfolio upload (CSV/Excel) directly from the header. */
  onUploadFile?: (file: File) => void | Promise<void>;
}

/** A row including derived relationship info relative to the selected subject. */
interface Row {
  d: AnalyzedDealership;
  /** Distance to the subject in km — null if nothing is selected or the row itself is the subject. */
  distanceKm: number | null;
  sameGroup: boolean;
  inRadius: boolean;
}

/**
 * Locations panel: lists all locations with a risk dot, score, and relationship badges.
 * Can be embedded as a floating glass pane (`variant="float"`, default) or as a dock
 * (`variant="dock"`) in a panel.
 */
export function LocationsPanel({
  dealerships,
  selectedId,
  analyzingIds,
  onSelect,
  onOpenDetails,
  onUploadFile,
  variant = "float",
}: Readonly<Props & { variant?: "float" | "dock" }>): React.JSX.Element {
  const { t } = useTranslation();
  // Local instead of in mapStore: a pure UI flap for the row list, decoupled
  // from `locationsPanelOpen` (which only controls whether the entire dock panel in
  // WorkspacePage is collapsed to width 0 via the resizer). Otherwise a click
  // on the chevron in the header would make the entire left dock disappear.
  const [open, setOpen] = useState(true);
  const toggleOpen = (): void => setOpen((v) => !v);
  const [adding, setAdding] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  async function onFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (file && onUploadFile) await onUploadFile(file);
    if (uploadRef.current) uploadRef.current.value = "";
  }

  const subject = useMemo(
    () => dealerships.find((d) => d.id === selectedId) ?? null,
    [dealerships, selectedId],
  );

  // Rows with relationship info, sorted: subject on top, otherwise by distance.
  const rows = useMemo<Row[]>(() => {
    const built = dealerships.map<Row>((d) => {
      const isSubject = subject != null && d.id === subject.id;
      const distanceKm =
        subject && !isSubject
          ? haversineKm(subject.lat, subject.lon, d.lat, d.lon)
          : null;
      return {
        d,
        distanceKm,
        sameGroup: !isSubject && !!subject?.group && d.group === subject.group,
        inRadius: distanceKm != null && distanceKm <= ACCUMULATION_RADIUS_KM,
      };
    });
    return built.sort((a, b) => {
      if (a.d.id === selectedId) return -1;
      if (b.d.id === selectedId) return 1;
      if (a.distanceKm != null && b.distanceKm != null)
        return a.distanceKm - b.distanceKm;
      return 0;
    });
  }, [dealerships, subject, selectedId]);

  // Summary: insured neighbors within the subject's accumulation radius.
  const neighborCount = useMemo(
    () =>
      subject
        ? nearbyInsured(subject, dealerships, ACCUMULATION_RADIUS_KM).length
        : 0,
    [subject, dealerships],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        variant === "dock"
          ? "h-full border-r bg-card"
          : "glass rounded-lg border shadow-lg",
        variant === "float" && open && "flex-1",
      )}
    >
      {/* Header — always visible */}
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2">
        <button
          type="button"
          onClick={toggleOpen}
          className="flex flex-1 items-center gap-1.5 text-sm font-semibold"
          aria-expanded={open}
          aria-label={t("map.locationsPanel.toggleAriaLabel")}
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0" />
          ) : (
            <ChevronRight className="size-4 shrink-0" />
          )}
          <MapPin className="size-4 shrink-0" />
          {t("dashboard.locations")}
          <span className="text-muted-foreground">({dealerships.length})</span>
        </button>
        {onUploadFile && (
          <>
            <input
              ref={uploadRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx"
              className="hidden"
              onChange={onFileChange}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              onClick={() => uploadRef.current?.click()}
              title={t("map.locationsPanel.importPortfolio")}
              aria-label={t("map.locationsPanel.importPortfolio")}
            >
              <Paperclip className="size-3.5" />
            </Button>
          </>
        )}
        <Button
          type="button"
          size="icon"
          variant={adding ? "default" : "ghost"}
          className="size-6 shrink-0"
          onClick={() => setAdding((v) => !v)}
          title={t("map.locationsPanel.addAddress")}
          aria-label={t("map.locationsPanel.addAddress")}
        >
          {adding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
        </Button>
      </div>

      {/* Add address */}
      {adding && (
        <div className="shrink-0 border-t px-2.5 py-2">
          <AddLocationField onAdded={() => setAdding(false)} />
        </div>
      )}

      {open && (
        <>
          {/* Subject's relationship summary */}
          {subject && (
            <div className="shrink-0 border-t px-2.5 py-1.5 text-xs text-muted-foreground">
              {neighborSummaryText(t, neighborCount)}
            </div>
          )}

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto border-t">
            {rows.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">
                {t("map.locationsPanel.empty")}
              </p>
            ) : (
              <ul className="divide-y">
                {rows.map((row) => (
                  <LocationRow
                    key={row.d.id}
                    row={row}
                    selected={row.d.id === selectedId}
                    pending={!row.d.risk || analyzingIds.includes(row.d.id)}
                    onSelect={onSelect}
                    onOpenDetails={onOpenDetails}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Neighbor summary text (avoids nested ternaries in JSX). */
function neighborSummaryText(t: TFunction, count: number): string {
  const radius = ACCUMULATION_RADIUS_KM;
  if (count === 0)
    return t("map.locationsPanel.neighborSummary.none", { radius });
  if (count === 1)
    return t("map.locationsPanel.neighborSummary.one", { radius });
  return t("map.locationsPanel.neighborSummary.other", { count, radius });
}

/** A clickable location row with a risk dot, score, and relationship badges. */
function LocationRow({
  row,
  selected,
  pending,
  onSelect,
  onOpenDetails,
}: Readonly<{
  row: Row;
  selected: boolean;
  pending: boolean;
  onSelect: (id: string) => void;
  onOpenDetails: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const { d, distanceKm, sameGroup, inRadius } = row;
  const score = d.risk?.overallScore;
  const dotColor = score != null ? riskLevelColor(riskLevel(score)) : "#9ca3af";

  return (
    <li className={cn("flex items-stretch", selected && "bg-accent")}>
      {/* Selection button (fills the row) */}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left text-sm hover:bg-accent/60"
        onClick={() => onSelect(d.id)}
        aria-pressed={selected}
      >
        <span
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
          title={
            score != null
              ? riskLevelLabel(riskLevel(score))
              : t("map.locationsPanel.analyzing")
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{d.name}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              <ScoreLabel pending={pending} score={score} />
            </span>
          </div>
          {/* Meta and relationship badges */}
          <div className="mt-1 flex flex-wrap gap-1">
            {d.group && (
              <Chip>
                <Users className="size-3" />
                {d.group}
              </Chip>
            )}
            {d.insured && (
              <Chip>
                <ShieldCheck className="size-3" />
                {t("map.locationsPanel.insuredChip")}
              </Chip>
            )}
            {distanceKm != null && <Chip>{distanceKm.toFixed(1)}&nbsp;km</Chip>}
            {sameGroup && (
              <Chip accent>{t("map.locationsPanel.sameGroupChip")}</Chip>
            )}
            {inRadius && (
              <Chip accent>{t("map.locationsPanel.inRadiusChip")}</Chip>
            )}
          </div>
        </div>
      </button>
      {/* Open details (separate button, not nested) */}
      <button
        type="button"
        className="shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => onOpenDetails(d.id)}
        title={t("map.locationsPanel.viewDetails")}
        aria-label={t("map.locationsPanel.viewDetailsFor", { name: d.name })}
      >
        <ChevronRight className="size-4" />
      </button>
    </li>
  );
}

/** Score on the right of the row: spinner during analysis, otherwise the value. */
function ScoreLabel({
  pending,
  score,
}: Readonly<{ pending: boolean; score: number | undefined }>): React.JSX.Element {
  if (pending) return <Loader2 className="size-3.5 animate-spin" />;
  return <>{score != null ? Math.round(score) : "…"}</>;
}

/** Small info chip; `accent` highlights relationship matches. */
function Chip({
  children,
  accent,
}: Readonly<{
  children: React.ReactNode;
  accent?: boolean;
}>): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
        accent
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

interface Suggestion {
  label: string;
  lat: number;
  lon: number;
}

/**
 * Compact address input field with Photon autocomplete (keyless, like in
 * the omnibox). Selecting a suggestion adds the location directly to the portfolio;
 * the auto-selection in `addAndAnalyze` makes the map fly to it.
 */
function AddLocationField({
  onAdded,
}: Readonly<{ onAdded: () => void }>): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();

  // Debounced autocomplete — discards stale responses.
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const hits = await window.api.placesAutocomplete(trimmed);
        if (!cancelled) setSuggestions(hits);
      } catch (e) {
        if (!cancelled) {
          setSuggestions([]);
          setError(
            e instanceof Error
              ? e.message
              : t("map.locationsPanel.searchFailed"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, t]);

  function pick(s: Suggestion): void {
    void useAppStore.getState().addAndAnalyze([
      {
        id: crypto.randomUUID(),
        name: deriveName(s.label),
        address: s.label,
        lat: s.lat,
        lon: s.lon,
      },
    ]);
    setValue("");
    setSuggestions([]);
    onAdded();
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={value}
          placeholder={t("map.locationsPanel.addressPlaceholder")}
          className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions.length > 0) {
              e.preventDefault();
              pick(suggestions[0]);
            }
          }}
          aria-label={t("map.locationsPanel.addAddress")}
        />
        {loading && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {suggestions.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded-md border bg-popover py-1">
          {suggestions.map((s, i) => (
            <li key={`${s.lat},${s.lon},${i}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => pick(s)}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Derive a location name from an address: the first comma segment, otherwise the label. */
function deriveName(label: string): string {
  const first = label.split(",")[0]?.trim();
  return first || label;
}
