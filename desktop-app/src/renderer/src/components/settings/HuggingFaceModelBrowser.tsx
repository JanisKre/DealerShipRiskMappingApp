import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Heart,
  Loader2,
  Lock,
  Search,
  X,
} from "lucide-react";
import type {
  HfModelFiles,
  HfModelSort,
  HfModelSummary,
  OllamaPullChunk,
} from "@shared/ipc-schema";
import { ollamaHfModelName } from "@shared/llm-config";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Progress } from "@renderer/components/ui/progress";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { cn } from "@renderer/lib/utils";

/** Default pick for most machines: good quality at about 4.5 bits/weight. */
const RECOMMENDED_QUANT = "Q4_K_M";

function formatBytes(bytes: number | undefined, locale: string): string {
  if (bytes == null) return "–";
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(gb)} GB`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1024 ** 2)} MB`;
}

function formatCount(n: number | undefined, locale: string): string {
  if (n == null) return "–";
  return new Intl.NumberFormat(locale, { notation: "compact" }).format(n);
}

function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
}

type PullState =
  | { phase: "running"; model: string; chunk: OllamaPullChunk | null }
  | { phase: "error"; model: string; message: string; unreachable: boolean };

/**
 * Discovers GGUF models on the Hugging Face Hub at runtime (always current,
 * no app update needed) and installs a chosen quantization into the local
 * Ollama via `ollama pull hf.co/<repo>:<quant>`.
 */
