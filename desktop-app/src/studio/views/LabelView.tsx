import { BrainCircuit, CircleCheck, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs";
import { cn } from "@renderer/lib/utils";
import { api, fmt, type LabelMode, type Queue, type Status } from "@studio/api";
import { RoundDialog } from "@studio/components/RoundDialog";
import { TileEditor } from "@studio/editor/TileEditor";

export function LabelView({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
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
          const first = q.sites.flatMap((s) => s.tiles).find((t) => !t.done);
          setStem(first?.stem ?? q.sites[0]?.tiles[0]?.stem ?? null);
        }
      } catch (e) {
        toast.error((e as Error).message);
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
    () => queue?.sites.flatMap((s) => s.tiles.map((t) => t.stem)) ?? [],
    [queue],
  );
  const index = stem ? order.indexOf(stem) : -1;

  const onSaved = useCallback(
    (saved: string, done: boolean) => {
      setQueue(
        (q) =>
          q && {
            ...q,
            sites: q.sites.map((s) => {
              const tiles = s.tiles.map((t) =>
                t.stem === saved
                  ? {
                      ...t,
                      done: t.done || done,
                      questions: done ? 0 : t.questions,
                    }
                  : t,
              );
              return {
                ...s,
                tiles,
                done: tiles.filter((t) => t.done).length,
                questions: tiles.reduce(
                  (a, t) => a + (t.done ? 0 : t.questions),
                  0,
                ),
              };
            }),
          },
      );
      if (done) reload();
    },
    [reload],
  );

  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (index < 0) return;
      // Forward jumps to the next tile that is not finished yet.
      if (dir === 1 && queue) {
        const tiles = queue.sites.flatMap((s) => s.tiles);
        const next =
          tiles.slice(index + 1).find((t) => !t.done) ?? tiles[index + 1];
        if (next) setStem(next.stem);
        return;
      }
      const prev = order[index - 1];
      if (prev) setStem(prev);
    },
    [index, order, queue],
  );

  // Progress since the last round: only complete sites enter the training set.
  const last = status.rounds[status.rounds.length - 1];
  const newTiles = status.sites.checkedTiles - (last?.checkedTiles ?? 0);
  const newSites = status.sites.finished - (last?.finishedSites ?? 0);
  const roundRunning =
    status.job?.status === "running" && status.job.step === "round";
  const total = order.length;
  const doneCount = queue?.sites.reduce((a, s) => a + s.done, 0) ?? 0;
  const openQuestions = queue?.sites.reduce((a, s) => a + s.questions, 0) ?? 0;

  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)]">
      <aside className="bg-sidebar flex min-h-0 flex-col border-r">
        <div className="space-y-3 border-b p-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as LabelMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="label">Offene Standorte</TabsTrigger>
              <TabsTrigger value="audit">Audit</TabsTrigger>
            </TabsList>
          </Tabs>
          <div>
            <div className="flex justify-between text-xs">
              <span>
                {fmt(doneCount)} / {fmt(total)} Kacheln
              </span>
              <span className="text-muted-foreground">
                {fmt(openQuestions)} offene Fragen
              </span>
            </div>
            <Progress
              value={total ? (doneCount / total) * 100 : 0}
              className="mt-1.5 h-1.5"
            />
          </div>
          <div className="bg-card rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BrainCircuit className="size-4" /> Trainingsrunde
            </div>
            {roundRunning ? (
              <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                <LoaderCircle className="size-3.5 animate-spin" />
                {status.job!.stages[status.job!.stage]?.name ?? "läuft"} (
                {status.job!.stage + 1}/{status.job!.stages.length}). Du kannst
                weiter labeln.
              </p>
            ) : (
              <p className="text-muted-foreground mt-1.5 text-xs">
                Seit{" "}
                {last
                  ? `Runde ${last.run.replace("round-", "")}`
                  : "dem letzten Training"}
                :{" "}
                <b className="text-foreground">{fmt(Math.max(0, newTiles))}</b>{" "}
                Kacheln,{" "}
                <b className="text-foreground">{fmt(Math.max(0, newSites))}</b>{" "}
                Standorte komplett. Ins Training gehen nur komplette Standorte.
              </p>
            )}
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={roundRunning || status.job?.status === "running"}
              onClick={() => setRoundOpen(true)}
            >
              Speichern &amp; neu trainieren
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {queue?.sites.map((s) => {
              const complete = s.done === s.tiles.length;
              const active = s.tiles.some((t) => t.stem === stem);
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
                      <CircleCheck className="size-3.5 text-[var(--box-car)]" />
                    ) : (
                      <span className="text-muted-foreground tabular-nums">
                        {s.questions} ?
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-9 gap-1">
                    {s.tiles.map((t, k) => (
                      <button
                        key={t.stem}
                        type="button"
                        title={`${t.stem}${t.done ? " · fertig" : ` · ${t.questions} Fragen`}`}
                        aria-label={`Kachel ${k + 1} von ${s.site}${t.done ? ", fertig" : ""}`}
                        onClick={() => setStem(t.stem)}
                        className={cn(
                          "h-4 rounded-[3px] border transition-colors",
                          t.done
                            ? "border-transparent bg-[var(--box-car)]/70"
                            : t.questions
                              ? "border-[var(--box-open)]/60 bg-[var(--box-open)]/15"
                              : "bg-muted border-transparent",
                          t.stem === stem &&
                            "ring-foreground ring-2 ring-offset-1 ring-offset-transparent",
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {queue && !queue.sites.length && (
              <p className="text-muted-foreground p-3 text-sm">
                Keine Kacheln. Zuerst unter „Übersicht“ Vorschläge berechnen.
              </p>
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
            position={`Kachel ${index + 1} von ${total}`}
            locked={locked}
            hasPrev={index > 0}
            hasNext={index >= 0 && index < total - 1}
            onNavigate={navigate}
            onSaved={onSaved}
          />
        ) : (
          <div className="text-muted-foreground grid h-full place-items-center text-sm">
            {queue ? (
              "Keine Kachel ausgewählt."
            ) : (
              <LoaderCircle className="size-5 animate-spin" />
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
