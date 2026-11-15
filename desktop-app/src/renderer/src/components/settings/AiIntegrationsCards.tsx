import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, FileDown, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Settings } from "@shared/types";
import {
  DEFAULT_GATEWAY_SETTINGS,
  claudeCodeCommand,
  claudeDesktopConfig,
  gatewayBaseUrl,
  maskToken,
  type AgentGatewaySettings,
  type AgentGatewayStatus,
} from "@shared/agent-gateway";
import {
  MCP_CLIENT_MAX_SERVERS,
  validateMcpServerUrl,
  type McpServerConfig,
  type McpServerTools,
} from "@shared/mcp-client";
import type { AiLogDetail, AiLogPage } from "@shared/ai-log";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Switch } from "@renderer/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";

type UpdateSettings = (partial: Partial<Settings>) => Promise<void>;
type CardProps = Readonly<{ settings: Settings; onUpdate: UpdateSettings }>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await window.api.writeClipboardText(text);
    toast.success(done);
  } catch (error) {
    toast.error(errorText(error));
  }
}

/** A switch with its label and hint, used by all three cards. */
function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}>): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

// --- Agent gateway -----------------------------------------------------------

/**
 * Local agent gateway: lets other AI tools on this computer read the
 * portfolio over MCP, A2A and AG-UI. Off by default.
 */
