import {
  formatParameterValue,
  parseLocaleNumber,
} from "@renderer/components/parameters/parameterInput";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { StickyNote } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { DEALERSHIP_NOTES_MAX_LENGTH } from "@shared/constants";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { Textarea } from "@renderer/components/ui/textarea";
import { useAppStore } from "@renderer/store/appStore";
import { uiLocale } from "@renderer/lib/format";

/**
 * Editable portfolio metadata: business type (existing vs. new business),
 * sales partner, sub-portfolio, group, maximum indemnity, and deductible. Writes directly
 * to the store (`updateDealershipMeta`); text fields commit on blur.
 */
export function PortfolioMetaSection({
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

  // Amounts in the UI notation ("3.967.001 €"), read back with the same
  // locale rules as the parameters page (UW-30).
  const amountField = (
    label: string,
    key: "productLimitEur" | "deductibleEur",
  ): React.JSX.Element => (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <Label htmlFor={`${key}-${d.id}`} className="text-xs font-normal">
        {label}
      </Label>
      <Input
        id={`${key}-${d.id}`}
        // Remount when the stored value changes (e.g. after an import).
        key={`${key}-${d[key] ?? ""}`}
        type="text"
        inputMode="decimal"
        defaultValue={
          d[key] != null ? formatParameterValue(d[key], uiLocale()) : ""
        }
        onBlur={(e) => {
          const raw = e.target.value.replace(/€/g, "").trim();
          const n = raw ? parseLocaleNumber(raw, uiLocale()) : Number.NaN;
          updateMeta(d.id, {
            [key]: raw && !Number.isNaN(n) && n >= 0 ? n : undefined,
          });
        }}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {/* A two-way choice instead of a switch whose label ("Bestand") and
          description ("Neugeschäft") contradicted each other when off. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">
            {t("dashboard.detailDialog.businessTypeLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {d.insured
              ? t("dashboard.detailDialog.insuredYesDesc")
              : t("dashboard.detailDialog.insuredNoDesc")}
          </p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={d.insured ? "existing" : "new"}
          onValueChange={(v) =>
            v && updateMeta(d.id, { insured: v === "existing" })
          }
        >
          <ToggleGroupItem value="new" className="px-3">
            {t("dashboard.detailDialog.businessNew")}
          </ToggleGroupItem>
          <ToggleGroupItem value="existing" className="px-3">
            {t("dashboard.detailDialog.businessExisting")}
          </ToggleGroupItem>
        </ToggleGroup>
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
        {amountField(
          t("dashboard.detailDialog.productLimitLabel"),
          "productLimitEur",
        )}
        {amountField(
          t("dashboard.detailDialog.deductibleLabel"),
          "deductibleEur",
        )}
      </div>
    </div>
  );
}

/** Pause after typing before notes are saved on their own. */
const NOTES_AUTOSAVE_MS = 800;

/**
 * Free-text underwriting notes for one location, stored with the portfolio.
 * Saved automatically a moment after typing stops, on blur, and when the
 * dialog closes, so there is no save button to forget.
 */
export function NotesSection({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const updateNotes = useAppStore((s) => s.updateDealershipNotes);
  const [draft, setDraft] = useState(d.notes ?? "");
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setDraft(d.notes ?? "");
  }, [d.id, d.notes]);

  // Flush unsaved text on unmount (dialog closed or another location opened).
  useEffect(() => {
    const id = d.id;
    return () => {
      void useAppStore
        .getState()
        .updateDealershipNotes(id, draftRef.current)
        .catch((err: unknown) => {
          console.error("Saving notes on close failed:", err);
        });
    };
  }, [d.id]);

  const dirty = (draft.trim() === "" ? "" : draft) !== (d.notes ?? "");

  async function save(): Promise<void> {
    if (!dirty) return;
    setSaving(true);
    try {
      await updateNotes(d.id, draftRef.current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void save(), NOTES_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // `save` reads the latest draft through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty]);

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={`notes-${d.id}`}
        className="flex items-center gap-1.5 text-sm font-semibold"
      >
        <StickyNote className="size-3.5 text-muted-foreground" />
        {t("dashboard.detailDialog.notesTitle")}
      </Label>
      <Textarea
        id={`notes-${d.id}`}
        value={draft}
        rows={4}
        maxLength={DEALERSHIP_NOTES_MAX_LENGTH}
        placeholder={t("dashboard.detailDialog.notesPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
      />
      <p className="text-[11px] text-muted-foreground">
        {saving || dirty
          ? t("dashboard.detailDialog.notesSaving")
          : !d.notes
            ? t("dashboard.detailDialog.notesEmpty")
            : d.notesUpdatedAt
              ? t("dashboard.detailDialog.notesUpdatedAt", {
                  date: new Date(d.notesUpdatedAt).toLocaleString(
                    i18n.language,
                  ),
                })
              : t("dashboard.detailDialog.notesSaved")}
      </p>
    </div>
  );
}
