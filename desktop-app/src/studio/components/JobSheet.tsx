import { CircleCheck, CircleX, LoaderCircle, Square } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@renderer/components/ui/sheet";
import { cn } from "@renderer/lib/utils";
import { api, type Job } from "@studio/api";
import { askConfirm } from "@studio/components/ConfirmDialog";
import { jobTitle, showError, stageName } from "@studio/lib";
import { dateTime, sameDay } from "@studio/numbers";

export function JobSheet({
  job,
  onChanged,
}: {
  job: Job | null;
  onChanged: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  // The log follows new output: it opens at the end and stays there until you
  // scroll up; a new job starts at the end again.
  const logRef = useRef<HTMLPreElement | null>(null);
  const follow = useRef(true);
  const setLog = useCallback((el: HTMLPreElement | null) => {
    logRef.current = el;
    if (el) {
      follow.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, []);
  useEffect(() => {
    follow.current = true;
  }, [job?.id]);
  useEffect(() => {
    const el = logRef.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [job?.log]);

  const stop = async (): Promise<void> => {
    const ok = await askConfirm({
      title: t("jobs.stopTitle"),
      text: t("jobs.stopText"),
      confirm: t("jobs.stopConfirm"),
      cancel: t("jobs.stopKeep"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.stop();
      toast(t("jobs.stopped"));
      onChanged();
    } catch (e) {
      showError(e);
    }
  };

  const state = job ? t(`jobs.state.${job.status}`) : null;
  const title = job ? jobTitle(job) : t("jobs.log");
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title={job?.status === "running" ? title : undefined}
          className={cn(
            "max-w-[200px] lg:max-w-[320px]",
            job?.status !== "running" && "text-muted-foreground",
          )}
        >
          {job?.status === "running" ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              {/* Below 1024 px only the step count; the title is in the tooltip and the sheet. */}
              <span className="hidden truncate lg:inline" title={title}>
                {title}
              </span>
              {job.stages.length > 1 && (
                <span
                  className="text-muted-foreground tabular-nums"
                  title={t("jobs.stageOf", {
                    n: job.stage + 1,
                    total: job.stages.length,
                  })}
                >
                  {job.stage + 1}/{job.stages.length}
                </span>
              )}
            </>
          ) : (
            <>
              {state && job?.status !== "done" && (
                <span className="bg-destructive size-1.5 rounded-full" />
              )}
              {t("jobs.log")}
            </>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6">{title}</SheetTitle>
          <SheetDescription>
            {!job
              ? t("jobs.none")
              : job.ended
                ? t("jobs.startedEnded", {
                    start: dateTime(job.started),
                    end: dateTime(
                      job.ended,
                      sameDay(job.started, job.ended) ? "time" : "medium",
                    ),
                  })
                : t("jobs.startedAt", { start: dateTime(job.started) })}
          </SheetDescription>
        </SheetHeader>
        {job && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
            <ol className="space-y-1.5">
              {job.stages.map((s, i) => {
                const done = i < job.stage || job.status === "done";
                const current = i === job.stage && job.status !== "done";
                const failed =
                  current &&
                  (job.status === "failed" ||
                    job.status === "stopped" ||
                    job.status === "lost");
                return (
                  <li
                    key={i}
                    className={cn(
                      "flex items-center gap-2 text-sm",
                      !done && !current && "text-muted-foreground",
                    )}
                  >
                    {failed ? (
                      <CircleX className="text-destructive size-4" />
                    ) : done ? (
                      <CircleCheck className="size-4 text-[var(--box-car)]" />
                    ) : current ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <span className="border-muted-foreground/50 size-4 rounded-full border" />
                    )}
                    {stageName(s.key, s.name)}
                  </li>
                );
              })}
            </ol>
            {state && job.status !== "running" && (
              <p className="text-sm">
                <Trans
                  i18nKey="jobs.outcome"
                  values={{ state }}
                  components={{ b: <b /> }}
                />
              </p>
            )}
            {job.error && (
              <div
                role="alert"
                className="border-destructive/40 bg-destructive/10 rounded-md border p-3 text-sm"
              >
                {job.error.stage && (
                  <div className="font-medium">
                    {t(
                      job.status === "lost" ? "jobs.lostAt" : "jobs.failedAt",
                      {
                        stage: stageName(job.error.stageKey, job.error.stage),
                      },
                    )}
                  </div>
                )}
                <div className="mt-0.5 break-words">
                  {job.error.code === "job_lost"
                    ? t("server.job_lost")
                    : job.error.message || t("jobs.noMessage")}
                </div>
                {job.orphans && (
                  <div className="text-muted-foreground mt-1 text-xs">
                    {t("jobs.orphans")}
                  </div>
                )}
              </div>
            )}
            {job.status === "failed" ? (
              <details
                className="flex min-h-0 flex-1 flex-col"
                onToggle={(e) => {
                  const el = logRef.current;
                  if (e.currentTarget.open && el)
                    el.scrollTop = el.scrollHeight;
                }}
              >
                <summary className="text-muted-foreground cursor-pointer text-xs">
                  {t("jobs.fullLog")}
                </summary>
                <pre
                  ref={setLog}
                  className="bg-background mt-2 max-h-[60vh] overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
                >
                  {job.log.join("\n")}
                </pre>
              </details>
            ) : (
              <pre
                ref={setLog}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  follow.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                }}
                className="bg-background min-h-0 flex-1 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
              >
                {job.log.join("\n")}
              </pre>
            )}
            {(job.status === "running" || job.orphans) && (
              <Button variant="destructive" onClick={() => void stop()}>
                <Square /> {t("jobs.stop")}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
