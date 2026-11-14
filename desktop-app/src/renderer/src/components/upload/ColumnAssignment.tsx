import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import {
  IMPORT_FIELDS,
  MAPPING_MAX_COLUMNS,
  type ColumnOverrides,
  type ImportColumn,
  type ImportField,
} from "@shared/import-fields";
import { Button } from "@renderer/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { useLlmReady } from "@renderer/lib/useLlmReady";

const UNUSED = "__unused";

function sameOverrides(a: ColumnOverrides, b: ColumnOverrides): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k as ImportField] === b[k as ImportField]);
}

/**
 * Columns the parser did not use, each assignable to a field that no
 * recognised column feeds yet. "Apply" parses the file again with the
 * assignment. Works without AI; with an AI provider, "Suggest" prefills the
 * choices from header names and type hints (no cell values are sent).
 */
export function ColumnAssignment({
  columns,
  overrides,
  onApply,
}: Readonly<{
  columns: ImportColumn[];
  overrides: ColumnOverrides;
  onApply: (overrides: ColumnOverrides) => Promise<void>;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const llmReady = useLlmReady();
  const [open, setOpen] = useState(Object.keys(overrides).length > 0);
  const [draft, setDraft] = useState<ColumnOverrides>(overrides);
  const [applying, setApplying] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const assigned = useMemo(
    () => new Set(Object.values(overrides)),
    [overrides],
  );
  const rows = columns.filter(
    (c) => assigned.has(c.name) || (c.field == null && c.hint !== "empty"),
  );
  // Fields fed by a recognised column (not by an assignment made here).
  const detected = useMemo(
    () =>
      new Set(
        columns.flatMap((c) =>
          c.field && !assigned.has(c.name) ? [c.field] : [],
        ),
      ),
    [columns, assigned],
  );
  if (rows.length === 0) return null;

  const fieldOf = (column: string): ImportField | undefined =>
    (Object.entries(draft) as Array<[ImportField, string]>).find(
      ([, c]) => c === column,
    )?.[0];
  const choices = (column: string): ImportField[] =>
    IMPORT_FIELDS.filter(
      (f) => !detected.has(f) && (draft[f] == null || draft[f] === column),
    );

  function choose(column: string, value: string): void {
    setDraft((current) => {
      const next: ColumnOverrides = {};
      for (const [f, c] of Object.entries(current) as Array<
        [ImportField, string]
      >)
        if (c !== column) next[f] = c;
      if (value !== UNUSED) next[value as ImportField] = column;
      return next;
    });
  }

  async function suggest(): Promise<void> {
    setSuggesting(true);
    try {
      const suggestion = await window.api.suggestColumnMapping({
        columns: columns.slice(0, MAPPING_MAX_COLUMNS),
      });
      const fresh = (
        Object.entries(suggestion) as Array<[ImportField, string]>
      ).filter(([f, c]) => draft[f] == null && fieldOf(c) == null);
      if (fresh.length === 0) {
        toast.info(t("portfolioImport.assign.noSuggestion"));
        return;
      }
      setDraft((current) => ({ ...current, ...Object.fromEntries(fresh) }));
      toast.success(
        t("portfolioImport.assign.suggested", { count: fresh.length }),
      );
    } catch (error) {
      toast.error(
        t("portfolioImport.assign.suggestFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSuggesting(false);
    }
  }

  async function apply(): Promise<void> {
    setApplying(true);
    try {
      await onApply(draft);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown
          className={open ? "size-3.5" : "size-3.5 -rotate-90"}
          aria-hidden
        />
        {t("portfolioImport.assign.title", { count: rows.length })}
      </button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("portfolioImport.assign.description")}
          </p>
          <ul className="space-y-1.5">
            {rows.map((c) => (
              <li
                key={c.name}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate" title={c.name}>
                  <span className="font-medium">{c.name}</span>{" "}
                  <span className="text-muted-foreground">
                    ({t(`portfolioImport.hint.${c.hint}`)})
                  </span>
                </span>
                <Select
                  value={fieldOf(c.name) ?? UNUSED}
                  onValueChange={(value) => choose(c.name, value)}
                >
                  <SelectTrigger
                    className="h-7 w-48 text-xs"
                    aria-label={t("portfolioImport.assign.fieldFor", {
                      column: c.name,
                    })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNUSED}>
                      {t("portfolioImport.assign.unused")}
                    </SelectItem>
                    {choices(c.name).map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`portfolioImport.field.${f}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={applying || sameOverrides(draft, overrides)}
              onClick={() => void apply()}
            >
              {applying && <Loader2 className="animate-spin" />}
              {t("portfolioImport.assign.apply")}
            </Button>
            {llmReady && (
              <Button
                size="sm"
                variant="outline"
                disabled={suggesting}
                onClick={() => void suggest()}
                title={t("portfolioImport.assign.suggestHint")}
              >
                {suggesting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                {t("portfolioImport.assign.suggest")}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {t("portfolioImport.assign.applyHint")}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
