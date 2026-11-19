import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  PlugZap,
  XCircle,
} from "lucide-react";
import { STATE_DOP_SERVICES } from "@shared/imagery-sources";
import type { ImagerySourceTest } from "@shared/ipc-schema";
import {
  isUsableTileTemplate,
  validateTileTemplate,
} from "@shared/tile-template";
import type { CustomImagery, Settings } from "@shared/types";
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
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { cn } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/appStore";

type Mode = NonNullable<Settings["satelliteProvider"]>;

const MODES = [
  ["auto", "autoOption", "autoShort"],
  ["esri", "esriOption", "esriShort"],
  ["wms", "customOption", "customShort"],
] as const;

const STATE_SERVICES = Object.values(STATE_DOP_SERVICES).sort((a, b) =>
  a.label.localeCompare(b.label, "de"),
);

/** "0,2" or "0.2" as a resolution in metres; null when it is not one. */
function parseResolution(value: string): number | null {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/**
 * Aerial imagery: which source the map and vehicle detection use, the
 * sources the app knows, and the connector for a tile service of one's own.
 */
export function ImagerySourceCard({
  settings,
  onUpdate,
}: Readonly<{
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => Promise<void>;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const mode: Mode = settings.satelliteProvider ?? "auto";
  const connected = isUsableTileTemplate(settings.wmsTileUrl);
  const [statesOpen, setStatesOpen] = useState(false);
  const stateCount = STATE_SERVICES.length;

  const active = t("settings.satelliteSource.sources.status.active");
  const unused = t("settings.satelliteSource.sources.status.unused");
  // With the own source, the others step in where it has no image.
  const fallback = t("settings.satelliteSource.sources.status.fallback");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("settings.satelliteSource.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.satelliteSource.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(v) =>
              v && void onUpdate({ satelliteProvider: v as Mode })
            }
            className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {MODES.map(([value, option, short]) => (
              <ToggleGroupItem
                key={value}
                value={value}
                // Without a connected source there is nothing to switch to.
                disabled={value === "wms" && !connected && mode !== "wms"}
                className="h-auto min-h-14 rounded-md px-3 py-2 text-center whitespace-normal leading-tight first:rounded-md last:rounded-md"
              >
                <span className="flex flex-col items-center gap-0.5">
                  <span className="font-medium">
                    {t(`settings.satelliteSource.${option}`)}
                  </span>
                  <span className="text-[11px] font-normal opacity-75">
                    {t(`settings.satelliteSource.${short}`)}
                  </span>
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {t(`settings.satelliteSource.modeHint.${mode}`, {
              count: stateCount,
            })}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">
            {t("settings.satelliteSource.sources.title")}
          </h3>
          <ul className="divide-y rounded-md border">
            <SourceRow
              name={t("settings.satelliteSource.esriOption")}
              note={t("settings.satelliteSource.sources.esriNote")}
              status={mode === "wms" ? fallback : active}
              ok={mode !== "wms"}
            />
            <SourceRow
              name={t("settings.satelliteSource.sources.stateName")}
              note={t("settings.satelliteSource.sources.stateNote", {
                count: stateCount,
              })}
              status={
                mode === "auto" ? active : mode === "wms" ? fallback : unused
              }
              ok={mode === "auto"}
              action={
                <RowToggle
                  open={statesOpen}
                  onToggle={() => setStatesOpen((v) => !v)}
                  label={t("settings.satelliteSource.sources.stateList", {
                    count: stateCount,
                  })}
                />
              }
            >
              {statesOpen && (
                <ul className="grid gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2">
                  {STATE_SERVICES.map((service) => (
                    <li
                      key={service.state}
                      className="flex justify-between gap-2"
                    >
                      <span>{service.label}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {Math.round(service.resolutionM * 100)} cm ·{" "}
                        {service.license}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SourceRow>
            <CustomSourceRow
              settings={settings}
              mode={mode}
              connected={connected}
              onUpdate={onUpdate}
            />
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}

function RowToggle({
  open,
  onToggle,
  label,
}: Readonly<{
  open: boolean;
  onToggle: () => void;
  label: string;
}>): React.JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1 px-2 text-xs"
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? (
        <ChevronDown className="size-3.5" />
      ) : (
        <ChevronRight className="size-3.5" />
      )}
      {label}
    </Button>
  );
}

function SourceRow({
  name,
  note,
  status,
  ok,
  action,
  children,
}: Readonly<{
  name: string;
  note: string;
  status: string;
  ok: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}>): React.JSX.Element {
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">{name}</span>
          <p className="text-xs text-muted-foreground">{note}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "text-xs",
              ok ? "text-success" : "text-muted-foreground",
            )}
          >
            {status}
          </span>
          {action}
        </div>
      </div>
      {children}
    </li>
  );
}

function CustomSourceRow({
  settings,
  mode,
  connected,
  onUpdate,
}: Readonly<{
  settings: Settings;
  mode: Mode;
  connected: boolean;
  onUpdate: (partial: Partial<Settings>) => Promise<void>;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const stated = settings.customImagery;
  const status = !connected
    ? t("settings.natCat.catalog.status.available")
    : mode === "wms"
      ? t("settings.satelliteSource.sources.status.active")
      : t("settings.natCat.catalog.status.connected");

  return (
    <SourceRow
      name={stated?.name ?? t("settings.satelliteSource.sources.customName")}
      note={t("settings.satelliteSource.sources.customNote")}
      status={status}
      ok={connected}
      action={
        <RowToggle
          open={open}
          onToggle={() => setOpen((v) => !v)}
          label={t(
            connected
              ? "settings.natCat.connector.edit"
              : "settings.natCat.connector.connect",
          )}
        />
      }
    >
      {connected && mode !== "wms" && (
        <p className="text-xs text-muted-foreground">
          {t("settings.satelliteSource.sources.customInactive")}
        </p>
      )}
      {open && (
        <CustomSourceForm
          // The saved values are the starting point of the next edit.
          key={JSON.stringify([settings.wmsTileUrl, stated])}
          template={settings.wmsTileUrl ?? ""}
          stated={stated}
          connected={connected}
          onSave={(template, next) =>
            onUpdate({ wmsTileUrl: template, customImagery: next })
          }
          onDisconnect={() =>
            onUpdate({
              // An empty template disconnects (see settings.service).
              wmsTileUrl: "",
              ...(mode === "wms" ? { satelliteProvider: "auto" } : {}),
            })
          }
        />
      )}
    </SourceRow>
  );
}

function CustomSourceForm({
  template,
  stated,
  connected,
  onSave,
  onDisconnect,
}: Readonly<{
  template: string;
  stated: CustomImagery | undefined;
  connected: boolean;
  onSave: (template: string, stated: CustomImagery) => Promise<void>;
  onDisconnect: () => Promise<void>;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const id = useId();
  // Decimal comma or point as the language writes it; both are read.
  const shown = (n: number): string =>
    n.toLocaleString(i18n.language, { maximumFractionDigits: 3 });
  const [draftTemplate, setDraftTemplate] = useState(template);
  const [name, setName] = useState(stated?.name ?? "");
  const [attribution, setAttribution] = useState(stated?.attribution ?? "");
  const [resolution, setResolution] = useState(
    stated?.resolutionM != null ? shown(stated.resolutionM) : "",
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ImagerySourceTest | null>(null);
  // The sample tile is requested where the portfolio is, if there is one:
  // a source can answer and still not cover these sites.
  const site = useAppStore((s) => s.dealerships[0]);

  const check =
    draftTemplate.trim() === "" ? null : validateTileTemplate(draftTemplate);
  const resolutionM =
    resolution.trim() === "" ? null : parseResolution(resolution);
  const resolutionInvalid = resolution.trim() !== "" && resolutionM == null;
  // "Test connection" checks what is saved, so unsaved edits come first.
  const dirty =
    draftTemplate.trim() !== template ||
    name.trim() !== (stated?.name ?? "") ||
    attribution.trim() !== (stated?.attribution ?? "") ||
    (resolutionM ?? undefined) !== stated?.resolutionM;

  async function submit(): Promise<void> {
    if (!check?.ok || resolutionInvalid) return;
    setSaving(true);
    try {
      await onSave(check.template, {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(attribution.trim() ? { attribution: attribution.trim() } : {}),
        ...(resolutionM != null ? { resolutionM } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    try {
      setTest(
        await window.api.testCustomImagery(
          site ? { lat: site.lat, lon: site.lon } : undefined,
        ),
      );
    } catch (err) {
      setTest({
        ok: false,
        code: "unreachable",
        detail: err instanceof Error ? err.message.slice(0, 300) : undefined,
        lat: 0,
        lon: 0,
        zoom: 0,
        latencyMs: 0,
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-md bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="text-xs font-medium">
          {t("settings.satelliteSource.form.name")}
        </label>
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={80}
          placeholder={t("settings.satelliteSource.form.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-template`} className="text-xs font-medium">
          {t("settings.satelliteSource.tileTemplateLabel")}
        </label>
        <Input
          id={`${id}-template`}
          value={draftTemplate}
          placeholder="https://…/{z}/{x}/{y}.png"
          aria-invalid={check?.ok === false}
          onChange={(e) => setDraftTemplate(e.target.value)}
        />
        {check?.ok === false && (
          <p className="text-xs text-destructive">
            {t(`settings.satelliteSource.tileTemplateErrors.${check.problem}`)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("settings.satelliteSource.tileTemplateHint")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-1">
          <label htmlFor={`${id}-attribution`} className="text-xs font-medium">
            {t("settings.satelliteSource.form.attribution")}
          </label>
          <Input
            id={`${id}-attribution`}
            value={attribution}
            maxLength={200}
            placeholder="© …"
            onChange={(e) => setAttribution(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.satelliteSource.form.attributionHint")}
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-resolution`} className="text-xs font-medium">
            {t("settings.satelliteSource.form.resolution")}
          </label>
          <Input
            id={`${id}-resolution`}
            value={resolution}
            inputMode="decimal"
            placeholder={shown(0.2)}
            aria-invalid={resolutionInvalid}
            onChange={(e) => setResolution(e.target.value)}
          />
          {resolutionInvalid && (
            <p className="text-xs text-destructive">
              {t("settings.satelliteSource.form.resolutionError")}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.satelliteSource.form.resolutionHint")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={saving || !check?.ok || resolutionInvalid || !dirty}
        >
          {saving && <Loader2 className="animate-spin" />}
          {t("settings.natCat.connector.save")}
        </Button>
        {connected && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={testing || dirty}
              onClick={() => void runTest()}
            >
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {t("settings.natCat.connector.test")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => void onDisconnect()}
            >
              {t("settings.natCat.connector.disconnect")}
            </Button>
          </>
        )}
      </div>
      {test && (
        <div className="flex flex-wrap items-start gap-3">
          {test.preview && (
            <img
              src={test.preview}
              alt={t("settings.satelliteSource.test.previewAlt")}
              className="size-32 shrink-0 rounded-md border"
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p
              className={cn(
                "flex items-start gap-1.5 text-xs",
                test.ok ? "text-success" : "text-destructive",
              )}
            >
              {test.ok ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span className="break-words">
                {t(`settings.satelliteSource.test.${test.code}`, {
                  ms: test.latencyMs,
                  status: test.status ?? "",
                  detail: test.detail ?? "",
                })}
              </span>
            </p>
            {test.zoom > 0 && (
              <p className="text-xs text-muted-foreground">
                {site
                  ? t("settings.satelliteSource.test.atSite", {
                      name: site.name,
                    })
                  : t("settings.satelliteSource.test.atDefault")}
              </p>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
