import { BrainCircuit, ChevronRight, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { runColor, type Round, type Run, type Status } from "@studio/api";
import { RunLines } from "@studio/components/LineChartCard";
import { stageName, startStep } from "@studio/lib";
import { dateTime, fmt, parseWhole, pct, TRAIN_EPOCHS } from "@studio/numbers";

const RUN_STATE: Record<
  Run["state"],
  "default" | "secondary" | "warning" | "outline"
> = {
  running: "default",
  finished: "secondary",
  interrupted: "warning",
  empty: "outline",
};

/** What happened to a round's job; the run's own state only once it finished. */
const ROUND_STATE: Record<
  Exclude<Round["state"], "done">,
  "default" | "secondary" | "warning" | "outline" | "destructive"
> = {
  running: "default",
  failed: "destructive",
  stopped: "warning",
  lost: "warning",
  unknown: "outline",
};

/** Same rule as studio.py RUN_NAME. */
const RUN_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function TrainingView({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const busy = status.job?.status === "running";
  const names = status.runs.map((r) => r.name);
  const ds = status.dataset;

  const run = (
    step: string,
    options: Record<string, unknown> = {},
  ): Promise<void> => startStep(step, options, reload);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("app.nav.training")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("training.subtitle")}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle
            role="heading"
            aria-level={2}
            className="flex items-center gap-2"
          >
            <BrainCircuit className="size-4" /> {t("training.roundsTitle")}
          </CardTitle>
          <CardDescription>{t("training.roundsText")}</CardDescription>
        </CardHeader>
        <CardContent>
          {status.rounds.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("training.colRound")}</TableHead>
                  <TableHead>{t("training.colStarted")}</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t("training.colBase")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("training.colSites")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("training.colEpochs")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("training.colMap50")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("training.colMae")}
                  </TableHead>
                  <TableHead className="hidden text-right lg:table-cell">
                    {t("training.colBias")}
                  </TableHead>
                  <TableHead>{t("training.colState")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...status.rounds].reverse().map((r) => {
                  const runInfo = status.runs.find((x) => x.name === r.run);
                  const failedAt =
                    r.state !== "running" &&
                    stageName(r.failedStageKey, r.failedStage);
                  return (
                    <TableRow key={r.run}>
                      <TableCell className="font-medium whitespace-nowrap">
                        <Swatch color={runColor(r.run, names)} /> {r.run}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {dateTime(r.started, "short")}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs whitespace-nowrap lg:table-cell">
                        {r.base}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(r.finishedSites)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {runInfo
                          ? t("training.epochsOf", {
                              done: runInfo.lastEpoch,
                              total: r.epochs,
                            })
                          : r.epochs}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {runInfo?.best ? fmt(runInfo.best.map50, 3) : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.appBest
                          ? t("training.maeAt", {
                              mae: fmt(r.appBest.mae, 1),
                              conf: fmt(r.appBest.conf, 2),
                            })
                          : "–"}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {r.appBest ? pct(r.appBest.bias) : "–"}
                      </TableCell>
                      <TableCell>
                        {r.state !== "done" ? (
                          <Badge
                            variant={ROUND_STATE[r.state]}
                            className="h-auto text-left whitespace-normal"
                          >
                            {failedAt
                              ? t("training.roundStateAt", {
                                  state: t(`training.roundState.${r.state}`),
                                  stage: failedAt,
                                })
                              : t(`training.roundState.${r.state}`)}
                          </Badge>
                        ) : runInfo ? (
                          <Badge variant={RUN_STATE[runInfo.state]}>
                            {t(`training.runState.${runInfo.state}`)}
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            {t("training.noModel")}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {t("training.roundsEmpty")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {t("training.chartTitle")}
            </CardTitle>
            <CardDescription>{t("training.chartText")}</CardDescription>
          </CardHeader>
          <CardContent>
            <RunLines
              xLabel={t("training.epoch")}
              valueFormat={(y) => fmt(y, 3)}
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
            <CardTitle role="heading" aria-level={2}>
              {t("training.datasetTitle")}
            </CardTitle>
            <CardDescription>
              {ds.built
                ? t("training.built", { date: dateTime(ds.built) })
                : t("training.neverBuilt")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row
              label={t("training.trainVal")}
              value={`${fmt(ds.trainSites)} / ${fmt(ds.valSites)}`}
            />
            <Row label={t("training.trainTiles")} value={fmt(ds.trainTiles)} />
            <Row
              label={t("training.pseudoSites")}
              value={fmt(ds.pseudoSites)}
            />
            <Row label={t("training.degraded")} value={fmt(ds.degraded)} />
            <p className="text-muted-foreground pt-2 text-xs">
              {t("training.valFixed")}
            </p>
          </CardContent>
        </Card>
      </div>

      <ManualTraining status={status} busy={busy} run={run} reload={reload} />
    </div>
  );
}

function ManualTraining({
  status,
  busy,
  run,
  reload,
}: {
  status: Status;
  busy: boolean;
  run: (step: string, o?: Record<string, unknown>) => Promise<void>;
  reload: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(
    `dealer-obb-${new Date().toISOString().slice(5, 10).replace("-", "")}`,
  );
  const [model, setModel] = useState(status.baseModels[0] ?? "");
  const [epochsText, setEpochsText] = useState("60");
  const epochs = parseWhole(epochsText, TRAIN_EPOCHS.min, TRAIN_EPOCHS.max);
  const nameOk = RUN_NAME.test(name);
  const noBase = !status.baseModels.length;
  const fewSites = status.finishedSites < status.minRoundSites;
  const noDataset = !status.dataset.built;
  // Start weights downloaded meanwhile: select them.
  useEffect(() => {
    if (!model && status.baseModels[0]) setModel(status.baseModels[0]);
  }, [model, status.baseModels]);
  const [pseudo, setPseudo] = useState(false);
  const resumable = status.runs.filter(
    (r) => r.state === "interrupted" && r.hasLast,
  );
  return (
    <details className="group bg-card rounded-xl border">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90" />
        <span className="min-w-0">
          <span
            className="block text-sm font-medium"
            role="heading"
            aria-level={2}
          >
            {t("training.manualSummary")}
          </span>
          <span className="text-muted-foreground block text-xs">
            {t("training.manualHint")}
          </span>
        </span>
      </summary>
      <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
        <div className="space-y-1.5">
          <Label htmlFor="mt-name">{t("training.name")}</Label>
          <Input
            id="mt-name"
            className="w-44"
            value={name}
            aria-invalid={!nameOk}
            title={t("training.nameHint")}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mt-model">{t("training.start")}</Label>
          <Select value={model} onValueChange={setModel} disabled={noBase}>
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
          <Label htmlFor="mt-epochs">{t("training.epochs")}</Label>
          <Input
            id="mt-epochs"
            type="number"
            inputMode="numeric"
            min={TRAIN_EPOCHS.min}
            max={TRAIN_EPOCHS.max}
            className="w-24"
            value={epochsText}
            aria-invalid={epochs == null}
            title={t("training.epochsRange", TRAIN_EPOCHS)}
            onChange={(e) => setEpochsText(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="mt-pseudo" checked={pseudo} onCheckedChange={setPseudo} />
          <Label htmlFor="mt-pseudo" className="font-normal">
            {t("training.pseudo")}
          </Label>
        </div>
        <Button
          variant="outline"
          disabled={busy || fewSites}
          title={
            fewSites
              ? t("training.needSites", {
                  min: status.minRoundSites,
                  finished: status.finishedSites,
                })
              : undefined
          }
          onClick={() => void run("dataset", { pseudo })}
        >
          {t("training.datasetOnly")}
        </Button>
        <Button
          disabled={busy || !model || epochs == null || noDataset || !nameOk}
          title={noDataset ? t("training.needDataset") : undefined}
          onClick={() => void run("train", { name, model, epochs })}
        >
          {t("training.train")}
        </Button>
        {!nameOk && (
          <p className="text-destructive w-full text-xs">
            {t("training.nameHint")}
          </p>
        )}
        {noBase && (
          <div className="text-muted-foreground flex w-full flex-wrap items-center gap-2 text-xs">
            {t("training.noBase")}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void startStep(
                  "base-weights",
                  { model: status.defaultBase },
                  reload,
                  {
                    title: t("training.baseConfirmTitle"),
                    text: t("training.baseConfirmText", {
                      model: status.defaultBase,
                    }),
                    confirm: t("training.baseConfirm"),
                  },
                )
              }
            >
              {t("training.loadBase", { model: status.defaultBase })}
            </Button>
          </div>
        )}
        {!noBase && epochs == null && (
          <p className="text-destructive w-full text-xs">
            {t("training.epochsInvalid", TRAIN_EPOCHS)}
          </p>
        )}
        {fewSites && (
          <p className="text-muted-foreground w-full text-xs">
            {t("training.fewSites", {
              min: status.minRoundSites,
              finished: status.finishedSites,
            })}
          </p>
        )}
        {noDataset && !fewSites && (
          <p className="text-muted-foreground w-full text-xs">
            {t("training.noDataset")}
          </p>
        )}
        {resumable.map((r) => (
          <Button
            key={r.name}
            variant="outline"
            disabled={busy}
            onClick={() => void run("train", { name: r.name, resume: true })}
          >
            <RotateCw /> {t("training.resume", { run: r.name })}
          </Button>
        ))}
      </div>
    </details>
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
