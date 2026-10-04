import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Loader2,
  PlugZap,
  RefreshCw,
  Server,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { LlmConnectionTest, LocalRuntimeStatus } from "@shared/ipc-schema";
import {
  DEFAULT_LOCAL_BASE_URL,
  isLlmConfigured,
  isLlmSetupError,
  LOCAL_RUNTIMES,
  type LocalRuntime,
} from "@shared/llm-config";
import type { LlmProvider, LlmSettings, Settings } from "@shared/types";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { cn } from "@renderer/lib/utils";
import { HuggingFaceModelBrowser } from "./HuggingFaceModelBrowser";

const PROVIDERS: Array<{ id: LlmProvider; icon: LucideIcon }> = [
  { id: "openai", icon: Sparkles },
  { id: "claude", icon: Bot },
  { id: "local", icon: HardDrive },
  { id: "custom", icon: Server },
];

/** Default endpoint per provider, shown as placeholder. */
const DEFAULT_BASE_URLS: Record<LlmProvider, string> = {
  openai: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com",
  local: DEFAULT_LOCAL_BASE_URL,
  custom: "https://…/v1",
};

type ModelOption = { id: string; label?: string };

/** Strips Electron's "Error invoking remote method '…': Error: " prefix. */
function ipcErrorMessage(error: unknown): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "The operation could not be completed.";
  return message.replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
}

/** Preset whose base URL is configured (an empty URL means Ollama). */
function activeRuntime(baseUrl: string | undefined): LocalRuntime | null {
  const url = baseUrl?.trim() || DEFAULT_LOCAL_BASE_URL;
  const match = Object.entries(LOCAL_RUNTIMES).find(
    ([, runtime]) => runtime.baseUrl === url,
  );
  return (match?.[0] as LocalRuntime | undefined) ?? null;
}

/** Whether enough is configured to ask the endpoint for its models. */
function canListModels(llm: LlmSettings | undefined): boolean {
  const provider = llm?.provider ?? "openai";
  const hasBaseUrl = Boolean(llm?.baseUrl?.trim());
  if (provider === "local") return true;
  if (provider === "custom") return hasBaseUrl;
  return Boolean(llm?.hasApiKey) || hasBaseUrl;
}

/**
 * Guided AI provider setup: 1) provider, 2) access (API key / endpoint, or an
 * auto-detected local runtime), 3) model from the provider's live list. The
 * model list loads by itself as soon as the access is complete, and picking a
 * model runs the connection test.
 */
