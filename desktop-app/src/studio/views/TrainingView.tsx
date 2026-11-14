import { BrainCircuit, Play, RotateCw } from "lucide-react";
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
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { api, fmt, pct, runColor, type Run, type Status } from "@studio/api";
import { RunLines } from "@studio/components/LineChartCard";
import { RoundDialog } from "@studio/components/RoundDialog";

const RUN_STATE: Record<
  Run["state"],
  { label: string; variant: "default" | "secondary" | "warning" | "outline" }
> = {
  running: { label: "läuft", variant: "default" },
  finished: { label: "fertig", variant: "secondary" },
  interrupted: { label: "abgebrochen", variant: "warning" },
  empty: { label: "leer", variant: "outline" },
};

export function TrainingView({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
  const [roundOpen, setRoundOpen] = useState(false);
  const busy = status.job?.status === "running";
  const names = status.runs.map((r) => r.name);
  const ds = status.dataset;

  const run = async (
    step: string,
    options: Record<string, unknown> = {},
  ): Promise<void> => {
    try {
      await api.run(step, options);
      toast.success("Gestartet.");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="size-4" /> Trainingsrunden
            </CardTitle>
            <CardDescription>
              Jede Runde: Datensatz → Feintuning ab der letzten Runde → Messung
              → neue Vorschläge. Nichts wird automatisch installiert.
            </CardDescription>
          </div>
          <Button disabled={busy} onClick={() => setRoundOpen(true)}>
            <Play /> Neue Runde
          </Button>
        </CardHeader>
        <CardContent>
          {status.rounds.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runde</TableHead>
                  <TableHead>Gestartet</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Standorte</TableHead>
                  <TableHead className="text-right">Epochen</TableHead>
                  <TableHead className="text-right">mAP50</TableHead>
                  <TableHead className="text-right">MAE (App)</TableHead>
                  <TableHead className="text-right">Bias</TableHead>
                  <TableHead>Stand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...status.rounds].reverse().map((r) => {
                  const runInfo = status.runs.find((x) => x.name === r.run);
                  return (
                    <TableRow key={r.run}>
                      <TableCell className="font-medium">
                        <Swatch color={runColor(r.run, names)} /> {r.run}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.started.replace("T", " ").slice(0, 16)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.base}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(r.finishedSites)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {runInfo
                          ? `${runInfo.lastEpoch} / ${r.epochs}`
                          : r.epochs}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {runInfo?.best ? fmt(runInfo.best.map50, 3) : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.appBest
                          ? `${fmt(r.appBest.mae, 1)} @ ${fmt(r.appBest.conf, 2)}`
                          : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.appBest ? pct(r.appBest.bias) : "–"}
                      </TableCell>
                      <TableCell>
                        {runInfo ? (
                          <Badge variant={RUN_STATE[runInfo.state].variant}>
                            {RUN_STATE[runInfo.state].label}
                          </Badge>
                        ) : (
                          <Badge variant="outline">wartet</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">
              Noch keine Runde. Label einen Schwung Kacheln und starte dann
              „Speichern &amp; neu trainieren“.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>mAP50 je Epoche</CardTitle>
            <CardDescription>
              Erkennungsgüte auf den Validierungsstandorten während des
              Trainings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RunLines
              xLabel="Epoche"
              yFormat={(y) => fmt(y, 2)}
              series={status.runs
                .filter((r) => r.curve.length)
                .map((r) => ({
                  key: r.name.replace(/[^a-z0-9]/gi, "_"),
                  label: r.name,
                  color: runColor(r.name, names),
                  points: r.curve,
                }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Datensatz</CardTitle>
            <CardDescription>
              Gebaut {ds.built?.replace("T", " ") ?? "noch nie"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row
              label="Standorte Train / Val"
              value={`${fmt(ds.trainSites)} / ${fmt(ds.valSites)}`}
            />
            <Row label="Train-Kacheln" value={fmt(ds.trainTiles)} />
            <Row label="davon Pseudo-Standorte" value={fmt(ds.pseudoSites)} />
            <Row label="weichgezeichnete Kopien" value={fmt(ds.degraded)} />
            <p className="text-muted-foreground pt-2 text-xs">
              Die Validierungsstandorte bleiben fest, damit alle Runden
              vergleichbar sind.
            </p>
          </CardContent>
        </Card>
      </div>

      <ManualTraining status={status} busy={busy} run={run} />
      <RoundDialog
        open={roundOpen}
        onOpenChange={setRoundOpen}
        status={status}
        onStarted={reload}
      />
    </div>
  );
}

function ManualTraining({
  status,
  busy,
  run,
}: {
  status: Status;
  busy: boolean;
  run: (step: string, o?: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState(
    `dealer-obb-${new Date().toISOString().slice(5, 10).replace("-", "")}`,
  );
  const [model, setModel] = useState(status.baseModels[0] ?? "");
  const [epochs, setEpochs] = useState(60);
  const [pseudo, setPseudo] = useState(false);
  const resumable = status.runs.filter(
    (r) => r.state === "interrupted" && r.hasLast,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Von Grund auf</CardTitle>
        <CardDescription>
          Volles Training ab den DOTA-Gewichten (1–2 Stunden) oder einen
          abgebrochenen Lauf fortsetzen.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mt-name">Name</Label>
          <Input
            id="mt-name"
            className="w-44"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mt-model">Start</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger id="mt-model" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {status.baseModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mt-epochs">Epochen</Label>
          <Input
            id="mt-epochs"
            type="number"
            className="w-24"
            value={epochs}
            onChange={(e) => setEpochs(Number(e.target.value))}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="mt-pseudo" checked={pseudo} onCheckedChange={setPseudo} />
          <Label htmlFor="mt-pseudo" className="font-normal">
            Pseudo-Labels
          </Label>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            await run("dataset", { pseudo });
          }}
        >
          Nur Datensatz bauen
        </Button>
        <Button
          disabled={busy || !model}
          onClick={() => void run("train", { name, model, epochs })}
        >
          Training starten
        </Button>
        {resumable.map((r) => (
          <Button
            key={r.name}
            variant="outline"
            disabled={busy}
            onClick={() => void run("train", { name: r.name, resume: true })}
          >
            <RotateCw /> {r.name} fortsetzen
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function Swatch({ color }: { color: string }): React.JSX.Element {
  return (
    <span
      className="mr-1.5 inline-block size-2.5 rounded-[3px] align-middle"
      style={{ background: color }}
    />
  );
}
