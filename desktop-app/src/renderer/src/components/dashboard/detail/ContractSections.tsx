import {
  formatParameterValue,
  parseLocaleNumber,
} from "@renderer/components/parameters/parameterInput";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@renderer/lib/notify";
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

  // Amount fields whose last input could not be read; the stored value stays.
  const [invalidAmounts, setInvalidAmounts] = useState<
    Partial<Record<"productLimitEur" | "deductibleEur", boolean>>
  >({});
  useEffect(() => setInvalidAmounts({}), [d.id]);

  // The inputs are uncontrolled; the key ties each one to its location, so
  // paging in the dialog never shows (or writes back) the previous
  // location's text.
  const textField = (
    label: string,
    key: "salesPartner" | "subPortfolio" | "group",
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        key={`${key}-${d.id}-${d[key] ?? ""}`}
        defaultValue={d[key] ?? ""}
        onBlur={(e) => {
          const next = e.target.value.trim() || undefined;
          if (next !== (d[key] ?? undefined)) updateMeta(d.id, { [key]: next });
        }}
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
        // Remount for another location and when the stored value changes
        // (e.g. after an import).
        key={`${key}-${d.id}-${d[key] ?? ""}`}
        type="text"
        inputMode="decimal"
        aria-invalid={invalidAmounts[key] ? true : undefined}
        aria-describedby={
          invalidAmounts[key] ? `${key}-${d.id}-error` : undefined
        }
        defaultValue={
          d[key] != null ? formatParameterValue(d[key], uiLocale()) : ""
        }
        onBlur={(e) => {
          const raw = e.target.value.replace(/€/g, "").trim();
          // An emptied field removes the amount; anything unreadable keeps
          // the stored one and is marked instead of deleting it silently.
          const n = raw ? parseLocaleNumber(raw, uiLocale()) : undefined;
          const invalid =
            n !== undefined && (!Number.isFinite(n) || n < 0 || n > 1e12);
          setInvalidAmounts((current) => ({ ...current, [key]: invalid }));
          if (invalid || n === d[key]) return;
          updateMeta(d.id, { [key]: n });
        }}
      />
      {invalidAmounts[key] && (
        <p
          id={`${key}-${d.id}-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {t("dashboard.detailDialog.amountInvalid")}
        </p>
      )}
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
      notify.failed(error, t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  // `save` reads the latest draft through the ref; each keystroke restarts
  // the wait.
  const saveLater = useEffectEvent(() => void save());
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => saveLater(), NOTES_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
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
