import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { validateOverpassUrl } from "@shared/overpass-url";
import { useSearchParams } from "react-router-dom";
import {
  Database,
  Loader2,
  Monitor,
  Moon,
  Settings2,
  Sparkles,
  Sun,
} from "lucide-react";
import { errorReason, notify } from "@renderer/lib/notify";
import type { Settings } from "@shared/types";
import i18n from "@renderer/i18n";
import { useTheme, type Theme } from "@renderer/components/theme/ThemeProvider";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import {
  AgentGatewayCard,
  AiLogCard,
  McpServersCard,
} from "./AiIntegrationsCards";
import { AppSupportCard } from "./AppSupportCard";
import { DealerDirectoryCard } from "./DealerDirectoryCard";
import { DetectionDisplayCard } from "./DetectionDisplayCard";
import { DetectionModelCard } from "./DetectionModelCard";
import { ImagerySourceCard } from "./ImagerySourceCard";
import { LlmSettingsCard } from "./LlmSettingsCard";
import { NatCatSettingsCard } from "./NatCatSettingsCard";
import { SettingRow } from "./SettingRow";

/** The settings are split into three tabs instead of one long page. */
const SECTIONS = ["general", "ai", "data"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: string | null): value is Section {
  return (SECTIONS as readonly string[]).includes(value ?? "");
}

const LANGUAGE_NAMES: Record<Settings["language"], string> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
};

export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // Local draft for text fields — persist only onBlur (no toast per keystroke).
  const [overpassUrl, setOverpassUrl] = useState("");
  // `?section=…` picks the tab. A link to `?section=ai` (the AI setup
  // prompt) also highlights the AI card; picking the tab here doesn't, so
  // tab clicks add `via=tab`.
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const section: Section = isSection(sectionParam) ? sectionParam : "general";
  const focusAi = sectionParam === "ai" && searchParams.get("via") !== "tab";
  const aiCardRef = useRef<HTMLDivElement>(null);
  function selectSection(next: string): void {
    if (!isSection(next)) return;
    setSearchParams({ section: next, via: "tab" }, { replace: true });
  }

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
        if (!cancelled)
          setSettingsError(
            errorReason(err) || i18n.t("common.operationFailed"),
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync the draft with the persisted value (only when it changes externally).
  useEffect(() => {
    setOverpassUrl(settings?.overpassUrl ?? "");
  }, [settings?.overpassUrl]);
  // Checked as the user types; only a valid address (or none) is saved.
  const overpassCheck =
    overpassUrl.trim() === "" ? null : validateOverpassUrl(overpassUrl);

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
    // i18n.t, not the render's `t`: after a language switch this render
    // still holds the old language.
    notify.success(i18n.t("common.saved"));
  }

  async function update(partial: Partial<Settings>): Promise<void> {
    try {
      const next = await window.api.setSettings(partial);
      setSettings(next);
      // Confirm in the new language, not the one just left.
      if (partial.language) await i18n.changeLanguage(partial.language);
      notifySaved();
    } catch (err) {
      console.error("Saving settings failed:", err);
      notify.failed(err, i18n.t("common.saveFailed"));
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
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      {/* The header already reads "Einstellungen"; no second heading. */}
      <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>

      <Tabs value={section} onValueChange={selectSection}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general" className="gap-2">
            <Settings2 className="size-4" />
            {t("settings.tabs.general")}
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-2">
            <Sparkles className="size-4" />
            {t("settings.tabs.ai")}
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-2">
            <Database className="size-4" />
            {t("settings.tabs.data")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.tabs.general")}
              </CardTitle>
              <CardDescription>
                {t("settings.general.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              <SettingRow
                label={t("settings.appearance.title")}
                hint={t("settings.appearance.description")}
              >
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={theme}
                  onValueChange={(v) => v && setTheme(v as Theme)}
                >
                  {themeOptions.map(({ value, label, icon: Icon }) => (
                    <ToggleGroupItem
                      key={value}
                      value={value}
                      className="gap-2 px-3"
                    >
                      <Icon className="size-4" />
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </SettingRow>
              <SettingRow
                label={t("settings.language")}
                hint={t("settings.general.languageHint")}
              >
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={settings.language}
                  onValueChange={(v) =>
                    v && update({ language: v as Settings["language"] })
                  }
                >
                  {(["de", "en", "fr"] as const).map((lng) => (
                    <ToggleGroupItem key={lng} value={lng} className="px-3">
                      {LANGUAGE_NAMES[lng]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </SettingRow>
            </CardContent>
          </Card>
          <DetectionDisplayCard />
          <AppSupportCard settings={settings} onUpdateSettings={update} />
        </TabsContent>

        <TabsContent value="ai" className="mt-6 space-y-6">
          <LlmSettingsCard
            ref={aiCardRef}
            settings={settings}
            onSettingsChange={setSettings}
            highlight={focusAi}
          />
          <AiLogCard settings={settings} onUpdate={update} />
          <McpServersCard settings={settings} onUpdate={update} />
          <AgentGatewayCard settings={settings} onUpdate={update} />
        </TabsContent>

        <TabsContent value="data" className="mt-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            {t("settings.data.description")}
          </p>

          <NatCatSettingsCard
            settings={settings}
            onSettingsChange={setSettings}
          />

          <ImagerySourceCard settings={settings} onUpdate={update} />

          <DetectionModelCard />

          <DealerDirectoryCard />

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {t("settings.osmSource.title")}
                </CardTitle>
                <Badge variant={settings.overpassUrl ? "secondary" : "outline"}>
                  {settings.overpassUrl
                    ? t("settings.osmSource.badgeOwn")
                    : t("settings.osmSource.badgePublic")}
                </Badge>
              </div>
              <CardDescription>
                {t("settings.osmSource.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <label htmlFor="overpass-url" className="text-sm font-medium">
                {t("settings.osmSource.urlLabel")}
              </label>
              <Input
                id="overpass-url"
                value={overpassUrl}
                placeholder="http://localhost:12345/api/interpreter"
                aria-invalid={overpassCheck?.ok === false}
                onChange={(e) => setOverpassUrl(e.target.value)}
                onBlur={() => {
                  if (overpassCheck?.ok === false) return;
                  const next = overpassCheck?.ok ? overpassCheck.url : "";
                  if (next !== (settings.overpassUrl ?? ""))
                    void update({ overpassUrl: next });
                }}
              />
              {overpassCheck?.ok === false && (
                <p className="text-xs text-destructive">
                  {t(`settings.osmSource.errors.${overpassCheck.problem}`)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {settings.overpassUrl
                  ? t("settings.osmSource.statusOwn")
                  : t("settings.osmSource.statusPublic")}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
