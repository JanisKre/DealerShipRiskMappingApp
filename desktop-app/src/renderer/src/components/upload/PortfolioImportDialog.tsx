import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  FilePlus2,
  FolderInput,
  Loader2,
  MapPin,
  Pencil,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { ImportResult } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { Checkbox } from "@renderer/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
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
import {
  buildPreviewRows,
  editPreviewRow,
  needsAttention,
  skippedIssues,
  type PreviewRow,
} from "./importPreview";
import { portfolioName } from "@renderer/lib/portfolioName";

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
  "website",
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
      // The technical reason stays available, below a plain explanation.
      toast.error(t("portfolioImport.parseFailedTitle"), {
        description: t("portfolioImport.parseFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  }

  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      {/* The body scrolls; header and footer (the import button) stay in
          view at any window height. */}
      <DialogContent
        className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
        onEscapeKeyDown={keepOpenWhileEditing}
      >
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

/**
 * Escape inside an inline row edit cancels that edit, not the whole import.
 * Radix listens for Escape on the document in the capture phase, so the
 * input's own `stopPropagation` comes too late; the dialog has to opt out.
 */
function keepOpenWhileEditing(event: KeyboardEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-inline-edit]")) event.preventDefault();
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
  const existing = useAppStore((s) => s.dealerships);
  const currentCount = existing.length;
  const { result, fileName } = pending;
  const { report, rows } = result;
  const businessColumn = report.columnMapping.insured ?? null;

  const [target, setTarget] = useState<"new" | "current">("new");
  const [name, setName] = useState(() => fileName.replace(/\.[^.]+$/, ""));
  const [business, setBusiness] = useState<ImportBusinessMode | null>(
    businessColumn ? "file" : null,
  );
  const intoCurrent = currentCount > 0 && target === "current";

  // Preview rows: duplicates against the portfolio only count when the rows
  // go into it. Edits and ticks are kept per row across that switch.
  const base = useMemo(
    () =>
      buildPreviewRows(
        rows,
        result.rowNumbers,
        report.issues,
        intoCurrent ? existing : [],
      ),
    [rows, result.rowNumbers, report.issues, intoCurrent, existing],
  );
  const [overrides, setOverrides] = useState<
    Record<string, { name?: string; address?: string; include?: boolean }>
  >({});
  const preview = useMemo(
    () =>
      base.map((row) => {
        const o = overrides[row.row.id];
        if (!o) return row;
        const edited =
          o.name !== undefined || o.address !== undefined
            ? editPreviewRow(row, { name: o.name, address: o.address })
            : row;
        return o.include === undefined
          ? edited
          : { ...edited, include: o.include && edited.placement !== "missing" };
      }),
    [base, overrides],
  );
  const selected = preview.filter((row) => row.include);
  const skipped = useMemo(
    () => skippedIssues(report.issues, result.rowNumbers),
    [report.issues, result.rowNumbers],
  );
  const patchRow = (
    id: string,
    patch: { name?: string; address?: string; include?: boolean },
  ): void =>
    setOverrides((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));

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
        rows: selected.map((row) => row.row),
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

      <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-1">
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
                title={t("portfolioImport.targetCurrent", {
                  name: portfolioName(currentName, t),
                })}
              />
            </div>
          </fieldset>
        )}

        <ImportPreviewTable
          rows={preview}
          skipped={skipped}
          onPatch={patchRow}
          onToggleAll={(include) =>
            setOverrides((current) => {
              const next = { ...current };
              for (const row of preview)
                next[row.row.id] = { ...next[row.row.id], include };
              return next;
            })
          }
        />

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
      </div>

      <DialogFooter className="gap-2 sm:items-center">
        {analyzing && (
          <span className="text-xs text-muted-foreground sm:mr-auto">
            {t("portfolioImport.waitForAnalysis")}
          </span>
        )}
        <Button variant="outline" onClick={onDone}>
          {t("portfolioImport.cancel")}
        </Button>
        <Button
          disabled={!business || analyzing || selected.length === 0}
          onClick={confirm}
        >
          {t("portfolioImport.confirm", { count: selected.length })}
        </Button>
      </DialogFooter>
    </>
  );
}