export function AgentGatewayCard({
  settings,
  onUpdate,
}: CardProps): React.JSX.Element {
  const { t } = useTranslation();
  const gateway: AgentGatewaySettings = {
    ...DEFAULT_GATEWAY_SETTINGS,
    ...settings.agentGateway,
  };
  const [status, setStatus] = useState<AgentGatewayStatus | null>(null);
  const [port, setPort] = useState(String(gateway.port));

  const refresh = useCallback(() => {
    void window.api
      .gatewayStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  // The server starts asynchronously after a settings change.
  useEffect(() => {
    refresh();
    const timer = setTimeout(refresh, 600);
    return () => clearTimeout(timer);
  }, [refresh, settings.agentGateway]);
  useEffect(() => setPort(String(gateway.port)), [gateway.port]);

  const save = (partial: Partial<AgentGatewaySettings>): void =>
    void onUpdate({ agentGateway: { ...gateway, ...partial } });

  function savePort(): void {
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      toast.error(t("agentGateway.portInvalid"));
      setPort(String(gateway.port));
      return;
    }
    if (value !== gateway.port) save({ port: value });
  }

  const base = gatewayBaseUrl(status?.port ?? gateway.port);
  const token = status?.token ?? "";
  const activePort = status?.port ?? gateway.port;
  const claudeCommand = claudeCodeCommand(activePort, token);
  const snippets = [
    {
      key: "prompt",
      text: t("agentGateway.claudePrompt", { command: claudeCommand }),
    },
    { key: "command", text: claudeCommand },
    { key: "desktop", text: claudeDesktopConfig(activePort, token) },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {t("agentGateway.title")}
          {gateway.enabled && status && (
            <Badge variant={status.running ? "default" : "destructive"}>
              {status.running
                ? t("agentGateway.running", { port: status.port })
                : t("agentGateway.stopped")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t("agentGateway.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y">
          <SwitchRow
            label={t("agentGateway.enable")}
            hint={t("agentGateway.enableHint")}
            checked={gateway.enabled}
            onChange={(enabled) => save({ enabled })}
          />
          <SwitchRow
            label={t("agentGateway.mcp")}
            hint={t("agentGateway.mcpHint")}
            checked={gateway.mcp}
            disabled={!gateway.enabled}
            onChange={(mcp) => save({ mcp })}
          />
          <SwitchRow
            label={t("agentGateway.a2a")}
            hint={t("agentGateway.a2aHint")}
            checked={gateway.a2a}
            disabled={!gateway.enabled}
            onChange={(a2a) => save({ a2a })}
          />
          <SwitchRow
            label={t("agentGateway.agUi")}
            hint={t("agentGateway.agUiHint")}
            checked={gateway.agUi}
            disabled={!gateway.enabled}
            onChange={(agUi) => save({ agUi })}
          />
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("agentGateway.port")}</p>
              <p className="text-xs text-muted-foreground">
                {t("agentGateway.portHint")}
              </p>
            </div>
            <Input
              className="w-28"
              inputMode="numeric"
              value={port}
              aria-label={t("agentGateway.port")}
              onChange={(e) => setPort(e.target.value)}
              onBlur={savePort}
            />
          </div>
        </div>

        {gateway.enabled && status?.error && (
          <p className="text-sm text-destructive">
            {t("agentGateway.startFailed", { error: status.error })}
          </p>
        )}

        {gateway.enabled && status?.running && token && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
            <p className="font-medium">{t("agentGateway.connect")}</p>
            <ul className="space-y-1 font-mono">
              {gateway.mcp && <li>MCP: {base}/mcp</li>}
              {gateway.a2a && <li>A2A: {base}/.well-known/agent-card.json</li>}
              {gateway.agUi && <li>AG-UI: {base}/ag-ui</li>}
            </ul>
            <p className="text-muted-foreground">
              {t("agentGateway.tokenHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copy(token, t("agentGateway.copied"))}
              >
                <Copy /> {t("agentGateway.copyToken")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void window.api
                    .rotateGatewayToken()
                    .then((next) => {
                      setStatus(next);
                      toast.success(t("agentGateway.tokenRotated"));
                    })
                    .catch((error: unknown) => toast.error(errorText(error)))
                }
              >
                <RefreshCw /> {t("agentGateway.rotateToken")}
              </Button>
            </div>
          </div>
        )}
        {gateway.enabled && gateway.mcp && status?.running && token && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">
                {t("agentGateway.claude.title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("agentGateway.claude.description")}
              </p>
            </div>
            {snippets.map((snippet) => (
              <div key={snippet.key} className="space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t(`agentGateway.claude.${snippet.key}.title`)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(`agentGateway.claude.${snippet.key}.hint`)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      void copy(snippet.text, t("agentGateway.copied"))
                    }
                  >
                    <Copy /> {t("aiInsight.copy")}
                  </Button>
                </div>
                {/* Shown with the token hidden; the copy carries it. */}
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-xs [overflow-wrap:anywhere]">
                  {maskToken(snippet.text, token)}
                </pre>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("agentGateway.privacy")}
        </p>
      </CardContent>
    </Card>
  );
}

// --- External MCP servers ----------------------------------------------------

function serverId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "server";
  return `${slug}-${globalThis.crypto.randomUUID().slice(0, 6)}`;
}

/** External MCP servers whose read-only tools the chat may use. */
export function McpServersCard({
  settings,
  onUpdate,
}: CardProps): React.JSX.Element {
  const { t } = useTranslation();
  const servers = settings.mcpServers ?? [];
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [tools, setTools] = useState<Record<string, McpServerTools>>({});

  const urlCheck = url.trim() === "" ? null : validateMcpServerUrl(url);
  const save = (next: McpServerConfig[]): Promise<void> =>
    onUpdate({ mcpServers: next });

  async function add(): Promise<void> {
    if (!name.trim() || !urlCheck?.ok) return;
    await save([
      ...servers,
      {
        id: serverId(name),
        name: name.trim(),
        url: urlCheck.url,
        enabled: true,
      },
    ]);
    setName("");
    setUrl("");
  }

  async function test(id: string): Promise<void> {
    setTesting(id);
    try {
      const result = await window.api.mcpServerTools(id);
      setTools((current) => ({ ...current, [id]: result }));
    } catch (error) {
      toast.error(t("mcpServers.testFailed", { error: errorText(error) }));
    } finally {
      setTesting(null);
    }
  }

  async function saveToken(id: string): Promise<void> {
    try {
      await window.api.setMcpServerToken(id, tokens[id] ?? "");
      setTokens((current) => ({ ...current, [id]: "" }));
      // Re-save so the settings reload with the new `hasToken` flag.
      await save(servers);
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await window.api.setMcpServerToken(id, "");
    } catch {
      // Without a keychain there is no stored token to remove.
    }
    await save(servers.filter((s) => s.id !== id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("mcpServers.title")}</CardTitle>
        <CardDescription>{t("mcpServers.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {servers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("mcpServers.empty")}
          </p>
        )}
        {servers.map((server) => {
          const listed = tools[server.id];
          const readOnly = listed?.tools.filter((tool) => tool.readOnly) ?? [];
          return (
            <div key={server.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{server.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {server.url}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={server.enabled}
                    aria-label={t("mcpServers.enabled", { name: server.name })}
                    onCheckedChange={(enabled) =>
                      void save(
                        servers.map((s) =>
                          s.id === server.id ? { ...s, enabled } : s,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testing !== null}
                    onClick={() => void test(server.id)}
                  >
                    {testing === server.id && (
                      <Loader2 className="animate-spin" />
                    )}
                    {t("mcpServers.test")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("mcpServers.remove", { name: server.name })}
                    onClick={() => void remove(server.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  className="h-8"
                  value={tokens[server.id] ?? ""}
                  placeholder={
                    server.hasToken
                      ? t("mcpServers.tokenStored")
                      : t("mcpServers.tokenPlaceholder")
                  }
                  aria-label={t("mcpServers.tokenPlaceholder")}
                  onChange={(e) =>
                    setTokens((current) => ({
                      ...current,
                      [server.id]: e.target.value,
                    }))
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !(tokens[server.id] ?? "").trim() && !server.hasToken
                  }
                  onClick={() => void saveToken(server.id)}
                >
                  {(tokens[server.id] ?? "").trim() || !server.hasToken
                    ? t("mcpServers.tokenSave")
                    : t("mcpServers.tokenRemove")}
                </Button>
              </div>
              {listed && (
                <p className="text-xs text-muted-foreground">
                  {t("mcpServers.tools", {
                    server: listed.serverName,
                    total: listed.tools.length,
                    usable: readOnly.length,
                  })}
                  {readOnly.length > 0 &&
                    ` ${readOnly.map((tool) => tool.name).join(", ")}`}
                </p>
              )}
            </div>
          );
        })}

        {servers.length < MCP_CLIENT_MAX_SERVERS && (
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Input
              value={name}
              maxLength={60}
              placeholder={t("mcpServers.namePlaceholder")}
              aria-label={t("mcpServers.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              value={url}
              maxLength={500}
              placeholder="https://…/mcp"
              aria-label={t("mcpServers.urlLabel")}
              aria-invalid={urlCheck != null && !urlCheck.ok}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!name.trim() || !urlCheck?.ok}
              onClick={() => void add()}
            >
              <Plus /> {t("mcpServers.add")}
            </Button>
            {urlCheck && !urlCheck.ok && (
              <p className="text-xs text-destructive sm:col-span-3">
                {t(`mcpServers.urlProblem.${urlCheck.problem}`)}
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("mcpServers.privacy")}
        </p>
      </CardContent>
    </Card>
  );
}

// --- AI record book ----------------------------------------------------------

/** Every request sent to an AI provider, kept locally and exportable. */
export function AiLogCard({
  settings,
  onUpdate,
}: CardProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<AiLogPage | null>(null);
  const [detail, setDetail] = useState<AiLogDetail | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const enabled = settings.aiLogEnabled !== false;

  const load = useCallback(() => {
    void window.api
      .listAiLog(0)
      .then(setPage)
      .catch(() => setPage({ entries: [], total: 0 }));
  }, []);
  useEffect(load, [load]);

  const time = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "medium",
  });

  async function exportLog(): Promise<void> {
    try {
      const { path } = await window.api.exportAiLog();
      if (path) toast.success(t("aiLog.exported"));
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function clear(): Promise<void> {
    try {
      await window.api.clearAiLog();
      setConfirmClear(false);
      load();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("aiLog.title")}</CardTitle>
        <CardDescription>{t("aiLog.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SwitchRow
          label={t("aiLog.enable")}
          hint={t("aiLog.enableHint")}
          checked={enabled}
          onChange={(aiLogEnabled) => void onUpdate({ aiLogEnabled })}
        />
        {page && page.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("aiLog.empty")}</p>
        ) : (
          page && (
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("aiLog.col.time")}</TableHead>
                    <TableHead>{t("aiLog.col.feature")}</TableHead>
                    <TableHead>{t("aiLog.col.model")}</TableHead>
                    <TableHead>{t("aiLog.col.destination")}</TableHead>
                    <TableHead>{t("aiLog.col.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.entries.map((entry) => (
                    <TableRow
                      key={entry.id}
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() =>
                        void window.api.getAiLogEntry(entry.id).then(setDetail)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          void window.api
                            .getAiLogEntry(entry.id)
                            .then(setDetail);
                      }}
                    >
                      <TableCell className="whitespace-nowrap text-xs">
                        {time.format(new Date(entry.at))}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.feature}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-xs">
                        {entry.model}
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.local ? (
                          <Badge variant="secondary">{t("aiLog.local")}</Badge>
                        ) : (
                          entry.endpointHost
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant={
                            entry.status === "ok"
                              ? "outline"
                              : entry.status === "error"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {t(`aiLog.status.${entry.status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
        {page && page.total > page.entries.length && (
          <p className="text-xs text-muted-foreground">
            {t("aiLog.more", {
              shown: page.entries.length,
              total: page.total,
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw /> {t("aiLog.refresh")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!page || page.total === 0}
            onClick={() => void exportLog()}
          >
            <FileDown /> {t("aiLog.export")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!page || page.total === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 /> {t("aiLog.clear")}
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={detail !== null}
        onOpenChange={(o) => !o && setDetail(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {detail?.feature}
            </DialogTitle>
            <DialogDescription>
              {detail &&
                t("aiLog.detailMeta", {
                  time: time.format(new Date(detail.at)),
                  provider: detail.provider,
                  model: detail.model,
                  host: detail.endpointHost,
                  seconds: (detail.durationMs / 1000).toFixed(1),
                  images: detail.imageCount,
                })}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="max-h-[60vh] space-y-3 overflow-auto text-xs">
              {detail.error && (
                <p className="text-destructive">{detail.error}</p>
              )}
              <div>
                <p className="mb-1 font-medium">{t("aiLog.request")}</p>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2">
                  {detail.request}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-medium">{t("aiLog.response")}</p>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2">
                  {detail.response || "—"}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("aiLog.clearTitle")}</DialogTitle>
            <DialogDescription>{t("aiLog.clearDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("common.cancel")}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void clear()}>
              {t("aiLog.clear")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
