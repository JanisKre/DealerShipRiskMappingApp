import { BrainCircuit, CircleCheck, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs";
import { cn } from "@renderer/lib/utils";
import {
  api,
  type LabelMode,
  type Queue,
  type SaveResult,
  type Status,
} from "@studio/api";
import { RoundDialog } from "@studio/components/RoundDialog";
import { SetupAction } from "@studio/components/SetupAction";
import { saveQueue, TileEditor } from "@studio/editor/TileEditor";
import { roundBlocked, setupStep, showError, stageName } from "@studio/lib";

export function LabelView({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<LabelMode>("label");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [stem, setStem] = useState<string | null>(null);
  const [roundOpen, setRoundOpen] = useState(false);

  const loadQueue = useCallback(
    async (m: LabelMode, pickFirst: boolean): Promise<void> => {
      try {
        const q = await api.queue(m);
        setQueue(q);
        if (pickFirst) {
          const first = q.sites.flatMap((s) => s.tiles).find((x) => !x.done);
          setStem(first?.stem ?? q.sites[0]?.tiles[0]?.stem ?? null);
        }
      } catch (e) {
        showError(e);
      }
    },
    [],
  );

  useEffect(() => {
    void loadQueue(mode, true);
  }, [mode, loadQueue]);

  // The lock (suggestions being rewritten) comes with the job status.
  const locked = Boolean(status.job?.status === "running" && status.job.locked);
  useEffect(() => {
    if (!locked) void loadQueue(mode, false);
  }, [locked, mode, loadQueue]);

  const order = useMemo(
    () => queue?.sites.flatMap((s) => s.tiles.map((x) => x.stem)) ?? [],
    [queue],
  );
  const index = stem ? order.indexOf(stem) : -1;

  // The sidebar shows what the server stored, not what the page assumes.
  const onSaved = useCallback(
    (saved: string, result: SaveResult) => {
      setQueue(
        (q) =>
          q && {
            ...q,
            sites: q.sites.map((s) => {
              const tiles = s.tiles.map((x) =>
                x.stem === saved
                  ? {
                      ...x,
                      done: result.done,
                      questions: result.questions,
                    }
                  : x,
              );
              return {
                ...s,
                tiles,
                done: tiles.filter((x) => x.done).length,
                questions: tiles.reduce(
                  (a, x) => a + (x.done ? 0 : x.questions),
                  0,
                ),
              };
            }),
          },
      );
      if (result.done) reload();
    },
    [reload],
  );

  // Drafts of tiles you already left are stored in the background; show them too.
  useEffect(
    () =>
      saveQueue.onSaved((r, result) => {
        if (r.mode === mode && r.stem !== stem) onSaved(r.stem, result);
      }),
    [mode, stem, onSaved],
  );

  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (index < 0) return;
      // Forward jumps to the next tile that is not finished yet.
      if (dir === 1 && queue) {
        const tiles = queue.sites.flatMap((s) => s.tiles);
        const next =
          tiles.slice(index + 1).find((x) => !x.done) ?? tiles[index + 1];
        if (next) setStem(next.stem);
        return;
      }
      const prev = order[index - 1];
      if (prev) setStem(prev);
    },
    [index, order, queue],
  );

  // Progress since the last round: only complete sites enter the training set.
  // Counted since the last round that finished; a failed round trained nothing.
  const last = [...status.rounds].reverse().find((r) => r.state === "done");
  const newTiles = status.sites.checkedTiles - (last?.checkedTiles ?? 0);
  const newSites = status.sites.finished - (last?.finishedSites ?? 0);
  const roundRunning =
    status.job?.status === "running" && status.job.step === "round";
  const total = order.length;
  const doneCount = queue?.sites.reduce((a, s) => a + s.done, 0) ?? 0;
  const openQuestions = queue?.sites.reduce((a, s) => a + s.questions, 0) ?? 0;
  const blocked = roundBlocked(status);
  const setup = setupStep(status);

  return (
    <div className="grid h-full min-h-0 grid-cols-[248px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <h1 className="sr-only">{t("app.nav.label")}</h1>
      <aside
        className="bg-sidebar flex min-h-0 flex-col border-r"
        aria-label={t("label.sites")}
      >
        <div className="space-y-3 border-b p-3">
          <Tabs
            value={mode}
            onValueChange={(v) => {
              // The old tile belongs to the other list: pick anew (no load with the wrong mode).
              setStem(null);
              setQueue(null);
              setMode(v as LabelMode);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                value="label"
                className="min-w-0 px-1.5 text-xs lg:text-sm"
                title={t("label.tabOpen")}
              >
                <span className="truncate">{t("label.tabOpen")}</span>
              </TabsTrigger>
              <TabsTrigger value="audit" className="px-1.5 text-xs lg:text-sm">
                {t("label.tabAudit")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div>
            <div className="flex flex-wrap justify-between gap-x-2 text-xs">
              <span>{t("label.progress", { done: doneCount, total })}</span>
              <span className="text-muted-foreground">
                {t("label.openQuestions", { count: openQuestions })}
              </span>
            </div>
            <Progress
              value={total ? (doneCount / total) * 100 : 0}
              className="mt-1.5 h-1.5"
            />
          </div>
          <div className="bg-card rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BrainCircuit className="size-4" /> {t("label.roundCard")}
            </div>
            {roundRunning ? (
              <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                {t("label.roundRunning", {
                  stage:
                    stageName(
                      status.job!.stages[status.job!.stage]?.key,
                      status.job!.stages[status.job!.stage]?.name,
                    ) || t("jobs.state.running"),
                  n: status.job!.stage + 1,
                  total: status.job!.stages.length,
                })}
              </p>
            ) : (
              <p className="text-muted-foreground mt-1.5 text-xs">
                <Trans
                  i18nKey={last ? "label.sinceRound" : "label.sinceStart"}
                  values={{
                    n: last?.run.replace("round-", ""),
                    tiles: Math.max(0, newTiles),
                    sites: Math.max(0, newSites),
                  }}
                  components={{ b: <b className="text-foreground" /> }}
                />
              </p>
            )}
            <Button
              size="sm"
              className="mt-2 h-auto min-h-8 w-full py-1.5 whitespace-normal"
              disabled={Boolean(blocked)}
              title={blocked ?? undefined}
              onClick={() => setRoundOpen(true)}
            >
              {t("label.roundButton")}
            </Button>
            {blocked && !roundRunning && (
              <p className="text-muted-foreground mt-1.5 text-xs">{blocked}</p>
            )}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {queue?.sites.map((s) => {
              const complete = s.done === s.tiles.length;
              const active = s.tiles.some((x) => x.stem === stem);
              return (
                <div
                  key={s.site}
                  className={cn(
                    "rounded-md border border-transparent p-2",
                    active && "border-border bg-accent/40",
                  )}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="px-1.5 font-mono">
                      {s.state}
                    </Badge>
                    <span className="truncate font-mono">
                      {s.site.replace(/^[A-Z]{2}-/, "")}
                    </span>
                    <span className="flex-1" />
                    {complete ? (
                      <CircleCheck
                        className="size-3.5 shrink-0 text-[var(--box-car)]"
                        aria-label={t("label.siteDone")}
                      />
                    ) : (
                      <span
                        className="text-muted-foreground tabular-nums"
                        title={t("label.siteQuestions", { count: s.questions })}
                      >
                        {s.questions} ?
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-9 gap-1">
                    {s.tiles.map((tile, k) => (
                      <button
                        key={tile.stem}
                        type="button"
                        title={
                          tile.done
                            ? t("label.tileTitleDone", { stem: tile.stem })
                            : t("label.tileTitle", {
                                stem: tile.stem,
                                count: tile.questions,
                              })
                        }
                        aria-label={t(
                          tile.done ? "label.tileAriaDone" : "label.tileAria",
                          { n: k + 1, site: s.site },
                        )}
                        aria-current={tile.stem === stem ? "true" : undefined}
                        onClick={() => setStem(tile.stem)}
                        className={cn(
                          "focus-visible:ring-ring h-4 rounded-[3px] border transition-colors outline-none focus-visible:ring-2",
                          tile.done
                            ? "border-transparent bg-[var(--box-car)]/70"
                            : tile.questions
                              ? "border-[var(--box-open)]/60 bg-[var(--box-open)]/15"
                              : "bg-muted border-transparent",
                          tile.stem === stem &&
                            "ring-foreground ring-2 ring-offset-1 ring-offset-transparent",
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {queue && !queue.sites.length && (
              <div className="text-muted-foreground space-y-2 p-3 text-sm">
                {mode === "audit" ? (
                  <p>{t("label.emptyAudit")}</p>
                ) : setup ? (
                  <p>{t("label.emptySetup", { step: setup.title })}</p>
                ) : (
                  <p>{t("label.emptyNone")}</p>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>
      <section className="min-h-0">
        {stem ? (
          <TileEditor
            key={`${mode}:${stem}`}
            mode={mode}
            stem={stem}
            position={t("label.position", { n: index + 1, total })}
            locked={locked}
            hasPrev={index > 0}
            hasNext={index >= 0 && index < total - 1}
            onNavigate={navigate}
            onSaved={onSaved}
          />
        ) : (
          <div className="text-muted-foreground grid h-full place-items-center p-6 text-sm">
            {!queue ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : setup && mode === "label" ? (
              // A fresh setup: the next step, as on the overview.
              <div className="bg-card max-w-md space-y-3 rounded-xl border p-5">
                <div className="text-xs font-medium tracking-wide uppercase">
                  {t("overview.kickerSetup")}
                </div>
                <h2 className="text-foreground text-lg font-semibold">
                  {setup.title}
                </h2>
                <p>{setup.text}</p>
                <SetupAction step={setup} status={status} onStarted={reload} />
              </div>
            ) : (
              t("label.noTile")
            )}
          </div>
        )}
      </section>
      <RoundDialog
        open={roundOpen}
        onOpenChange={setRoundOpen}
        status={status}
        onStarted={reload}
      />
    </div>
  );
}
