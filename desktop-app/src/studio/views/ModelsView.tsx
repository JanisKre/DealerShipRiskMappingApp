import { Copy, Rocket } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { api, runColor, type Status } from "@studio/api";
import { askConfirm } from "@studio/components/ConfirmDialog";
import { RunLines } from "@studio/components/LineChartCard";
import {
  appEvaluation,
  atSweepEdge,
  showError,
  startStep,
  suggestedThreshold,
  ultralyticsEvaluation,
} from "@studio/lib";
import { fmt, pct, share } from "@studio/numbers";
import { Swatch } from "./TrainingView";

/**
 * Compare runs and act on one: measure it, install it (export + backup), or
 * ship the installed model with the next app release.
 */
export function ModelsView({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const busy = status.job?.status === "running";
  const names = status.runs.map((r) => r.name);
  const installed = status.models.installed;
  const release = status.models.release;
  const shipped = Boolean(installed && installed.sha256 === release.onnxSha256);
  const [pinOut, setPinOut] = useState<{
    tag: string;
    commands: string[];
  } | null>(null);

  const installBlocked = status.models.installBlocked
    ? t("models.installBlocked")
    : null;
  // Why "ausliefern" is not possible now; shown next to the button (a disabled button shows no tooltip).
  const shipBlocked = release.blocked
    ? t("models.shipSandbox")
    : busy
      ? t("common.busy")
      : !installed
        ? t("models.shipNothing")
        : !installed.manifestMatches
          ? t("models.shipMismatch")
          : null;
  const valSites = status.dataset.valSites;

  const rows = status.weights.map((run) => {
    const app = appEvaluation(status, run);
    const suggested = app ? suggestedThreshold(app) : null;
    return {
      run,
      app,
      suggested,
      edge: Boolean(app && suggested && atSweepEdge(app, suggested)),
      map50: ultralyticsEvaluation(status, run)?.map50 ?? null,
      installed: installed?.weights === run,
    };
  });
  const measured = rows.filter((r) => r.app);

  const install = (run: string, conf: number): void =>
    void startStep(
      "export",
      { weights: run, defaultConf: conf, install: true },
      reload,
      {
        title: t("models.installTitle", { run }),
        text: t("models.installText", { run, conf: fmt(conf, 2) }),
        confirm: t("models.install"),
      },
    );

  const ship = async (): Promise<void> => {
    const ok = await askConfirm({
      title: t("models.shipTitle"),
      text: t("models.shipText"),
      confirm: t("models.shipConfirm"),
    });
    if (!ok) return;
    try {
      setPinOut(await api.pinRelease("installed"));
      toast.success(t("models.pinned"));
      reload();
    } catch (e) {
      showError(e);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("app.nav.models")}
        </h1>
        <p className="text-muted-foreground text-sm">{t("models.subtitle")}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t("models.chartTitle")}
          </CardTitle>
          <CardDescription>
            {valSites
              ? t("models.chartText", { count: valSites })
              : t("models.chartTextAny")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunLines
            xLabel={t("models.threshold")}
            xFormat={(x) => fmt(x, 2)}
            valueFormat={(y) => fmt(y, 2)}
            series={measured.map((r) => ({
              key: r.run.replace(/[^a-z0-9]/gi, "_"),
              label: r.run,
              color: runColor(r.run, names),
              points: r.app!.thresholds.map(
                (t) => [t.conf, t.mae] as [number, number],
              ),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t("models.tableTitle")}
          </CardTitle>
          <CardDescription>{t("models.tableText")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("models.colRun")}</TableHead>
                <TableHead className="text-right">
                  {t("models.colThreshold")}
                </TableHead>
                <TableHead className="text-right">
                  {t("models.colMae")}
                </TableHead>
                <TableHead className="text-right">
                  {t("models.colBias")}
                </TableHead>
                <TableHead
                  className="text-right"
                  title={t("models.colWithin10Hint")}
                >
                  {t("models.colWithin10")}
                </TableHead>
                <TableHead className="text-right">
                  {t("models.colMap50")}
                </TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.run}>
                  <TableCell className="font-medium">
                    <Swatch color={runColor(r.run, names)} />
                    {r.run}
                    {r.installed && (
                      <Badge variant="secondary" className="ml-2">
                        {t("models.installed")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    title={r.edge ? t("models.edgeTitle") : undefined}
                  >
                    {r.suggested ? fmt(r.suggested.conf, 2) : "–"}
                    {r.edge && (
                      <span className="text-warning-foreground">
                        {" "}
                        {t("models.edge")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.suggested ? fmt(r.suggested.mae, 1) : "–"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.suggested ? pct(r.suggested.bias) : "–"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.suggested ? share(r.suggested.within10) : "–"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.map50 != null ? fmt(r.map50, 3) : "–"}
                  </TableCell>
                  <TableCell className="text-right">
                    {!r.app ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void startStep("measure", { weights: r.run }, reload)
                        }
                      >
                        {t("models.measure")}
                      </Button>
                    ) : r.installed ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || Boolean(installBlocked)}
                        onClick={() => install(r.run, r.suggested!.conf)}
                      >
                        {t("models.install")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-3 text-xs">
            {t("models.footer")}
          </p>
          {installBlocked && (
            <p className="text-muted-foreground mt-1 text-xs">
              {installBlocked}
            </p>
          )}
          {rows.some((r) => r.edge) && (
            <p className="text-muted-foreground mt-1 text-xs">
              {t("models.edgeNote")}
            </p>
          )}
          {!rows.length && (
            <p className="text-muted-foreground mt-1 text-xs">
              {t("models.noModels")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle
              role="heading"
              aria-level={2}
              className="flex items-center gap-2"
            >
              <Rocket className="size-4" /> {t("models.shipCard")}
            </CardTitle>
            <CardDescription className="mt-1.5 break-words">
              {t("models.installedLabel")}{" "}
              <b className="text-foreground">{installed?.version ?? "–"}</b> ·{" "}
              {t("models.shippedLabel")}{" "}
              <b className="text-foreground font-mono">{release.tag ?? "–"}</b>
            </CardDescription>
          </div>
          {shipped ? (
            <Badge variant="secondary">{t("models.identical")}</Badge>
          ) : (
            <Button disabled={Boolean(shipBlocked)} onClick={() => void ship()}>
              {t("models.ship")}
            </Button>
          )}
        </CardHeader>
        {shipBlocked && !shipped && (
          <CardContent className="text-muted-foreground -mt-2 text-xs">
            {shipBlocked}
          </CardContent>
        )}
        {pinOut && (
          <CardContent className="space-y-2">
            <p className="text-sm">
              <Trans
                i18nKey="models.pinnedText"
                values={{ tag: pinOut.tag }}
                components={{ b: <b className="font-mono" /> }}
              />
            </p>
            {pinOut.commands.map((c) => (
              <div
                key={c}
                className="bg-background flex items-start gap-2 rounded-md border p-2"
              >
                <code className="flex-1 font-mono text-[11px] break-all whitespace-pre-wrap">
                  {c}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={t("models.copy")}
                  title={t("models.copy")}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(c)
                      .then(() => toast(t("models.copied")))
                  }
                >
                  <Copy />
                </Button>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
