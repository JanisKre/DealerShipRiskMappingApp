import { CircleCheck, CircleX, LoaderCircle, Square } from "lucide-react";
import { useEffect, useRef } from "react";
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

export const JOB_STATE: Record<
  Job["status"],
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline" | "warning";
  }
> = {
  running: { label: "läuft", variant: "default" },
  done: { label: "fertig", variant: "secondary" },
  failed: { label: "fehlgeschlagen", variant: "destructive" },
  stopped: { label: "abgebrochen", variant: "warning" },
  lost: { label: "beendet", variant: "warning" },
};

export function JobSheet({
  job,
  onChanged,
}: {
  job: Job | null;
  onChanged: () => void;
}): React.JSX.Element {
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40)
      el.scrollTop = el.scrollHeight;
  }, [job?.log]);

  const stop = async (): Promise<void> => {
    if (
      !confirm(
        "Laufenden Schritt abbrechen? Ein Training lässt sich später fortsetzen.",
      )
    )
      return;
    try {
      await api.stop();
      toast("Abgebrochen.");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const state = job ? JOB_STATE[job.status] : null;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "max-w-[320px]",
            job?.status !== "running" && "text-muted-foreground",
          )}
        >
          {job?.status === "running" ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              <span className="truncate">{job.title}</span>
              {job.stages.length > 1 && (
                <span className="text-muted-foreground tabular-nums">
                  {job.stage + 1}/{job.stages.length}
                </span>
              )}
            </>
          ) : (
            <>
              {state && job?.status !== "done" && (
                <span className="bg-destructive size-1.5 rounded-full" />
              )}
              Protokoll
            </>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{job?.title ?? "Protokoll"}</SheetTitle>
          <SheetDescription>
            {job
              ? `Gestartet ${job.started.replace("T", " ")}${job.ended ? ` · beendet ${job.ended.slice(11)}` : ""}`
              : "Noch kein Schritt gestartet."}
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
                  (job.status === "failed" || job.status === "stopped");
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
                    {s.name}
                  </li>
                );
              })}
            </ol>
            <pre
              ref={logRef}
              className="bg-background min-h-0 flex-1 overflow-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
            >
              {job.log.join("\n")}
            </pre>
            {job.status === "running" && (
              <Button variant="destructive" onClick={() => void stop()}>
                <Square /> Abbrechen
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
