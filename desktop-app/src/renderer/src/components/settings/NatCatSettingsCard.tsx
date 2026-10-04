import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  PlugZap,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { NatCatConnectorTest } from "@shared/ipc-schema";
import {
  NAT_CAT_CATALOG,
  coversPeril,
  sourceLabel,
  type NatCatCatalogEntry,
} from "@shared/natcat-catalog";
import {
  DEFAULT_NAT_CAT_ROUTING,
  effectiveNatCatRouting,
  isDefaultRouting,
  type NatCatRouting,
} from "@shared/natcat-routing";
import {
  NAT_CAT_API_PROVIDERS,
  PERILS,
  type NatCatApiProvider,
  type NatCatPerilSource,
  type NatCatSettings,
  type Peril,
  type Settings,
} from "@shared/types";
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

/** Strips Electron's "Error invoking remote method '…': Error: " prefix. */
function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
}

function isApiProvider(id: string): id is NatCatApiProvider {
  return (NAT_CAT_API_PROVIDERS as readonly string[]).includes(id);
}

/**
 * Natural-catastrophe data sources: per-peril routing (primary source plus
 * overrides such as "flood from a flood specialist"), a reset to the
 * screening default, and a catalog of providers with their connectors.
 */
export function NatCatSettingsCard({
  settings,
  onSettingsChange,
}: Readonly<{
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [showAllProviders, setShowAllProviders] = useState(false);
  const routing = effectiveNatCatRouting(settings.natCat);
  const connected = NAT_CAT_API_PROVIDERS.filter(
    (p) => routing.connectors[p]?.endpoint,
  );
  const isDefault = isDefaultRouting(routing);
  const visibleCatalog = showAllProviders
    ? NAT_CAT_CATALOG
    : NAT_CAT_CATALOG.filter(
        (entry) =>
          entry.kind !== "api" ||
          (isApiProvider(entry.id) && connected.includes(entry.id)),
      );
  const hiddenProviderCount = NAT_CAT_CATALOG.length - visibleCatalog.length;

  async function save(partial: Partial<NatCatSettings>): Promise<void> {
    try {
      const next = await window.api.setSettings({
        natCat: {
          ...settings.natCat,
          // Persist the effective routing so legacy CatNet fields migrate.
          provider: settings.natCat?.provider ?? "screening",
          primary: routing.primary,
          perilSources: routing.perilSources,
          connectors: routing.connectors,
          ...partial,
        },
      });
      onSettingsChange(next);
      toast.success(t("common.saved"));
    } catch (err) {
      console.error("Saving NatCat settings failed:", err);
      toast.error(ipcErrorMessage(err));
    }
  }

  function setPerilSource(peril: Peril, source: NatCatPerilSource): void {
    const perilSources = { ...routing.perilSources };
    if (source === "primary") delete perilSources[peril];
    else perilSources[peril] = source;
    void save({ perilSources });
  }

  async function disconnect(provider: NatCatApiProvider): Promise<void> {
    const connectors = { ...routing.connectors };
    delete connectors[provider];
    // Nothing may keep pointing at a source that no longer exists.
    const perilSources = Object.fromEntries(
      Object.entries(routing.perilSources).filter(([, s]) => s !== provider),
    ) as NatCatRouting["perilSources"];
    try {
      await window.api.deleteNatCatApiKey(provider);
    } catch (err) {
      console.error("Deleting NatCat API key failed:", err);
    }
    await save({
      connectors,
      perilSources,
      primary: routing.primary === provider ? "screening" : routing.primary,
      ...(provider === "swissre-catnet"
        ? { catnetEndpoint: undefined, provider: "screening" }
        : {}),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {t("settings.natCat.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={isDefault ? "outline" : "secondary"}>
              {t(
                isDefault
                  ? "settings.natCat.statusDefault"
                  : "settings.natCat.statusLicensed",
              )}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              disabled={isDefault}
              onClick={() => void save({ ...DEFAULT_NAT_CAT_ROUTING })}
              title={t("settings.natCat.resetHint")}
            >
              <RotateCcw />
              {t("settings.natCat.reset")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("settings.natCat.intro")}
        </p>

        <RoutingTable
          routing={routing}
          connected={connected}
          onPrimaryChange={(primary) => void save({ primary })}
          onPerilChange={setPerilSource}
        />

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              {t("settings.natCat.catalog.title")}
            </h3>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => setShowAllProviders((open) => !open)}
            >
              {showAllProviders ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {t(
                showAllProviders
                  ? "settings.natCat.catalog.hideAll"
                  : "settings.natCat.catalog.showAll",
                { count: hiddenProviderCount },
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.natCat.catalog.description")}
          </p>
          <ul className="divide-y rounded-md border">
            {visibleCatalog.map((entry) => (
              <CatalogRow
                key={entry.id}
                entry={entry}
                endpoint={
                  isApiProvider(entry.id)
                    ? routing.connectors[entry.id]?.endpoint
                    : undefined
                }
                hasApiKey={
                  isApiProvider(entry.id)
                    ? Boolean(
                        entry.id === "swissre-catnet"
                          ? (routing.connectors[entry.id]?.hasApiKey ??
                              settings.natCat?.catnetHasApiKey)
                          : routing.connectors[entry.id]?.hasApiKey,
                      )
                    : false
                }
                onSave={async (provider, endpoint, apiKey) => {
                  if (apiKey) {
                    try {
                      await window.api.setNatCatApiKey(provider, apiKey);
                    } catch (err) {
                      toast.error(ipcErrorMessage(err));
                      return;
                    }
                  }
                  await save({
                    connectors: {
                      ...routing.connectors,
                      [provider]: { endpoint },
                    },
                  });
                }}
                onDisconnect={(provider) => void disconnect(provider)}
              />
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}

function RoutingTable({
  routing,
  connected,
  onPrimaryChange,
  onPerilChange,
}: Readonly<{
  routing: NatCatRouting;
  connected: NatCatApiProvider[];
  onPrimaryChange: (primary: NatCatRouting["primary"]) => void;
  onPerilChange: (peril: Peril, source: NatCatPerilSource) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const name = (id: "screening" | NatCatApiProvider): string =>
    id === "screening" ? t("settings.natCat.screening") : sourceLabel(id);
  // Multi-peril sources only; a flood specialist cannot be the primary.
  const primaryOptions = connected.filter((p) =>
    PERILS.every((peril) => coversPeril(p, peril)),
  );

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">
        {t("settings.natCat.routing.title")}
      </h3>
      <div className="grid items-center gap-x-3 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <label className="text-sm font-medium">
          {t("settings.natCat.routing.primary")}
        </label>
        <Select
          value={routing.primary}
          onValueChange={(v) => onPrimaryChange(v as NatCatRouting["primary"])}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="screening">
              {t("settings.natCat.screeningDefault")}
            </SelectItem>
            {primaryOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {sourceLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {PERILS.map((peril) => {
          const options = connected.filter((p) => coversPeril(p, peril));
          return (
            <PerilRow
              key={peril}
              label={t(`settings.natCat.perils.${peril}`)}
              value={routing.perilSources[peril] ?? "primary"}
              primaryLabel={t("settings.natCat.routing.followPrimary", {
                source: name(routing.primary),
              })}
              primary={routing.primary}
              options={options}
              onChange={(source) => onPerilChange(peril, source)}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.natCat.routing.order")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("settings.natCat.routing.applies")}
      </p>
    </section>
  );
}

function PerilRow({
  label,
  value,
  primaryLabel,
  primary,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: NatCatPerilSource;
  primaryLabel: string;
  primary: NatCatRouting["primary"];
  options: NatCatApiProvider[];
  onChange: (source: NatCatPerilSource) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const primaryIsScreening = primary === "screening";
  // When the main source is screening, both choices have the same effect.
  const showPrimary = !primaryIsScreening || value !== "screening";
  const showExplicitScreening = !primaryIsScreening || value === "screening";
  return (
    <>
      <span className="text-sm">{label}</span>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as NatCatPerilSource)}
      >
        <SelectTrigger
          className={cn("w-full", value !== "primary" && "border-primary")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {showPrimary && (
            <SelectItem value="primary">
              {primaryIsScreening
                ? t("settings.natCat.screening")
                : primaryLabel}
            </SelectItem>
          )}
          {showExplicitScreening && (
            <SelectItem value="screening">
              {t("settings.natCat.screening")}
            </SelectItem>
          )}
          {options.map((p) => (
            <SelectItem key={p} value={p}>
              {sourceLabel(p)}
            </SelectItem>
          ))}
          {/* Keep a saved choice visible after its connector was removed. */}
          {value !== "primary" &&
            value !== "screening" &&
            !options.includes(value) && (
              <SelectItem value={value} disabled>
                {sourceLabel(value)} ({t("settings.natCat.notConnected")})
              </SelectItem>
            )}
        </SelectContent>
      </Select>
    </>
  );
}

function CatalogRow({
  entry,
  endpoint,
  hasApiKey,
  onSave,
  onDisconnect,
}: Readonly<{
  entry: NatCatCatalogEntry;
  endpoint: string | undefined;
  hasApiKey: boolean;
  onSave: (
    provider: NatCatApiProvider,
    endpoint: string,
    apiKey: string,
  ) => Promise<void>;
  onDisconnect: (provider: NatCatApiProvider) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint ?? "");
  const [draftKey, setDraftKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<NatCatConnectorTest | null>(null);
  const provider = isApiProvider(entry.id) ? entry.id : null;
  const isApi = provider !== null;
  const isConnected = Boolean(endpoint);

  const status =
    entry.kind === "builtin"
      ? { label: t("settings.natCat.catalog.status.builtin"), tone: "ok" }
      : entry.kind === "import"
        ? { label: t("settings.natCat.catalog.status.import"), tone: "info" }
        : entry.kind === "planned"
          ? {
              label: t("settings.natCat.catalog.status.planned"),
              tone: "muted",
            }
          : isConnected
            ? {
                label: t("settings.natCat.catalog.status.connected"),
                tone: "ok",
              }
            : {
                label: t("settings.natCat.catalog.status.available"),
                tone: "muted",
              };

  async function submit(): Promise<void> {
    if (!provider) return;
    setSaving(true);
    setTest(null);
    try {
      await onSave(provider, draftEndpoint.trim(), draftKey.trim());
      setDraftKey("");
    } finally {
      setSaving(false);
    }
  }

  async function runTest(): Promise<void> {
    if (!provider) return;
    setTesting(true);
    try {
      setTest(await window.api.testNatCatConnector(provider));
    } catch (err) {
      setTest({
        ok: false,
        perils: [],
        message: ipcErrorMessage(err),
        latencyMs: 0,
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">
              {entry.vendor === "—"
                ? t("settings.natCat.catalog.customName")
                : `${entry.vendor} ${entry.name}`}
            </span>
            {entry.website && (
              <a
                href={entry.website}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("settings.natCat.catalog.website")}
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          {(!isApi || open) && (
            <>
              <p className="text-xs text-muted-foreground">
                {t(`settings.natCat.catalog.notes.${entry.noteKey}`)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {entry.perils === "all" ? (
                  <Badge variant="outline" className="text-[10px]">
                    {t("settings.natCat.catalog.allPerils")}
                  </Badge>
                ) : (
                  entry.perils.map((p) => (
                    <Badge key={p} variant="outline" className="text-[10px]">
                      {t(`settings.natCat.perils.${p}`)}
                    </Badge>
                  ))
                )}
                {entry.extraHazards?.map((h) => (
                  <Badge key={h} variant="outline" className="text-[10px]">
                    {t(`settings.natCat.perils.${h}`)}
                  </Badge>
                ))}
                <Badge variant="secondary" className="text-[10px]">
                  {t(`settings.natCat.catalog.license.${entry.license}`)}
                </Badge>
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "text-xs",
              status.tone === "ok" && "text-emerald-600 dark:text-emerald-400",
              status.tone === "muted" && "text-muted-foreground",
            )}
          >
            {status.label}
          </span>
          {isApi && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {t(
                isConnected
                  ? "settings.natCat.connector.edit"
                  : "settings.natCat.connector.connect",
              )}
            </Button>
          )}
        </div>
      </div>

      {isApi && open && (
        <form
          className="space-y-2 rounded-md bg-muted/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-xs text-muted-foreground">
            {t("settings.natCat.connector.contract")}
          </p>
          <div className="space-y-1">
            <label className="text-xs font-medium">
              {t("settings.natCat.connector.endpoint")}
            </label>
            <Input
              value={draftEndpoint}
              placeholder="https://…"
              onChange={(e) => setDraftEndpoint(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">
              {t("settings.natCat.connector.key")}
            </label>
            <Input
              type="password"
              value={draftKey}
              placeholder={
                hasApiKey
                  ? t("settings.natCat.keySet")
                  : t("settings.natCat.keyUnset")
              }
              onChange={(e) => setDraftKey(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                saving ||
                !draftEndpoint.trim() ||
                (!hasApiKey && !draftKey.trim())
              }
            >
              {saving && <Loader2 className="animate-spin" />}
              {t("settings.natCat.connector.save")}
            </Button>
            {isConnected && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={testing}
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
                  onClick={() => provider && onDisconnect(provider)}
                >
                  {t("settings.natCat.connector.disconnect")}
                </Button>
              </>
            )}
          </div>
          {test &&
            (test.ok ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5 shrink-0" />
                {t("settings.natCat.connector.testOk", {
                  perils: test.perils.join(", "),
                  ms: test.latencyMs,
                })}
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <XCircle className="mt-0.5 size-3.5 shrink-0" />
                {t("settings.natCat.connector.testFailed", {
                  error: test.message ?? "",
                })}
              </p>
            ))}
        </form>
      )}
    </li>
  );
}
