import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Loader2, MapPin, Paperclip, Send, Sparkles } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { classifyInput } from "@renderer/lib/classifyInput";
import { cn } from "@renderer/lib/utils";

export interface PlacePick {
  label: string;
  lat: number;
  lon: number;
}

/** The two explicit input modes of the omnibox. */
export type OmniMode = "address" | "chat";

interface Props {
  /** Selecting (or sending) an address incl. coordinates. */
  onPickAddress: (pick: PlacePick) => void;
  /** Sending a question → to the AI (portfolio chat). */
  onAskQuestion: (question: string) => void;
  /** Optional file upload (CSV/TSV/Excel) directly from the composer. */
  onUploadFile?: (file: File) => void | Promise<void>;
  /**
   * Restricted mode list, e.g. `["chat"]` for the chat panel without
   * address input. Default: both modes.
   */
  modes?: OmniMode[];
  disabled?: boolean;
  /** Smaller variant for the chat dock (narrower than the large start omnibox). */
  compact?: boolean;
}

interface Suggestion {
  label: string;
  lat: number;
  lon: number;
}

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

/** Mode-dependent UI text/icon bundle. */
function modeMeta(
  t: TFunction,
): Record<
  OmniMode,
  { icon: typeof MapPin; placeholder: string; helper: string }
> {
  return {
    address: {
      icon: MapPin,
      placeholder: t("upload.omnibox.address.placeholder"),
      helper: t("upload.omnibox.address.helper"),
    },
    chat: {
      icon: Sparkles,
      placeholder: t("upload.omnibox.chat.placeholder"),
      helper: t("upload.omnibox.chat.helper"),
    },
  };
}

/**
 * Unified composer (at the bottom of the app) with an **explicit mode switch**:
 *
 * - **Address:** OpenStreetMap autocomplete via Photon (keyless). Send/Enter
 *   adopts the top suggestion as the location.
 * - **Chat:** Send/Enter passes the question on to the portfolio chat.
 *
 * The starting mode is determined once via {@link classifyInput} over the (empty)
 * initial value; after that the user switches manually.
 */
