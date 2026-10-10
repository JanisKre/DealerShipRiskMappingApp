import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FilePlus2, FolderInput } from "lucide-react";
import type { ImportResult } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { cn } from "@renderer/lib/utils";
import { type ImportBusinessMode, useAppStore } from "@renderer/store/appStore";

interface PendingImport {
  fileName: string;
  result: ImportResult;
}

/** Mapped fields shown in the dialog, in display order. */
const MAPPED_FIELDS = [
  "name",
  "address",
  "lat",
  "lon",
  "assetValue",
  "insured",
  "productLimitEur",
  "deductibleEur",
  "salesPartner",
  "subPortfolio",
  "group",
] as const;

/**
 * Portfolio upload: parses the CSV/TSV/Excel file, then asks where the rows
 * go (a new portfolio named after the file, or the current one) and whether
 * they are existing or new business before analysing them. Shared by the
 * start page and the location list.
 */
export function usePortfolioImport(onImported?: () => void): {
  startImport: (file: File) => Promise<void>;
  dialog: React.JSX.Element;
} {
  const { t } = useTranslation();
  const setImportReport = useAppStore((s) => s.setImportReport);
  const [pending, setPending] = useState<PendingImport | null>(null);

  async function startImport(file: File): Promise<void> {
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const result = isXlsx
        ? await window.api.parseXlsx(
            arrayBufferToBase64(await file.arrayBuffer()),
          )
        : await window.api.parseCsv(await file.text());
      if (result.rows.length === 0) {
        setImportReport(result.report);
        toast.warning(t("ui.noRowsFound"));
        return;
      }
      setPending({ fileName: file.name, result });
    } catch (error) {
      toast.error(
        t("portfolioImport.parseFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-lg overflow-auto">
        {pending && (
          <ImportForm
            pending={pending}
            onDone={() => {
              setPending(null);
              onImported?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );

  return { startImport, dialog };
}

function ImportForm({
  pending,
  onDone,
}: {
  pending: PendingImport;
  onDone: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const importPortfolio = useAppStore((s) => s.importPortfolio);
  const analyzing = useAppStore((s) => s.analyzing);
  const currentName = useAppStore((s) => s.sessionName);
  const currentCount = useAppStore((s) => s.dealerships.length);
  const { result, fileName } = pending;
  const { report, rows } = result;
  const businessColumn = report.columnMapping.insured ?? null;

  const [target, setTarget] = useState<"new" | "current">("new");
  const [name, setName] = useState(() => fileName.replace(/\.[^.]+$/, ""));
  const [business, setBusiness] = useState<ImportBusinessMode | null>(
    businessColumn ? "file" : null,
  );

  const fromFile = useMemo(() => {
    let existing = 0;
    let fresh = 0;
    for (const row of rows) {
      if (row.insured === true) existing++;
      else if (row.insured === false) fresh++;
    }
    return { existing, fresh, unknown: rows.length - existing - fresh };
  }, [rows]);

  const mapped = MAPPED_FIELDS.flatMap((field) => {
    const column = report.columnMapping[field];
    return column ? [{ field, column }] : [];
  });

  /**
   * Closes right away: the rows show up as pins immediately and the
   * analysis runs in the background, so `importPortfolio` (which resolves
   * when the analysis is done) is not awaited by the dialog.
   */
  function confirm(): void {
    if (!business) return;
    onDone();
    void runImport(business);
  }

  async function runImport(mode: ImportBusinessMode): Promise<void> {
    try {
      const skipped = await importPortfolio({
        rows,
        target: currentCount === 0 ? "current" : target,
        name,
        business: mode,
        report,
      });
      if (skipped > 0)
        toast.info(t("start.duplicatesSkipped", { count: skipped }));
      if (report.issues.length > 0)
        toast.info(
          t("ui.importIssuesRecorded", { count: report.issues.length }),
        );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  const showTarget = currentCount > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("portfolioImport.title")}</DialogTitle>
        <DialogDescription>
          {t("portfolioImport.summary", {
            file: fileName,
            imported: report.importedRows,
            total: report.totalRows,
          })}
          {report.skippedRows > 0 &&
            ` ${t("portfolioImport.skipped", { count: report.skippedRows })}`}
          {report.issues.length > 0 &&
            ` ${t("portfolioImport.issues", { count: report.issues.length })}`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">
          {t("portfolioImport.detectedColumns")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {mapped.map(({ field, column }) => (
            <span
              key={field}
              className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
              title={column}
            >
              <span className="text-muted-foreground">
                {t(`portfolioImport.field.${field}`)}
              </span>{" "}
              ← {column}
            </span>
          ))}
        </div>
        {!report.columnMapping.productLimitEur &&
          !report.columnMapping.deductibleEur && (
            <p className="text-xs text-muted-foreground">
              {t("portfolioImport.noTermsColumns")}
            </p>
          )}
      </div>

      {showTarget && (
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-semibold">
            {t("portfolioImport.targetTitle")}
          </legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            <OptionCard
              selected={target === "new"}
              onSelect={() => setTarget("new")}
              icon={<FilePlus2 className="size-4" />}
              title={t("portfolioImport.targetNew")}
            />
            <OptionCard
              selected={target === "current"}
              onSelect={() => setTarget("current")}
              icon={<FolderInput className="size-4" />}
              title={t("portfolioImport.targetCurrent", { name: currentName })}
            />
          </div>
        </fieldset>
      )}

      {(target === "new" || !showTarget) && (
        <div className="space-y-1.5">
          <Label htmlFor="portfolio-import-name">
            {t("portfolioImport.nameLabel")}
          </Label>
          <Input
            id="portfolio-import-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-semibold">
          {t("portfolioImport.businessTitle")}
        </legend>
        <div role="radiogroup" className="grid gap-2">
          {businessColumn && (
            <OptionCard
              selected={business === "file"}
              onSelect={() => setBusiness("file")}
              title={t("portfolioImport.businessFile", {
                column: businessColumn,
              })}
              description={t("portfolioImport.businessFileCounts", {
                existing: fromFile.existing,
                fresh: fromFile.fresh,
                unknown: fromFile.unknown,
              })}
            />
          )}
          <OptionCard
            selected={business === "existing"}
            onSelect={() => setBusiness("existing")}
            title={t("portfolioImport.businessExisting")}
            description={t("portfolioImport.businessExistingDesc")}
          />
          <OptionCard
            selected={business === "new"}
            onSelect={() => setBusiness("new")}
            title={t("portfolioImport.businessNew")}
            description={t("portfolioImport.businessNewDesc")}
          />
        </div>
        {!business && (
          <p className="text-xs text-muted-foreground">
            {t("portfolioImport.businessRequired")}
          </p>
        )}
      </fieldset>

      <DialogFooter className="gap-2 sm:items-center">
        {analyzing && (
          <span className="text-xs text-muted-foreground sm:mr-auto">
            {t("portfolioImport.waitForAnalysis")}
          </span>
        )}
        <Button variant="outline" onClick={onDone}>
          {t("portfolioImport.cancel")}
        </Button>
        <Button disabled={!business || analyzing} onClick={confirm}>
          {t("portfolioImport.confirm", { count: rows.length })}
        </Button>
      </DialogFooter>
    </>
  );
}

function OptionCard({
  selected,
  onSelect,
  title,
  description,
  icon,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-primary/5 ring-1 ring-primary",
      )}
    >
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

/** ArrayBuffer -> base64 (for XLSX transport over IPC). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
