import { Languages, LoaderCircle, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { Toaster } from "@renderer/components/ui/sonner";
import { TooltipProvider } from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { api, type Status } from "./api";
import { ConfirmHost } from "./components/ConfirmDialog";
import { JobSheet } from "./components/JobSheet";
import { ToolsMenu } from "./components/ToolsMenu";
import { LANGUAGES, setLanguage, type Language } from "./i18n";
import { jobTitle, OFFLINE_EVENT, stageName } from "./lib";
import { LabelView } from "./views/LabelView";
import { ModelsView } from "./views/ModelsView";
import { OverviewView } from "./views/OverviewView";
import { TrainingView } from "./views/TrainingView";

export type View = "overview" | "label" | "training" | "models";

const VIEWS: View[] = ["overview", "label", "training", "models"];

const VIEW_KEY = "studio.view";

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (VIEWS.includes(v as View)) return v as View;
  } catch {
    // storage unavailable: start on the overview
  }
  return "overview";
}

export function App(): React.JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [offline, setOffline] = useState(false);
  const wasRunning = useRef(false);

  const go = useCallback((v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // remembered view is a convenience only
    }
  }, []);

  // Unreachable studio: one banner (no toast per failed poll), cleared when it answers again.
  const reload = useCallback(() => {
    api
      .status()
      .then((s) => {
        setStatus(s);
        setOffline(false);
        toast.dismiss("offline");
        wasRunning.current = s.job?.status === "running";
      })
      .catch(() => setOffline(true));
  }, []);

  // A failed request elsewhere: check now instead of at the next poll.
  useEffect(() => {
    window.addEventListener(OFFLINE_EVENT, reload);
    return () => window.removeEventListener(OFFLINE_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    reload();
    const slow = setInterval(
      () => {
        if (!document.hidden) reload();
      },
      offline ? 5_000 : 30_000,
    );
    return () => clearInterval(slow);
  }, [reload, offline]);

  // While a job runs, follow it every 2 s; reload everything when it ends.
  const running = status?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .job()
        .then(({ job }) => {
          setStatus((s) => (s ? { ...s, job } : s));
          if (job && job.status !== "running" && wasRunning.current) {
            wasRunning.current = false;
            const title = t("app.jobEnded", {
              title: jobTitle(job),
              state: t(`jobs.state.${job.status}`),
            });
            if (job.status === "done") toast.success(title);
            else {
              const reason = job.error
                ? job.error.code === "job_lost"
                  ? t("server.job_lost")
                  : job.error.message
                : "";
              const stage = job.error
                ? stageName(job.error.stageKey, job.error.stage)
                : "";
              toast.error(title, {
                description: !job.error
                  ? t("app.jobDetails")
                  : stage
                    ? t("app.jobReason", { stage, message: reason })
                    : reason,
              });
            }
            reload();
          }
        })
        .catch(() => {
          // next tick tries again
        });
    }, 2000);
    return () => clearInterval(timer);
  }, [running, reload, t]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <header className="bg-background border-b">
          <div className="flex h-12 items-center gap-3 px-4 lg:gap-6">
            <span className="hidden text-sm font-semibold tracking-tight whitespace-nowrap lg:inline">
              {t("app.title")}
            </span>
            {status?.sandbox && (
              <Badge
                variant="outline"
                className="shrink-0"
                title={
                  status.sandbox.appModels
                    ? t("app.sandboxDataModels", {
                        data: status.sandbox.data,
                        models: status.sandbox.appModels,
                      })
                    : t("app.sandboxData", { data: status.sandbox.data })
                }
              >
                {t("app.sandbox")}
              </Badge>
            )}
            <nav
              aria-label={t("app.navLabel")}
              className="flex min-w-0 items-center gap-1"
            >
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-current={view === v ? "page" : undefined}
                  onClick={() => go(v)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] lg:px-3",
                    view === v && "bg-muted text-foreground font-medium",
                  )}
                >
                  {t(`app.nav.${v}`)}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex min-w-0 items-center gap-1">
              {status && <ToolsMenu status={status} reload={reload} />}
              <LanguageMenu />
              <JobSheet job={status?.job ?? null} onChanged={reload} />
            </div>
          </div>
        </header>
        {offline && (
          <div
            role="alert"
            className="bg-destructive/15 text-destructive flex items-center gap-2 border-b px-4 py-1.5 text-sm"
          >
            <WifiOff className="size-4 shrink-0" />
            {t("app.offline")}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-auto">
          {!status ? (
            <div
              className="text-muted-foreground grid h-full place-items-center"
              aria-label={t("app.loading")}
            >
              <LoaderCircle className="size-6 animate-spin" />
            </div>
          ) : view === "label" ? (
            <LabelView status={status} reload={reload} />
          ) : view === "training" ? (
            <TrainingView status={status} reload={reload} />
          ) : view === "models" ? (
            <ModelsView status={status} reload={reload} />
          ) : (
            <OverviewView status={status} go={go} reload={reload} />
          )}
        </main>
      </div>
      {/* Top centre: never over "Kachel fertig" or the save state at the bottom. */}
      <Toaster
        position="top-center"
        offset={56}
        theme="dark"
        closeLabel={t("common.close")}
      />
      <ConfirmHost />
    </TooltipProvider>
  );
}

/** Deutsch / English / Français; remembered in the browser. */
function LanguageMenu(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "de") as Language;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-label={t("app.language")}
          title={t("app.language")}
        >
          <Languages className="size-4" />
          <span className="uppercase">{current}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {t("app.language")}
        </DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuCheckboxItem
            key={l.code}
            lang={l.code}
            checked={current === l.code}
            onSelect={() => setLanguage(l.code)}
          >
            {l.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