export function HuggingFaceModelBrowser({
  canInstall,
  onInstalled,
}: Readonly<{
  /** Only Ollama can pull from Hugging Face; other runtimes just browse. */
  canInstall: boolean;
  onInstalled: (model: string) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HfModelSort>("trending");
  const [results, setResults] = useState<HfModelSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, HfModelFiles>>({});
  const [filesError, setFilesError] = useState<string | null>(null);
  const [pull, setPull] = useState<PullState | null>(null);
  const cancelPullRef = useRef<(() => void) | null>(null);

  // Abort a running pull when the settings page is left.
  useEffect(() => () => cancelPullRef.current?.(), []);

  async function search(nextSort = sort): Promise<void> {
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await window.api.searchHfModels(query.trim(), nextSort));
    } catch (err) {
      setSearchError(ipcErrorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  async function toggleRepo(repoId: string): Promise<void> {
    if (expanded === repoId) {
      setExpanded(null);
      return;
    }
    setExpanded(repoId);
    setFilesError(null);
    if (files[repoId]) return;
    try {
      const info = await window.api.hfModelFiles(repoId);
      setFiles((prev) => ({ ...prev, [repoId]: info }));
    } catch (err) {
      setFilesError(ipcErrorMessage(err));
    }
  }

  function install(repoId: string, quant: string): void {
    const model = ollamaHfModelName(repoId, quant);
    cancelPullRef.current?.();
    setPull({ phase: "running", model, chunk: null });
    cancelPullRef.current = window.api.pullOllamaModel(model, (chunk) => {
      if (chunk.type === "done") {
        cancelPullRef.current = null;
        setPull(null);
        onInstalled(chunk.model);
      } else if (chunk.type === "error") {
        cancelPullRef.current = null;
        setPull({
          phase: "error",
          model,
          message: chunk.message,
          unreachable: chunk.code === "unreachable",
        });
      } else {
        setPull({ phase: "running", model, chunk });
      }
    });
  }

  function cancelPull(): void {
    cancelPullRef.current?.();
    cancelPullRef.current = null;
    setPull(null);
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-sm font-medium"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !results) void search();
        }}
      >
        {open ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
        {t("settings.hf.title")}
      </button>

      {open && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              canInstall
                ? "settings.hf.description"
                : "settings.hf.otherRuntime",
            )}
          </p>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <Input
              className="min-w-0 flex-1"
              value={query}
              maxLength={100}
              placeholder={t("settings.hf.searchPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={searching}>
              {searching ? <Loader2 className="animate-spin" /> : <Search />}
              {t("settings.hf.search")}
            </Button>
          </form>

          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={sort}
            onValueChange={(v) => {
              if (!v) return;
              setSort(v as HfModelSort);
              void search(v as HfModelSort);
            }}
          >
            {(["trending", "downloads", "likes"] as const).map((s) => (
              <ToggleGroupItem key={s} value={s} className="px-3 text-xs">
                {t(`settings.hf.sort.${s}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {pull && (
            <PullStatus
              pull={pull}
              locale={i18n.language}
              onCancel={cancelPull}
              onDismiss={() => setPull(null)}
            />
          )}

          {searchError && (
            <p className="text-xs text-destructive">
              {t("settings.hf.searchFailed", { error: searchError })}
            </p>
          )}

          {results?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("settings.hf.noResults")}
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="divide-y rounded-md border">
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => void toggleRepo(m.id)}
                  >
                    {expanded === m.id ? (
                      <ChevronDown className="size-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{m.id}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        <Download className="size-3" />
                        {formatCount(m.downloads, i18n.language)}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Heart className="size-3" />
                        {formatCount(m.likes, i18n.language)}
                      </span>
                    </span>
                  </button>
                  {expanded === m.id && (
                    <RepoFiles
                      info={files[m.id]}
                      error={filesError}
                      locale={i18n.language}
                      canInstall={canInstall && pull?.phase !== "running"}
                      onInstall={(quant) => install(m.id, quant)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RepoFiles({
  info,
  error,
  locale,
  canInstall,
  onInstall,
}: Readonly<{
  info: HfModelFiles | undefined;
  error: string | null;
  locale: string;
  canInstall: boolean;
  onInstall: (quant: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  if (error) {
    return (
      <p className="px-3 pb-3 text-xs text-destructive">
        {t("settings.hf.filesFailed", { error })}
      </p>
    );
  }
  if (!info) {
    return (
      <div className="px-3 pb-3">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="space-y-2 bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        {info.parameters != null && (
          <Badge variant="outline">
            {t("settings.hf.parameters", {
              value: formatCount(info.parameters, locale),
            })}
          </Badge>
        )}
        {info.contextLength != null && (
          <Badge variant="outline">
            {t("settings.hf.context", {
              value: formatCount(info.contextLength, locale),
            })}
          </Badge>
        )}
        {info.gated && (
          <Badge variant="outline" className="gap-1">
            <Lock className="size-3" />
            {t("settings.hf.gated")}
          </Badge>
        )}
      </div>
      {info.quants.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.hf.noQuants")}
        </p>
      ) : (
        <ul className="space-y-1">
          {info.quants.map((q) => (
            <li key={q.tag} className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "w-20 shrink-0 font-mono",
                  q.tag === RECOMMENDED_QUANT && "font-semibold",
                )}
              >
                {q.tag}
              </span>
              <span className="w-16 shrink-0 text-muted-foreground">
                {formatBytes(q.sizeBytes, locale)}
              </span>
              {q.tag === RECOMMENDED_QUANT && (
                <Badge variant="secondary" className="text-[10px]">
                  {t("settings.hf.recommended")}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-6 px-2 text-xs"
                disabled={!canInstall}
                onClick={() => onInstall(q.tag)}
              >
                {t("settings.hf.install")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PullStatus({
  pull,
  locale,
  onCancel,
  onDismiss,
}: Readonly<{
  pull: PullState;
  locale: string;
  onCancel: () => void;
  onDismiss: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  if (pull.phase === "error") {
    return (
      <div className="space-y-1 rounded-md border border-destructive/40 p-3 text-xs">
        <div className="flex items-start justify-between gap-2">
          <p className="text-destructive">
            {pull.unreachable
              ? t("settings.hf.ollamaUnreachable")
              : t("settings.hf.pullFailed", { error: pull.message })}
          </p>
          <button
            type="button"
            aria-label={t("ui.dismiss")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
          >
            <X className="size-3.5" />
          </button>
        </div>
        {pull.unreachable && (
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            ollama.com/download
          </a>
        )}
      </div>
    );
  }
  const chunk = pull.chunk?.type === "progress" ? pull.chunk : null;
  const percent =
    chunk?.totalBytes && chunk.completedBytes != null
      ? Math.min(100, (chunk.completedBytes / chunk.totalBytes) * 100)
      : null;
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono">{pull.model}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      </div>
      <Progress value={percent ?? 0} />
      <p className="text-muted-foreground">
        {chunk?.status || t("settings.hf.starting")}
        {chunk?.totalBytes
          ? ` · ${formatBytes(chunk.completedBytes ?? 0, locale)} / ${formatBytes(chunk.totalBytes, locale)}`
          : ""}
      </p>
    </div>
  );
}