type AddressCheck =
  | { state: "checking" }
  | { state: "found"; label: string }
  | { state: "notFound" }
  | { state: "error" };

/**
 * Row-by-row preview before anything is analysed: how each row will be
 * placed, parser notes, duplicates, a tick to leave rows out and an inline
 * fix for name and address. "Check addresses" geocodes the address rows
 * one by one (Nominatim allows one request per second); the results land in
 * the same cache the analysis uses, so nothing is looked up twice.
 */
function ImportPreviewTable({
  rows,
  skipped,
  onPatch,
  onToggleAll,
}: Readonly<{
  rows: PreviewRow[];
  skipped: Array<{ row: number; message: string }>;
  onPatch: (
    id: string,
    patch: { name?: string; address?: string; include?: boolean },
  ) => void;
  onToggleAll: (include: boolean) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const flagged = rows.filter(needsAttention);
  const [onlyFlagged, setOnlyFlagged] = useState(flagged.length > 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", address: "" });
  const [checks, setChecks] = useState<Record<string, AddressCheck>>({});
  const [checking, setChecking] = useState(false);
  const cancelRef = useRef(false);
  useEffect(
    () => () => {
      cancelRef.current = true;
    },
    [],
  );

  const shown = onlyFlagged ? flagged : rows;
  const toCheck = rows.filter(
    (row) => row.include && row.placement === "address" && !checks[row.row.id],
  );
  const allIncluded = rows.length > 0 && rows.every((row) => row.include);

  async function checkAddresses(): Promise<void> {
    cancelRef.current = false;
    setChecking(true);
    for (const row of toCheck) {
      if (cancelRef.current) break;
      const id = row.row.id;
      setChecks((c) => ({ ...c, [id]: { state: "checking" } }));
      try {
        const [hit] = await window.api.geocode(row.row.address ?? "");
        setChecks((c) => ({
          ...c,
          [id]: hit
            ? { state: "found", label: hit.label }
            : { state: "notFound" },
        }));
      } catch {
        setChecks((c) => ({ ...c, [id]: { state: "error" } }));
      }
    }
    setChecking(false);
  }

  function startEdit(row: PreviewRow): void {
    setEditingId(row.row.id);
    setDraft({ name: row.row.name, address: row.row.address ?? "" });
  }
  function commitEdit(id: string): void {
    onPatch(id, { name: draft.name, address: draft.address });
    setChecks((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
    setEditingId(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm font-semibold">
          {t("importPreview.title")}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t("importPreview.selected", {
              selected: rows.filter((r) => r.include).length,
              total: rows.length,
            })}
          </span>
        </div>
        {flagged.length > 0 && (
          <Button
            size="sm"
            variant={onlyFlagged ? "secondary" : "ghost"}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setOnlyFlagged((v) => !v)}
            aria-pressed={onlyFlagged}
          >
            <TriangleAlert className="size-3.5" />
            {t("importPreview.onlyFlagged", { count: flagged.length })}
          </Button>
        )}
        {checking ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            <Loader2 className="size-3.5 animate-spin" />
            {t("importPreview.stopCheck")}
          </Button>
        ) : (
          toCheck.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void checkAddresses()}
            >
              <Search className="size-3.5" />
              {t("importPreview.checkAddresses", { count: toCheck.length })}
            </Button>
          )
        )}
      </div>

      <div className="max-h-72 overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allIncluded}
                  onCheckedChange={(v) => onToggleAll(v === true)}
                  aria-label={t("importPreview.toggleAll")}
                />
              </TableHead>
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead>{t("importPreview.location")}</TableHead>
              <TableHead className="w-48">
                {t("importPreview.placement")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-4 text-center text-xs text-muted-foreground"
                >
                  {t("importPreview.nothingFlagged")}
                </TableCell>
              </TableRow>
            )}
            {shown.map((row) => {
              const id = row.row.id;
              const check = checks[id];
              const notes = [
                ...(row.duplicateOfExisting
                  ? [
                      t("importPreview.duplicateExisting", {
                        name: row.duplicateOfExisting,
                      }),
                    ]
                  : []),
                ...(row.duplicateOfRow != null
                  ? [
                      t("importPreview.duplicateRow", {
                        row: row.duplicateOfRow,
                      }),
                    ]
                  : []),
                ...row.issues.map((issue) => issue.message),
              ];
              return (
                <TableRow key={id} className={row.include ? "" : "opacity-60"}>
                  <TableCell className="align-top">
                    <Checkbox
                      checked={row.include}
                      disabled={row.placement === "missing"}
                      onCheckedChange={(v) =>
                        onPatch(id, { include: v === true })
                      }
                      aria-label={t("importPreview.include", {
                        name: row.row.name,
                      })}
                    />
                  </TableCell>
                  <TableCell className="align-top text-right text-xs tabular-nums text-muted-foreground">
                    {row.sourceRow ?? ""}
                  </TableCell>
                  <TableCell className="min-w-0 whitespace-normal align-top">
                    {editingId === id ? (
                      <div className="space-y-1" data-inline-edit>
                        <Input
                          autoFocus
                          value={draft.name}
                          aria-label={t("importPreview.nameLabel")}
                          onChange={(e) =>
                            setDraft((v) => ({ ...v, name: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit(id);
                            }
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditingId(null);
                            }
                          }}
                          className="h-7 text-sm"
                        />
                        <Input
                          value={draft.address}
                          aria-label={t("importPreview.addressLabel")}
                          placeholder={t("importPreview.addressLabel")}
                          onChange={(e) =>
                            setDraft((v) => ({ ...v, address: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit(id);
                            }
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditingId(null);
                            }
                          }}
                          className="h-7 text-sm"
                        />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => commitEdit(id)}
                          >
                            {t("importPreview.apply")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() => setEditingId(null)}
                          >
                            {t("common.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="group flex items-start gap-1">
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-medium">
                            {row.row.name}
                          </div>
                          <div className="break-words text-xs text-muted-foreground">
                            {row.row.address ?? t("importPreview.noAddress")}
                          </div>
                          {notes.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5 text-xs text-warning-foreground">
                              {notes.map((note) => (
                                <li key={note}>{note}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => startEdit(row)}
                          aria-label={t("importPreview.edit", {
                            name: row.row.name,
                          })}
                        >
                          <Pencil className="size-3" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal align-top text-xs">
                    <PlacementCell row={row} check={check} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {skipped.length > 0 && (
        <details className="rounded-md border text-xs">
          <summary className="px-3 py-1.5 text-muted-foreground">
            {t("importPreview.skippedRows", {
              count: new Set(skipped.map((s) => s.row)).size,
            })}
          </summary>
          <ul className="max-h-32 space-y-0.5 overflow-auto border-t px-3 py-2">
            {skipped.map((issue, index) => (
              <li key={`${issue.row}-${index}`}>
                <span className="tabular-nums text-muted-foreground">
                  {t("importPreview.rowLabel", { row: issue.row })}
                </span>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PlacementCell({
  row,
  check,
}: Readonly<{ row: PreviewRow; check?: AddressCheck }>): React.JSX.Element {
  const { t } = useTranslation();
  if (row.placement === "coordinates") {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <MapPin className="size-3.5 shrink-0" />
        {t("importPreview.fromFile")}
      </span>
    );
  }
  if (row.placement === "missing") {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <TriangleAlert className="size-3.5 shrink-0" />
        {t("importPreview.cannotPlace")}
      </span>
    );
  }
  if (!check)
    return (
      <span className="text-muted-foreground">
        {t("importPreview.willGeocode")}
      </span>
    );
  if (check.state === "checking")
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t("importPreview.checking")}
      </span>
    );
  if (check.state === "found")
    return (
      <span className="flex items-start gap-1 text-success">
        <Check className="mt-px size-3.5 shrink-0" />
        <span className="line-clamp-2 break-words">{check.label}</span>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <TriangleAlert className="size-3.5 shrink-0" />
      {check.state === "notFound"
        ? t("importPreview.notFound")
        : t("importPreview.checkFailed")}
    </span>
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
        "flex w-full items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
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
