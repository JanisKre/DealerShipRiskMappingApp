import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import type { LlmProvider, Settings } from "@shared/types";
import i18n from "@renderer/i18n";
import { useTheme, type Theme } from "@renderer/components/theme/ThemeProvider";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";

const PROVIDERS: LlmProvider[] = ["openai", "claude", "custom"];

/** Provider display names (not i18n — proper names). */
const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: "OpenAI",
  claude: "Claude",
  custom: "Custom",
};

/** Example model name and base URL per provider, for the placeholder text. */
const PROVIDER_HINTS: Record<LlmProvider, { model: string; baseUrl: string }> =
  {
    openai: {
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
    },
    claude: {
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com",
    },
    custom: {
      model: "gpt-4.1-mini",
      baseUrl: "http://localhost:6655/openai/v1",
    },
  };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The operation could not be completed.";
}

export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  // Local draft for text fields — persist only onBlur (no toast per keystroke).
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [wmsTileUrl, setWmsTileUrl] = useState("");
  const [catnetEndpoint, setCatnetEndpoint] = useState("");
  const [catnetApiKey, setCatnetApiKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    window.api
      .getSettings()
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setSettingsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setSettingsError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync the draft with the persisted values (only when they change externally).
  useEffect(() => {
    setModel(settings?.llm?.model ?? "");
    setBaseUrl(settings?.llm?.baseUrl ?? "");
    setWmsTileUrl(settings?.wmsTileUrl ?? "");
  }, [settings?.llm?.model, settings?.llm?.baseUrl, settings?.wmsTileUrl]);

  useEffect(() => {
    setCatnetEndpoint(settings?.natCat?.catnetEndpoint ?? "");
  }, [settings?.natCat?.catnetEndpoint]);

  if (!settings) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        {settingsError ? (
          <>
            <p className="text-destructive text-sm">{settingsError}</p>
            <Button onClick={() => window.location.reload()} size="sm">
              {t("common.retry")}
            </Button>
          </>
        ) : (
          <Loader2 className="animate-spin" />
        )}
      </div>
    );
  }

  const provider = settings.llm?.provider ?? "openai";
  const natCatProvider = settings.natCat?.provider ?? "screening";

  function notifySaved(): void {
    toast.success(t("common.saved"));
  }

  async function update(partial: Partial<Settings>): Promise<void> {
    try {
      const next = await window.api.setSettings(partial);
      setSettings(next);
      if (partial.language) void i18n.changeLanguage(partial.language);
      notifySaved();
    } catch (err) {
      console.error("Saving settings failed:", err);
      toast.error(errorMessage(err));
    }
  }

  async function updateLlm(
    partial: Partial<NonNullable<Settings["llm"]>>,
  ): Promise<void> {
    const llm = {
      provider,
      model: settings!.llm?.model ?? "",
      ...settings!.llm,
      ...partial,
    };
    await update({ llm });
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKey.trim()) return;
    try {
      await window.api.setLlmApiKey(provider, apiKey.trim());
      setApiKey("");
      setSettings(await window.api.getSettings());
      notifySaved();
    } catch (err) {
      console.error("Saving LLM API key failed:", err);
      toast.error(errorMessage(err));
    }
  }

  async function updateNatCat(
    partial: Partial<NonNullable<Settings["natCat"]>>,
  ): Promise<void> {
    await update({
      natCat: {
        provider: natCatProvider,
        ...settings!.natCat,
        ...partial,
      },
    });
  }

  async function saveCatnetApiKey(): Promise<void> {
    if (!catnetApiKey.trim()) return;
    try {
      await window.api.setNatCatApiKey(catnetApiKey.trim());
      setCatnetApiKey("");
      setSettings(await window.api.getSettings());
      notifySaved();
    } catch (err) {
      console.error("Saving CatNet API key failed:", err);
      toast.error(errorMessage(err));
    }
  }

  const themeOptions: Array<{ value: Theme; label: string; icon: typeof Sun }> =
    [
      { value: "light", label: t("settings.appearance.light"), icon: Sun },
      { value: "dark", label: t("settings.appearance.dark"), icon: Moon },
      {
        value: "system",
        label: t("settings.appearance.system"),
        icon: Monitor,
      },
    ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h2 className="text-2xl font-semibold">{t("settings.title")}</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.appearance.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            variant="outline"
            value={theme}
            onValueChange={(v) => v && setTheme(v as Theme)}
            className="w-full"
          >
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} className="gap-2">
                <Icon className="size-4" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.natCat.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.natCat.description")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["screening", "zuers-geo", "swissre-catnet"] as const).map(
              (p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={natCatProvider === p ? "default" : "outline"}
                  onClick={() => void updateNatCat({ provider: p })}
                >
                  {t(
                    `settings.natCat.${p === "screening" ? "screening" : p === "zuers-geo" ? "zuers" : "catnet"}`,
                  )}
                </Button>
              ),
            )}
          </div>
          {natCatProvider === "swissre-catnet" && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  {t("settings.natCat.endpoint")}
                </label>
                <Input
                  value={catnetEndpoint}
                  placeholder="https://…"
                  onChange={(e) => setCatnetEndpoint(e.target.value)}
                  onBlur={() => {
                    if (
                      catnetEndpoint !== (settings.natCat?.catnetEndpoint ?? "")
                    )
                      void updateNatCat({
                        catnetEndpoint: catnetEndpoint || undefined,
                      });
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.natCat.endpointHint")}
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  {t("settings.natCat.key")}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={catnetApiKey}
                    placeholder={
                      settings.natCat?.catnetHasApiKey
                        ? t("settings.natCat.keySet")
                        : t("settings.natCat.keyUnset")
                    }
                    onChange={(e) => setCatnetApiKey(e.target.value)}
                  />
                  <Button onClick={() => void saveCatnetApiKey()}>
                    {t("settings.natCat.save")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.language")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            variant="outline"
            value={settings.language}
            onValueChange={(v) =>
              v && update({ language: v as Settings["language"] })
            }
          >
            {(["de", "en", "fr"] as const).map((lng) => (
              <ToggleGroupItem key={lng} value={lng} className="px-4">
                {lng.toUpperCase()}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.llmProvider")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={provider === p ? "default" : "outline"}
                onClick={() => updateLlm({ provider: p })}
              >
                {PROVIDER_LABELS[p]}
              </Button>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">{t("settings.model")}</label>
            <Input
              value={model}
              placeholder={t("settings.modelPlaceholder", {
                model: PROVIDER_HINTS[provider].model,
              })}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => {
                if (model !== (settings!.llm?.model ?? ""))
                  void updateLlm({ model });
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t("settings.baseUrl")}
            </label>
            <Input
              value={baseUrl}
              placeholder={PROVIDER_HINTS[provider].baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={() => {
                if (baseUrl !== (settings!.llm?.baseUrl ?? ""))
                  void updateLlm({ baseUrl });
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.baseUrlHint")}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t("settings.apiKey")}
            </label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                placeholder={
                  settings.llm?.hasApiKey
                    ? t("settings.apiKeySetPlaceholder")
                    : t("settings.apiKeyUnsetPlaceholder")
                }
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button onClick={saveApiKey}>{t("common.save")}</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.apiKeyHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.satelliteSource.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={settings.satelliteProvider ?? "esri"}
            onValueChange={(v) =>
              v &&
              update({ satelliteProvider: v as Settings["satelliteProvider"] })
            }
          >
            <ToggleGroupItem value="esri" className="px-4">
              Esri World Imagery
            </ToggleGroupItem>
            <ToggleGroupItem value="wms" className="px-4">
              {t("settings.satelliteSource.customOption")}
            </ToggleGroupItem>
          </ToggleGroup>
          {(settings.satelliteProvider ?? "esri") === "wms" && (
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t("settings.satelliteSource.tileTemplateLabel")}
              </label>
              <Input
                value={wmsTileUrl}
                placeholder="https://…/{z}/{x}/{y}.png"
                onChange={(e) => setWmsTileUrl(e.target.value)}
                onBlur={() => {
                  if (wmsTileUrl !== (settings.wmsTileUrl ?? ""))
                    void update({ wmsTileUrl: wmsTileUrl || undefined });
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.satelliteSource.tileTemplateHint")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
