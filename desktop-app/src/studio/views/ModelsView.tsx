import { Copy, Rocket } from "lucide-react";
import { useState } from "react";
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
import { api, fmt, pct, runColor, type Status } from "@studio/api";
import { RunLines } from "@studio/components/LineChartCard";
import {
  appEvaluation,
  startStep,
  suggestedThreshold,
  ultralyticsEvaluation,
} from "@studio/lib";
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
  const names = status.runs.map((r) => r.name);
  const busy = status.job?.status === "running";
  const installed = status.models.installed;
  const release = status.models.release;
  const shipped = Boolean(installed && installed.sha256 === release.onnxSha256);
  const [pinOut, setPinOut] = useState<{
    tag: string;
    commands: string[];
  } | null>(null);

  const rows = status.weights.map((run) => {
    const app = appEvaluation(status, run);
    return {
      run,
      app,
      suggested: app ? suggestedThreshold(app) : null,
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
      `${run} mit Standard-Schwelle ${fmt(conf, 2)} in der App installieren? Das bisherige Modell wird gesichert; danach die App neu starten.`,
    );

  const ship = async (): Promise<void> => {
    if (
      !confirm(
        "Das installierte Modell mit der nächsten App-Version ausliefern? Das ändert desktop-app/src/shared/model-release.json.",
      )
    )
      return;
    try {
      setPinOut(await api.pinRelease("installed"));
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Zählfehler je Konfidenzschwelle</CardTitle>
          <CardDescription>
            Mittlere Abweichung der Fahrzeugzahl je Standort (MAE) mit der
            Erkennung der App, 11 Validierungsstandorte. Unterschiede unter etwa
            einem Fahrzeug sind Rauschen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunLines
            xLabel="Schwelle"
            xFormat={(x) => fmt(x, 2)}
            yFormat={(y) => fmt(y, 1)}
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
          <CardTitle>Modelle</CardTitle>
          <CardDescription>
            „Installieren“ exportiert das Modell mit der vorgeschlagenen
            Schwelle (kleinster Bias im flachen Optimum) und sichert das
            bisherige.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lauf</TableHead>
                <TableHead className="text-right">Schwelle</TableHead>
                <TableHead className="text-right">MAE</TableHead>
                <TableHead className="text-right">Bias</TableHead>
                <TableHead className="text-right">≤ 10 %</TableHead>
                <TableHead className="text-right">mAP50</TableHead>
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
                        installiert
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.suggested ? fmt(r.suggested.conf, 2) : "–"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.suggested ? fmt(r.suggested.mae, 1) : "–"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.suggested ? pct(r.suggested.bias) : "–"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.suggested ? `${fmt(r.suggested.within10 * 100)} %` : "–"}
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
                        Messen
                      </Button>
                    ) : r.installed ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => install(r.run, r.suggested!.conf)}
                      >
                        Installieren
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-3 text-xs">
            Alle Werte gelten bei der vorgeschlagenen Schwelle, die beim
            Installieren ins Manifest geht. Trainingsrunden werden automatisch
            gemessen.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="size-4" /> Mit der App ausliefern
            </CardTitle>
            <CardDescription>
              Installiert:{" "}
              <b className="text-foreground">{installed?.version ?? "–"}</b> ·
              Ausgeliefert:{" "}
              <b className="text-foreground font-mono">{release.tag ?? "–"}</b>
            </CardDescription>
          </div>
          {shipped ? (
            <Badge variant="secondary">identisch</Badge>
          ) : (
            <Button
              disabled={!installed?.manifestMatches}
              onClick={() => void ship()}
            >
              Installiertes Modell ausliefern
            </Button>
          )}
        </CardHeader>
        {pinOut && (
          <CardContent className="space-y-2">
            <p className="text-sm">
              Ausgeliefert wird jetzt <b className="font-mono">{pinOut.tag}</b>.
              Noch den Modell-Release anlegen und die Änderung committen:
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
          </CardContent>
        )}
      </Card>
    </div>
  );
}