export function LlmSettingsCard({
  settings,
  onSettingsChange,
  highlight,
  ref,
}: Readonly<{
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  /** Ring around the card when the user arrived from the setup prompt. */
  highlight: boolean;
  ref?: React.Ref<HTMLDivElement>;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const llm = settings.llm;
  const provider = llm?.provider ?? "openai";
  const model = llm?.model ?? "";
  const configured = isLlmConfigured(llm);
  const listable = canListModels(llm);
  const runtime = provider === "local" ? activeRuntime(llm?.baseUrl) : null;

  // Drafts — persisted on blur / save (no toast per keystroke).
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [accessRejected, setAccessRejected] = useState(false);
  const ready = configured && !accessRejected;
  const [localStatus, setLocalStatus] = useState<LocalRuntimeStatus[] | null>(
    null,
  );
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmConnectionTest | null>(null);
  // Drops responses of model-list requests that a newer one superseded.
  const modelsRequest = useRef(0);

  useEffect(() => {
    setBaseUrl(llm?.baseUrl ?? "");
    setShowAdvanced((open) => open || Boolean(llm?.baseUrl?.trim()));
  }, [llm?.baseUrl]);

  useEffect(() => {
    setManualModel(model);
  }, [model]);

  // Access changed → the old list and test no longer apply; reload the list.
  useEffect(() => {
    setModels(null);
    setModelsError(null);
    setTestResult(null);
    setManualEntry(false);
    setAccessRejected(false);
    if (listable) void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadModels reads the saved settings
  }, [provider, llm?.baseUrl, llm?.hasApiKey, listable]);

  // Local provider: find the running runtime.
  useEffect(() => {
    if (provider === "local") void detectLocal();
    else setLocalStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per provider switch
  }, [provider]);

  async function saveLlm(partial: Partial<LlmSettings>): Promise<boolean> {
    try {
      const next = await window.api.setSettings({
        llm: { provider, model, ...llm, ...partial },
      });
      onSettingsChange(next);
      toast.success(t("common.saved"));
      return true;
    } catch (err) {
      console.error("Saving LLM settings failed:", err);
      toast.error(ipcErrorMessage(err));
      return false;
    }
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKey.trim()) return;
    try {
      await window.api.setLlmApiKey(provider, apiKey.trim());
      setApiKey("");
      setAccessRejected(false);
      onSettingsChange(await window.api.getSettings());
      toast.success(t("common.saved"));
    } catch (err) {
      console.error("Saving LLM API key failed:", err);
      toast.error(ipcErrorMessage(err));
    }
  }

  async function loadModels(): Promise<void> {
    const request = ++modelsRequest.current;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const result = await window.api.listLlmModels();
      if (request !== modelsRequest.current) return;
      setModels(result.models);
      setAccessRejected(false);
      // Exactly one model (typical for a fresh local runtime): take it.
      if (!model && result.models.length === 1)
        void selectModel(result.models[0].id);
    } catch (err) {
      if (request !== modelsRequest.current) return;
      setModels(null);
      const message = ipcErrorMessage(err);
      const setupError = isLlmSetupError(message);
      setAccessRejected(setupError);
      setModelsError(
        setupError
          ? t(
              provider === "custom"
                ? "settings.models.needBaseUrl"
                : "settings.models.needKey",
            )
          : message,
      );
    } finally {
      if (request === modelsRequest.current) setModelsLoading(false);
    }
  }

  async function detectLocal(): Promise<void> {
    setDetecting(true);
    try {
      const status = await window.api.detectLocalRuntimes();
      setLocalStatus(status);
      // No model chosen yet and the configured preset is not running, but
      // another one is: switch to it.
      const current = status.find((s) => s.runtime === runtime);
      const running = status.find((s) => s.reachable);
      if (!model && runtime && !current?.reachable && running)
        void saveLlm({ baseUrl: running.baseUrl, model: "" });
    } catch {
      setLocalStatus(null);
    } finally {
      setDetecting(false);
    }
  }

  async function selectModel(id: string): Promise<void> {
    if (await saveLlm({ model: id })) void testConnection();
  }

  async function testConnection(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.api.testLlmConnection());
    } catch (err) {
      setTestResult({
        ok: false,
        code: "error",
        detail: ipcErrorMessage(err),
        latencyMs: 0,
      });
    } finally {
      setTesting(false);
    }
  }

  // Keep a saved model selectable even if the endpoint no longer lists it.
  const options: ModelOption[] =
    models && model && !models.some((m) => m.id === model)
      ? [{ id: model }, ...models]
      : (models ?? []);
  const showDropdown = !manualEntry && models !== null && models.length > 0;

  return (
    <Card
      ref={ref}
      className={cn(
        "scroll-mt-8",
        highlight && !ready && "ring-2 ring-primary",
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {t("settings.llmProvider")}
          </CardTitle>
          <Badge variant={ready ? "secondary" : "outline"}>
            {t(ready ? "settings.llmReady" : "settings.llmNotReady")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 1 — Provider */}
        <Step number={1} title={t("settings.steps.provider")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  // Endpoint and model belong to the previous provider.
                  if (id !== provider)
                    void saveLlm({ provider: id, baseUrl: "", model: "" });
                }}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                  provider === id && "border-primary bg-primary/5",
                )}
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`settings.providers.${id}.title`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`settings.providers.${id}.description`)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Step>

        {/* 2 — Access */}
        <Step number={2} title={t("settings.steps.access")}>
          {provider === "local" ? (
            <LocalRuntimePicker
              status={localStatus}
              detecting={detecting}
              selected={runtime}
              onDetect={() => void detectLocal()}
              onSelect={(r) =>
                void saveLlm({ baseUrl: LOCAL_RUNTIMES[r].baseUrl, model: "" })
              }
            />
          ) : (
            <>
              {provider === "custom" && (
                <BaseUrlField
                  value={baseUrl}
                  placeholder={DEFAULT_BASE_URLS.custom}
                  hint={t("settings.customBaseUrlHint")}
                  onChange={setBaseUrl}
                  onCommit={() => {
                    if (baseUrl !== (llm?.baseUrl ?? ""))
                      void saveLlm({ baseUrl });
                  }}
                />
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  {t("settings.apiKey")}
                  {provider === "custom" && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      ({t("settings.optional")})
                    </span>
                  )}
                </label>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveApiKey();
                  }}
                >
                  <Input
                    className="min-w-0 flex-1"
                    type="password"
                    value={apiKey}
                    placeholder={
                      llm?.hasApiKey && !accessRejected
                        ? t("settings.apiKeySetPlaceholder")
                        : t("settings.apiKeyUnsetPlaceholder")
                    }
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <Button type="submit" className="shrink-0">
                    {t("common.save")}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  {t("settings.apiKeyHint")}
                </p>
              </div>
            </>
          )}

          {provider !== "custom" && (
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {t("settings.advanced")}
              </button>
              {showAdvanced && (
                <BaseUrlField
                  value={baseUrl}
                  placeholder={DEFAULT_BASE_URLS[provider]}
                  hint={t(
                    provider === "local"
                      ? "settings.local.baseUrlHint"
                      : "settings.baseUrlHint",
                  )}
                  onChange={setBaseUrl}
                  onCommit={() => {
                    if (baseUrl !== (llm?.baseUrl ?? ""))
                      void saveLlm({ baseUrl });
                  }}
                />
              )}
            </div>
          )}
        </Step>

        {/* 3 — Model */}
        <Step number={3} title={t("settings.steps.model")}>
          {!listable ? (
            <p className="text-sm text-muted-foreground">
              {t(
                provider === "custom"
                  ? "settings.models.needBaseUrl"
                  : "settings.models.needKey",
              )}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                {showDropdown ? (
                  <Select
                    value={model || undefined}
                    onValueChange={(id) => void selectModel(id)}
                  >
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue
                        placeholder={t("settings.models.pick", {
                          count: options.length,
                        })}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label ? `${m.label} (${m.id})` : m.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="min-w-0 flex-1"
                    value={manualModel}
                    disabled={modelsLoading}
                    placeholder={
                      modelsLoading
                        ? t("settings.models.loading")
                        : t("settings.models.manualPlaceholder")
                    }
                    onChange={(e) => setManualModel(e.target.value)}
                    onBlur={() => {
                      if (manualModel.trim() && manualModel !== model)
                        void selectModel(manualModel.trim());
                    }}
                  />
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void loadModels()}
                  disabled={modelsLoading}
                  title={t("settings.models.reload")}
                  aria-label={t("settings.models.reload")}
                >
                  {modelsLoading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                </Button>
              </div>

              {models?.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    provider === "local"
                      ? "settings.models.noneLocal"
                      : "settings.models.none",
                  )}
                </p>
              )}
              {modelsError && (
                <p className="text-xs text-destructive">
                  {t("settings.models.failed", { error: modelsError })}
                </p>
              )}
              {models && models.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => setManualEntry((v) => !v)}
                >
                  {t(
                    manualEntry
                      ? "settings.models.backToList"
                      : "settings.models.enterManually",
                  )}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void testConnection()}
              disabled={testing || !model}
            >
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {t("settings.test.button")}
            </Button>
            {testing && provider === "local" && (
              <span className="text-xs text-muted-foreground">
                {t("settings.test.localSlow")}
              </span>
            )}
          </div>
          {testResult && <ConnectionTestResult result={testResult} />}
        </Step>

        {provider === "local" && (
          <HuggingFaceModelBrowser
            canInstall={runtime !== "lmstudio" && runtime !== "llamacpp"}
            onInstalled={(name) => {
              void loadModels();
              void selectModel(name);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Step({
  number,
  title,
  children,
}: Readonly<{
  number: number;
  title: string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs">
          {number}
        </span>
        {title}
      </h3>
      <div className="space-y-3 pl-7">{children}</div>
    </section>
  );
}

function BaseUrlField({
  value,
  placeholder,
  hint,
  onChange,
  onCommit,
}: Readonly<{
  value: string;
  placeholder: string;
  hint: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{t("settings.baseUrl")}</label>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
        }}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function LocalRuntimePicker({
  status,
  detecting,
  selected,
  onDetect,
  onSelect,
}: Readonly<{
  status: LocalRuntimeStatus[] | null;
  detecting: boolean;
  selected: LocalRuntime | null;
  onDetect: () => void;
  onSelect: (runtime: LocalRuntime) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const noneRunning = status !== null && !status.some((s) => s.reachable);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t("settings.local.description")}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(LOCAL_RUNTIMES) as LocalRuntime[]).map((key) => {
          const s = status?.find((x) => x.runtime === key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                "rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/50",
                selected === key && "border-primary bg-primary/5",
              )}
            >
              <span className="block text-sm font-medium">
                {LOCAL_RUNTIMES[key].label}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    s?.reachable ? "bg-emerald-500" : "bg-muted-foreground/30",
                  )}
                />
                {detecting && !status
                  ? t("settings.local.checking")
                  : s?.reachable
                    ? t("settings.local.running", { count: s.modelCount ?? 0 })
                    : t("settings.local.notFound")}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDetect}
          disabled={detecting}
        >
          {detecting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("settings.local.detect")}
        </Button>
        {noneRunning && (
          <span className="text-xs text-muted-foreground">
            {t("settings.local.noneRunning")}{" "}
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              ollama.com/download
            </a>
          </span>
        )}
      </div>
    </div>
  );
}

function ConnectionTestResult({
  result,
}: Readonly<{ result: LlmConnectionTest }>): React.JSX.Element {
  const { t } = useTranslation();
  if (result.ok) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" />
        {t("settings.test.ok", { ms: result.latencyMs })}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="flex items-start gap-1.5 text-sm text-destructive">
        <XCircle className="mt-0.5 size-4 shrink-0" />
        {t(`settings.test.${result.code}`)}
      </p>
      {result.detail && (
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          {result.detail}
        </p>
      )}
    </div>
  );
}
