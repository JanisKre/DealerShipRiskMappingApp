import {
  BrainCircuit,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  PenTool,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@renderer/components/ui/sonner";
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs";
import { TooltipProvider } from "@renderer/components/ui/tooltip";
import { api, type Status } from "./api";
import { JOB_STATE, JobSheet } from "./components/JobSheet";
import { ToolsMenu } from "./components/ToolsMenu";
import { LabelView } from "./views/LabelView";
import { ModelsView } from "./views/ModelsView";
import { OverviewView } from "./views/OverviewView";
import { TrainingView } from "./views/TrainingView";

export type View = "overview" | "label" | "training" | "models";

const VIEW_KEY = "studio.view";

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "overview" || v === "label" || v === "training" || v === "models")
      return v;
  } catch {
    // storage unavailable: start on the overview
  }
  return "overview";
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  const [view, setView] = useState<View>(initialView);
  const wasRunning = useRef(false);

  const go = useCallback((v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // remembered view is a convenience only
    }
  }, []);

  const reload = useCallback(() => {
    api
      .status()
      .then((s) => {
        setStatus(s);
        wasRunning.current = s.job?.status === "running";
      })
      .catch((e: Error) =>
        toast.error(`Studio nicht erreichbar: ${e.message}`),
      );
  }, []);

  useEffect(() => {
    reload();
    const slow = setInterval(() => {
      if (!document.hidden) reload();
    }, 30_000);
    return () => clearInterval(slow);
  }, [reload]);

  // While a job runs, follow it every 2 s; reload everything when it ends.
  const running = status?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      api
        .job()
        .then(({ job }) => {
          setStatus((s) => (s ? { ...s, job } : s));
          if (job && job.status !== "running" && wasRunning.current) {
            wasRunning.current = false;
            const state = JOB_STATE[job.status];
            if (job.status === "done")
              toast.success(`${job.title}: ${state.label}`);
            else toast.error(`${job.title}: ${state.label}`);
            reload();
          }
        })
        .catch(() => {
          // next tick tries again
        });
    }, 2000);
    return () => clearInterval(t);
  }, [running, reload]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <header className="bg-card/80 flex items-center gap-4 border-b px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md">
              <BrainCircuit className="size-4" />
            </div>
            <div>
              <div className="text-sm leading-tight font-semibold">
                Training Studio
              </div>
              <div className="text-muted-foreground text-[11px] leading-tight">
                Fahrzeugerkennung · lokal
              </div>
            </div>
          </div>
          <Tabs value={view} onValueChange={(v) => go(v as View)}>
            <TabsList>
              <TabsTrigger value="overview">
                <LayoutDashboard /> Übersicht
              </TabsTrigger>
              <TabsTrigger value="label">
                <PenTool /> Labeln
              </TabsTrigger>
              <TabsTrigger value="training">
                <BrainCircuit /> Training
              </TabsTrigger>
              <TabsTrigger value="models">
                <Gauge /> Modelle
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" />
          {status && <ToolsMenu status={status} reload={reload} />}
          <JobSheet job={status?.job ?? null} onChanged={reload} />
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          {!status ? (
            <div className="text-muted-foreground grid h-full place-items-center">
              <LoaderCircle className="size-6 animate-spin" />
            </div>
          ) : view === "label" ? (
            <LabelView status={status} reload={reload} />
          ) : view === "training" ? (
            <TrainingView status={status} reload={reload} />
          ) : view === "models" ? (
            <ModelsView status={status} reload={reload} />
          ) : (
            <OverviewView status={status} go={go} />
          )}
        </main>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
