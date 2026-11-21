import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MapPin } from "lucide-react";
import { notify } from "@renderer/lib/notify";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/appStore";
import { searchBias } from "@renderer/lib/searchBias";
import { Link } from "react-router-dom";
import { useDealerDirectoryStore } from "@renderer/store/dealerDirectoryStore";
import {
  PlaceApproximateNote,
  PlacePortfolioBadge,
  PlaceSourceTag,
} from "./PlaceSourceTag";
import type { PlaceSuggestion } from "@shared/ipc-schema";
import {
  coordinateLabel,
  nameForPlace,
  parseCoordinatePair,
} from "@renderer/lib/placeName";
import { FOCUS_RING_INSET } from "./LocationRow";

/** The search field that adds a location by name or address. */

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

type Suggestion = PlaceSuggestion;

/**
 * Compact address input field with Photon autocomplete (keyless, like in
 * the omnibox). Selecting a suggestion adds the location directly to the portfolio;
 * the auto-selection in `addAndAnalyze` makes the map fly to it. Arrow keys
 * move through the suggestions, Enter adds the highlighted one and Escape
 * closes the field.
 */
export function AddLocationField({
  onDone,
}: Readonly<{ onDone: () => void }>): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  /** Query the current suggestions (or the "no matches" note) belong to. */
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** Photon unreachable for the current answer: local suggestions only. */
  const [onlineUnavailable, setOnlineUnavailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryStatus = useDealerDirectoryStore((s) => s.status);
  const directoryUpdate = useDealerDirectoryStore((s) => s.update);
  const loadDirectoryStatus = useDealerDirectoryStore((s) => s.loadStatus);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (directoryStatus === undefined) void loadDirectoryStatus();
  }, [directoryStatus, loadDirectoryStatus]);

  const trimmed = value.trim();

  // Debounced autocomplete — discards stale responses.
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setAnsweredFor(null);
      setError(false);
      setOnlineUnavailable(false);
      return;
    }
    // Typed coordinates are the point itself; a place search would answer
    // them with unrelated places.
    const point = parseCoordinatePair(trimmed);
    if (point) {
      setSuggestions([{ label: coordinateLabel(point), ...point }]);
      setOnlineUnavailable(false);
      setError(false);
      setActive(0);
      setAnsweredFor(trimmed);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const result = await window.api.placesAutocomplete(
          trimmed,
          searchBias(),
        );
        if (!cancelled) {
          setSuggestions(result.suggestions);
          setOnlineUnavailable(result.onlineUnavailable);
          setActive(0);
          setAnsweredFor(trimmed);
        }
      } catch (e) {
        if (!cancelled) {
          // The raw IPC message ("Error invoking remote method …") is for
          // the log, not for the user.
          console.warn("Address autocomplete failed:", e);
          setSuggestions([]);
          setAnsweredFor(null);
          setOnlineUnavailable(false);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  function pick(s: Suggestion): void {
    const typedPoint = parseCoordinatePair(trimmed) != null;
    void useAppStore
      .getState()
      .addAndAnalyze([
        {
          id: crypto.randomUUID(),
          name: nameForPlace(s, useAppStore.getState().dealerships),
          // Coordinates are no address to look a parcel up by.
          address: typedPoint ? undefined : s.label,
          lat: s.lat,
          lon: s.lon,
        },
      ])
      .then((skipped) => {
        // Already in the portfolio: say so instead of doing nothing.
        if (skipped > 0)
          notify.info(t("start.duplicatesSkipped", { count: skipped }));
      })
      .catch((err: unknown) => {
        console.error("Adding the location failed:", err);
      });
    setValue("");
    setSuggestions([]);
    onDone();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    } else if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && suggestions.length > 0) {
      e.preventDefault();
      pick(suggestions[Math.min(active, suggestions.length - 1)]);
    }
  }

  const noMatches =
    !loading &&
    !error &&
    !onlineUnavailable &&
    answeredFor === trimmed &&
    trimmed.length >= MIN_CHARS &&
    suggestions.length === 0;

  return (
    <div>
      <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 focus-within:ring-[3px] focus-within:ring-ring/50">
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={value}
          placeholder={t("map.locationsPanel.addressPlaceholder")}
          className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t("map.locationsPanel.addAddress")}
          aria-keyshortcuts="Escape"
        />
        {loading && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t("map.locationsPanel.searchFailed")}
          <span className="block text-muted-foreground">
            {t("map.locationsPanel.searchFailedHint")}
          </span>
        </p>
      )}
      {onlineUnavailable && answeredFor === trimmed && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t(
            suggestions.length > 0
              ? "places.onlineUnavailable"
              : "places.onlineUnavailableNoLocal",
          )}
        </p>
      )}
      {noMatches && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t("ui.noMatches")}
        </p>
      )}
      {directoryStatus === null && trimmed.length >= MIN_CHARS && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("map.locationsPanel.directoryHintPrefix")}{" "}
          <Link to="/settings" className="underline underline-offset-2">
            {t("map.locationsPanel.directoryHintLink")}
          </Link>
        </p>
      )}
      {directoryUpdate?.updateAvailable && trimmed.length >= MIN_CHARS && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("places.updateAvailable", {
            release: directoryUpdate.latestRelease,
          })}{" "}
          <Link to="/settings" className="underline underline-offset-2">
            {t("places.updateLink")}
          </Link>
        </p>
      )}
      {suggestions.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded-md border bg-popover py-1">
          {suggestions.map((s, i) => (
            <li key={`${s.lat},${s.lon},${i}`}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent",
                  FOCUS_RING_INSET,
                  i === active && "bg-accent",
                )}
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span>{s.label}</span>
                  <PlacePortfolioBadge portfolio={s.portfolio} />
                  <PlaceApproximateNote approximate={s.approximate} />
                </span>
                <PlaceSourceTag source={s.source} sources={s.sources} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