export function Omnibox({
  onPickAddress,
  onAskQuestion,
  onUploadFile,
  modes,
  disabled,
  compact,
}: Readonly<Props>): React.JSX.Element {
  const { t } = useTranslation();
  const enabledModes: OmniMode[] = modes ?? ["address", "chat"];
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<OmniMode>(() => {
    const initial = classifyInput("") === "address" ? "address" : "chat";
    return enabledModes.includes(initial)
      ? initial
      : (enabledModes[0] ?? "chat");
  });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const isAddress = mode === "address";
  const trimmed = value.trim();
  // Sending is possible when a suggestion is present in address mode, or
  // text was typed in chat/dashboard mode.
  const canSend =
    !disabled && (isAddress ? suggestions.length > 0 : trimmed.length > 0);

  // Debounced autocomplete — only in address mode; discards stale responses.
  useEffect(() => {
    if (!isAddress || trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setError(null);
      setOpen(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const hits = await window.api.placesAutocomplete(trimmed);
        if (!cancelled) {
          setSuggestions(hits);
          setOpen(true);
        }
      } catch (e) {
        if (!cancelled) {
          setSuggestions([]);
          setError(
            e instanceof Error ? e.message : t("upload.omnibox.searchFailed"),
          );
          setOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, isAddress, t]);

  // Clicking outside closes the suggestion list.
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(s: Suggestion): void {
    onPickAddress({ label: s.label, lat: s.lat, lon: s.lon });
    setValue("");
    setSuggestions([]);
    setOpen(false);
  }

  /** Primary action per mode: adopt an address or send a chat question. */
  function submit(): void {
    if (isAddress) {
      if (suggestions.length > 0) pick(suggestions[0]);
      return;
    }
    if (!trimmed) return;
    onAskQuestion(trimmed);
    setValue("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  /** File selected → pass to the parent handler, reset input for re-upload. */
  async function onFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (file && onUploadFile) await onUploadFile(file);
    if (uploadRef.current) uploadRef.current.value = "";
  }

  const meta = modeMeta(t)[mode];
  const Icon = meta.icon;

  let dropdownBody: React.JSX.Element;
  if (error) {
    dropdownBody = (
      <p className="px-3 py-2 text-sm text-destructive">{error}</p>
    );
  } else if (suggestions.length === 0) {
    dropdownBody = (
      <p className="px-3 py-2 text-sm text-muted-foreground">
        {loading
          ? t("upload.omnibox.searching")
          : t("upload.omnibox.noResults")}
      </p>
    );
  } else {
    dropdownBody = (
      <ul className="max-h-64 overflow-auto py-1">
        {suggestions.map((s, i) => (
          <li key={`${s.lat},${s.lon},${i}`}>
            <button
              type="button"
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                "hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => pick(s)}
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      {enabledModes.length > 1 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={mode}
            onValueChange={(v) => {
              // Radix fires "" when re-clicking the active item → ignore it.
              if (v) setMode(v as OmniMode);
            }}
            className="shrink-0 justify-start"
          >
            {enabledModes.includes("address") && (
              <ToggleGroupItem
                value="address"
                aria-label={t("upload.omnibox.addressToggleAriaLabel")}
                className="flex-none gap-1.5"
              >
                <MapPin className="size-4" />
                {t("upload.omnibox.addressToggleLabel")}
              </ToggleGroupItem>
            )}
            {enabledModes.includes("chat") && (
              <ToggleGroupItem
                value="chat"
                aria-label={t("upload.omnibox.chatToggleAriaLabel")}
                className="flex-none gap-1.5"
              >
                <Sparkles className="size-4" />
                {t("upload.omnibox.chatToggleLabel")}
              </ToggleGroupItem>
            )}
          </ToggleGroup>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {meta.helper}
          </p>
        </div>
      )}

      {open && isAddress && (trimmed.length >= MIN_CHARS || error) && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {dropdownBody}
          <div className="border-t px-3 py-1 text-right text-[10px] text-muted-foreground">
            © OpenStreetMap · Photon
          </div>
        </div>
      )}

      <div className="group relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-0.5 rounded-xl bg-gradient-to-r from-primary/40 via-primary/15 to-primary/40 opacity-0 blur-md transition-opacity duration-300 group-focus-within:opacity-100"
        />
        <div
          className={cn(
            "relative flex items-center gap-2 rounded-xl border bg-background shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring/40",
            compact ? "px-2.5 py-1.5" : "px-3 py-2",
          )}
        >
          <Icon
            className={cn(
              "shrink-0 text-muted-foreground",
              compact ? "size-4" : "size-5",
            )}
          />
          <input
            value={value}
            disabled={disabled}
            placeholder={meta.placeholder}
            className={cn(
              "flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:opacity-50",
              compact ? "text-sm" : "text-base",
            )}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => isAddress && suggestions.length > 0 && setOpen(true)}
          />
          {loading && (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
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
                className={cn(
                  "shrink-0 rounded-full text-muted-foreground",
                  compact ? "size-7" : "size-9",
                )}
                onClick={() => uploadRef.current?.click()}
                disabled={disabled}
                title={t("upload.omnibox.importFile")}
                aria-label={t("upload.omnibox.importFile")}
              >
                <Paperclip className={compact ? "size-3.5" : "size-4"} />
              </Button>
            </>
          )}
          <Button
            size="icon"
            className={cn(
              "shrink-0 rounded-full",
              compact ? "size-7" : "size-9",
            )}
            onClick={submit}
            disabled={!canSend}
            title={t("upload.omnibox.send")}
            aria-label={t("upload.omnibox.send")}
          >
            <Send className={compact ? "size-3.5" : "size-4"} />
          </Button>
        </div>
      </div>
    </div>
  );
}
