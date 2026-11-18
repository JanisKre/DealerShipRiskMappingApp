import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Globe,
  Loader2,
  Mail,
  Pencil,
  Phone,
  RotateCcw,
  Tag,
  X,
} from "lucide-react";
import type { AnalyzedDealership, OsmDetails } from "@shared/types";
import {
  isUserWebsiteSource,
  WEBSITE_URL_MAX_LENGTH,
  websiteLabel,
} from "@shared/website";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { useAppStore } from "@renderer/store/appStore";

/**
 * Loads additional OSM info (website, phone, opening hours, brand, ...) for a
 * coordinate — shared by `WebsiteRow` (website link) and
 * `OsmDetailsSection` (full view) so it's only fetched once per location.
 */
export function useOsmDetails(
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
export function googleMapsUrl(d: AnalyzedDealership): string {
  const query = [d.name, d.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** OpenStreetMap link for the coordinate. */
export function openStreetMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

/**
 * The dealership's website: the stored link (manual or a previous OSM hit),
 * else the one OpenStreetMap just found — which is then stored, so the map
 * popup and later visits have it too. A manual link always wins; resetting
 * it falls back to the automatic lookup.
 */
export function WebsiteRow({
  d,
  detectedWebsite,
  detecting,
}: {
  d: AnalyzedDealership;
  detectedWebsite?: string;
  detecting: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const updateWebsite = useAppStore((s) => s.updateDealershipWebsite);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (detectedWebsite && !isUserWebsiteSource(d.websiteSource))
      void updateWebsite(d.id, detectedWebsite, "osm").catch((err: unknown) => {
        console.error("Storing the detected website failed:", err);
      });
  }, [d.id, d.websiteSource, detectedWebsite, updateWebsite]);

  useEffect(() => {
    setEditing(false);
  }, [d.id]);

  // Typed and imported links are the user's: shown with their origin and
  // never replaced by the automatic lookup.
  const userProvided = isUserWebsiteSource(d.websiteSource);
  const website = d.website ?? (userProvided ? undefined : detectedWebsite);

  function startEditing(): void {
    setDraft(website ?? "");
    setInvalid(false);
    setEditing(true);
  }

  async function apply(value: string | null): Promise<void> {
    setSaving(true);
    try {
      const ok = await updateWebsite(d.id, value, "manual");
      if (!ok) {
        setInvalid(true);
        return;
      }
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(draft.trim() === "" ? null : draft);
        }}
      >
        <div className="flex items-center gap-2">
          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={draft}
            maxLength={WEBSITE_URL_MAX_LENGTH}
            placeholder="https://www.autohaus-beispiel.de"
            aria-label={t("dashboard.detailDialog.websiteEditLabel")}
            aria-invalid={invalid}
            className="h-8"
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={saving}
            title={t("dashboard.detailDialog.websiteSave")}
          >
            <Check className="size-3.5" />
            <span className="sr-only">
              {t("dashboard.detailDialog.websiteSave")}
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setEditing(false)}
            title={t("dashboard.detailDialog.websiteCancel")}
          >
            <X className="size-3.5" />
            <span className="sr-only">
              {t("dashboard.detailDialog.websiteCancel")}
            </span>
          </Button>
        </div>
        {invalid && (
          <p role="alert" className="text-xs text-destructive">
            {t("dashboard.detailDialog.websiteInvalid")}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
      {website ? (
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-primary hover:underline"
          title={website}
        >
          {websiteLabel(website)}
        </a>
      ) : detecting ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("dashboard.detailDialog.websiteDetecting")}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.websiteNone")}
        </span>
      )}
      {website && (
        <span className="text-xs text-muted-foreground">
          {d.websiteSource === "import"
            ? t("dashboard.detailDialog.websiteSourceImport")
            : d.websiteSource === "manual"
              ? t("dashboard.detailDialog.websiteSourceManual")
              : t("dashboard.detailDialog.websiteSourceOsm")}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={startEditing}
        >
          <Pencil className="size-3" />
          {website
            ? t("dashboard.detailDialog.websiteEdit")
            : t("dashboard.detailDialog.websiteAdd")}
        </Button>
        {userProvided && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            disabled={saving}
            onClick={() => void apply(null)}
          >
            <RotateCcw className="size-3" />
            {t("dashboard.detailDialog.websiteReset")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Additional info from OpenStreetMap (phone, opening hours, brand, ...) — the
 * website is already in `WebsiteRow`, not duplicated here. Hides itself
 * entirely when OSM has none of these tags for the location.
 */
export function OsmDetailsSection({
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
