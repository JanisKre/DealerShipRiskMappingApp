import { Copy, Download, Rocket } from "lucide-react";
import { useMemo, useState } from "react";
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
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs";
import {
  api,
  fmt,
  pct,
  runColor,
  type Evaluation,
  type ModelFiles,
  type Status,
} from "@studio/api";
import { RunLines } from "@studio/components/LineChartCard";
import { Swatch } from "./TrainingView";

export function ModelsView({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
  const [pipeline, setPipeline] =
    useState<Evaluation["pipeline"]>("app-inferWindow");
  const names = status.runs.map((r) => r.name);
  const busy = status.job?.status === "running";

  // Latest evaluation per run for the chosen pipeline.
  const latest = useMemo(() => {
    const byRun = new Map<string, Evaluation>();
    for (const e of status.evals)
      if (e.pipeline === pipeline && e.run) byRun.set(e.run, e);
    return [...byRun.entries()];
  }, [status.evals, pipeline]);

  const [weights, setWeights] = useState(
    status.weights[status.weights.length - 1] ?? "",
  );
  const [conf, setConf] = useState("");
  const [pinOut, setPinOut] = useState<{
    tag: string;
    commands: string[];
  } | null>(null);

  const run = async (
    step: string,
    options: Record<string, unknown>,
    confirmText?: string,
  ): Promise<void> => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      await api.run(step, options);
      toast.success("Gestartet.");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pin = async (source: "export" | "installed"): Promise<void> => {
    if (
      !confirm(
        `Release-Modell auf das ${source === "export" ? "zuletzt exportierte" : "installierte"} Modell setzen? Das ändert desktop-app/src/shared/model-release.json.`,
      )
    )
      return;
    try {
      setPinOut(await api.pinRelease(source));
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const suggestion = (() => {
    const e = latest.find(([r]) => r === weights)?.[1];
    if (!e || pipeline !== "app-inferWindow") return null;
    // Smallest |bias| in the flat optimum: thresholds within ¾ vehicle of the best MAE
    // (docs/detection-benchmark.md, "Model default threshold"; gives 0.45 for the shipped model).
    const best = Math.min(...e.thresholds.map((t) => t.mae));
    return e.thresholds
      .filter((t) => t.mae <= best + 0.75)
      .reduce((a, t) => (Math.abs(t.bias) < Math.abs(a.bias) ? t : a));
  })();

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="grid gap-4 md:grid-cols-3">
        <ModelCard
          title="In der App installiert"
          files={status.models.installed}
          release={status.models.release.onnxSha256}
          extra={
            status.models.backups.length
              ? `${status.models.backups.length} Sicherung(en)`
              : undefined
          }
        />
        <ModelCard
          title="Letzter Export"
          files={status.models.export}
          release={status.models.release.onnxSha256}
          extra={
            status.models.export?.weights
              ? `aus ${status.models.export.weights}`
              : undefined
          }
        />
        <Card>
          <CardHeader>
            <CardDescription>Im Release ausgeliefert</CardDescription>
            <CardTitle className="font-mono text-sm">
              {status.models.release.tag ?? "–"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-1 text-xs">
            <div className="font-mono">
              {status.models.release.onnxSha256?.slice(0, 12) ?? "–"}
            </div>
            <div>{status.models.release.file}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Zählfehler je Konfidenzschwelle</CardTitle>
            <CardDescription>
              Mittlere Abweichung der Fahrzeugzahl je Standort (MAE), 11
              Validierungsstandorte. Unterschiede unter etwa einem Fahrzeug sind
              Rauschen.
            </CardDescription>
          </div>
          <Tabs
            value={pipeline}
            onValueChange={(v) => setPipeline(v as Evaluation["pipeline"])}
          >
            <TabsList>
              <TabsTrigger value="app-inferWindow">App-Pipeline</TabsTrigger>
              <TabsTrigger value="ultralytics">Ultralytics</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-4">
          <RunLines
            xLabel="Schwelle"
            xFormat={(x) => fmt(x, 2)}
            yFormat={(y) => fmt(y, 1)}
            series={latest.map(([r, e]) => ({
              key: r.replace(/[^a-z0-9]/gi, "_"),
              label: r,
              color: runColor(r, names),
              points: e.thresholds.map(
                (t) => [t.conf, t.mae] as [number, number],
              ),
            }))}
          />
          {latest.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lauf</TableHead>
                  <TableHead className="text-right">beste Schwelle</TableHead>
                  <TableHead className="text-right">MAE</TableHead>
                  <TableHead className="text-right">Bias</TableHead>
                  <TableHead className="text-right">≤ 10 %</TableHead>
                  <TableHead className="text-right">mAP50</TableHead>
                  <TableHead>gemessen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latest.map(([r, e]) => {
                  const b = e.thresholds.reduce((a, t) =>
                    t.mae < a.mae ? t : a,
                  );
                  return (
                    <TableRow key={r}>
                      <TableCell>
                        <Swatch color={runColor(r, names)} />
                        {r}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(b.conf, 2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(b.mae, 1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(b.bias)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(b.within10 * 100)} %
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {e.map50 != null ? fmt(e.map50, 3) : "–"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.date?.slice(0, 10)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Button
              variant="outline"
              disabled={busy || !weights}
              onClick={() => void run("evaluate", { weights })}
            >
              {weights} messen (Ultralytics)
            </Button>
            <Button
              variant="outline"
              disabled={busy || !weights}
              onClick={() => void run("errors", { weights, conf: 0.45 })}
            >
              Fehleranalyse
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="size-4" /> In die App bringen
          </CardTitle>
          <CardDescription>
            Exportiert nach ONNX mit Manifest. Beim Installieren wird das
            bisherige Modell gesichert; danach die App neu starten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ex-run">Lauf</Label>
              <Select value={weights} onValueChange={setWeights}>
                <SelectTrigger id="ex-run" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {status.weights.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-conf">Standard-Schwelle</Label>
              <Input
                id="ex-conf"
                className="w-28"
                type="number"
                step={0.05}
                min={0.05}
                max={0.95}
                placeholder={
                  suggestion ? fmt(suggestion.conf, 2) : "z. B. 0,45"
                }
                value={conf}
                onChange={(e) => setConf(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={busy || !weights}
              onClick={() =>
                void run("export", {
                  weights,
                  defaultConf: conf === "" ? null : Number(conf),
                  install: false,
                })
              }
            >
              <Download /> Exportieren
            </Button>
            <Button
              disabled={busy || !weights}
              onClick={() =>
                void run(
                  "export",
                  {
                    weights,
                    defaultConf: conf === "" ? null : Number(conf),
                    install: true,
                  },
                  `${weights} exportieren und das Modell in der App ersetzen? Das bisherige wird gesichert.`,
                )
              }
            >
              Exportieren &amp; installieren
            </Button>
          </div>
          {suggestion && (
            <p className="text-muted-foreground text-xs">
              Vorschlag für {weights}: Schwelle {fmt(suggestion.conf, 2)}{" "}
              (kleinster Bias im flachen Optimum: MAE {fmt(suggestion.mae, 1)},
              Bias {pct(suggestion.bias)}).{" "}
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => setConf(String(suggestion.conf))}
              >
                übernehmen
              </button>
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="outline"
              disabled={!status.models.export}
              onClick={() => void pin("export")}
            >
              Release-Modell = letzter Export
            </Button>
            <Button
              variant="outline"
              disabled={!status.models.installed}
              onClick={() => void pin("installed")}
            >
              Release-Modell = installiertes Modell
            </Button>
          </div>
          {pinOut && (
            <div className="space-y-2">
              <p className="text-sm">
                Pin gesetzt auf <b className="font-mono">{pinOut.tag}</b>.
                Release anlegen und Pin committen (im Repository):
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
                    aria-label="Kopieren"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(c)
                        .then(() => toast("Kopiert."))
                    }
                  >
                    <Copy />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModelCard({
  title,
  files,
  release,
  extra,
}: {
  title: string;
  files: ModelFiles | null;
  release: string | null;
  extra?: string;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-base">
          {files?.version ?? "–"}
          {files &&
            release &&
            (files.sha256 === release ? (
              <Badge variant="secondary">= Release</Badge>
            ) : (
              <Badge variant="outline">anders als Release</Badge>
            ))}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-1 text-xs">
        {files ? (
          <>
            <div>
              Schwelle{" "}
              {files.defaultConfidence != null
                ? fmt(files.defaultConfidence, 2)
                : "Standard"}
            </div>
            <div className="font-mono">{files.sha256.slice(0, 12)}</div>
            <div className="truncate">{files.trainingData.join(", ")}</div>
            {extra && <div>{extra}</div>}
          </>
        ) : (
          <div>keins</div>
        )}
      </CardContent>
    </Card>
  );
}
