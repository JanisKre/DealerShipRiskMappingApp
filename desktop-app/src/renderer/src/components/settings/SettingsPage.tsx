import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Loader2, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import type { Settings } from "@shared/types";
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
import { DealerDirectoryCard } from "./DealerDirectoryCard";
import { LlmSettingsCard } from "./LlmSettingsCard";
import { NatCatSettingsCard } from "./NatCatSettingsCard";

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
  // Local draft for text fields — persist only onBlur (no toast per keystroke).
  const [wmsTileUrl, setWmsTileUrl] = useState("");
  // `?section=ai` (from the AI setup prompt) scrolls to and highlights the
  // LLM card.
  const [searchParams] = useSearchParams();
  const focusAi = searchParams.get("section") === "ai";
  const aiCardRef = useRef<HTMLDivElement>(null);

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
    setWmsTileUrl(settings?.wmsTileUrl ?? "");
  }, [settings?.wmsTileUrl]);

  const settingsLoaded = settings !== null;
  useEffect(() => {
    if (focusAi && settingsLoaded)
      aiCardRef.current?.scrollIntoView({ block: "start" });
  }, [focusAi, settingsLoaded]);

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

      <NatCatSettingsCard settings={settings} onSettingsChange={setSettings} />

      <DealerDirectoryCard />

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

      <LlmSettingsCard
        ref={aiCardRef}
        settings={settings}
        onSettingsChange={setSettings}
        highlight={focusAi}
      />

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
            value={settings.satelliteProvider ?? "auto"}
            onValueChange={(v) =>
              v &&
              update({ satelliteProvider: v as Settings["satelliteProvider"] })
            }
            className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3"
          >
            <ToggleGroupItem
              value="auto"
              className="h-auto min-h-14 rounded-md px-3 py-2 text-center whitespace-normal leading-tight first:rounded-md last:rounded-md"
            >
              <span className="flex flex-col items-center gap-0.5">
                <span className="font-medium">
                  {t("settings.satelliteSource.autoOption")}
                </span>
                <span className="text-[11px] font-normal opacity-75">
                  {t("settings.satelliteSource.autoShort")}
                </span>
              </span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="esri"
              className="h-auto min-h-14 rounded-md px-3 py-2 text-center whitespace-normal leading-tight first:rounded-md last:rounded-md"
            >
              <span className="flex flex-col items-center gap-0.5">
                <span className="font-medium">
                  {t("settings.satelliteSource.esriOption")}
                </span>
                <span className="text-[11px] font-normal opacity-75">
                  {t("settings.satelliteSource.esriShort")}
                </span>
              </span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="wms"
              className="h-auto min-h-14 rounded-md px-3 py-2 text-center whitespace-normal leading-tight first:rounded-md last:rounded-md"
            >
              <span className="flex flex-col items-center gap-0.5">
                <span className="font-medium">
                  {t("settings.satelliteSource.customOption")}
                </span>
                <span className="text-[11px] font-normal opacity-75">
                  {t("settings.satelliteSource.customShort")}
                </span>
              </span>
            </ToggleGroupItem>
          </ToggleGroup>
          {(settings.satelliteProvider ?? "auto") === "auto" && (
            <p className="text-xs text-muted-foreground">
              {t("settings.satelliteSource.autoHint")}
            </p>
          )}
          {settings.satelliteProvider === "wms" && (
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
