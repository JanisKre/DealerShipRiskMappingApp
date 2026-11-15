import { ArrowRight, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Progress } from "@renderer/components/ui/progress";
import { cn } from "@renderer/lib/utils";
import type { Status } from "@studio/api";
import type { View } from "@studio/App";
import { SetupAction } from "@studio/components/SetupAction";
import { appEvaluation, bestThreshold, jobTitle, setupStep } from "@studio/lib";
import { fmt, pct } from "@studio/numbers";

/**
 * Status with one next step. The actions live in their tabs, except the
 * setup steps of a fresh clone (site list, tiles, first suggestions), which
 * start right here.
 */
export function OverviewView({
  status,
  go,
  reload,
}: {
  status: Status;
  go: (v: View) => void;
  reload: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const s = status.sites;
  const rv = status.review;
  const au = status.audit;
  const busy = status.job?.status === "running";
  const last = status.rounds[status.rounds.length - 1];
  const installed = status.models.installed;
  const installedEval = installed?.weights
    ? appEvaluation(status, installed.weights)
    : null;
  const installedBest = installedEval ? bestThreshold(installedEval) : null;
  const shipped = Boolean(
    installed && installed.sha256 === status.models.release.onnxSha256,
  );

  const setup = busy ? null : setupStep(status);
  const lastDone = [...status.rounds].reverse().find((r) => r.state === "done");
  const next: { title: string; text: string; label: string; view: View } = busy
    ? {
        title: jobTitle(status.job!),
        text: t("overview.runningText"),
        label: t("overview.runningLabel"),
        view: "label",
      }
    : rv.questions > 0
      ? {
          title: t("overview.questionsTitle", {
            count: rv.questions,
            inSites: t("overview.inSites", { count: rv.openSites }),
          }),
          text: t("overview.questionsText"),
          label: t("overview.questionsLabel"),
          view: "label",
        }
      : au.questions > 0
        ? {
            title: t("overview.auditTitle", { count: au.questions }),
            text: t("overview.auditText"),
            label: t("overview.auditLabel"),
            view: "label",
          }
        : rv.tiles > rv.doneTiles
          ? {
              title: t("overview.notDoneTitle", {
                count: rv.tiles - rv.doneTiles,
              }),
              text: t("overview.notDoneText"),
              label: t("app.nav.label"),
              view: "label",
            }
          : lastDone
            ? {
                title: t("overview.compareTitle"),
                text: t("overview.compareText"),
                label: t("app.nav.models"),
                view: "models",
              }
            : {
                title: t("overview.firstTitle"),
                text: t("overview.firstText"),
                label: t("app.nav.training"),
                view: "training",
              };

  const flow = [
    {
      title: t("overview.flowLabel"),
      detail: t("overview.flowLabelDetail", {
        done: rv.doneTiles,
        total: rv.tiles,
      }),
      done: rv.tiles > 0 && rv.doneTiles === rv.tiles,
    },
    {
      title: t("overview.flowRetrain"),
      detail: last
        ? t(
            last.state === "done" || last.state === "running"
              ? "overview.flowRetrainDetail"
              : "overview.flowRetrainUnfinished",
            { count: status.rounds.length, run: last.run },
          )
        : t("overview.flowRetrainNone"),
      done: false,
    },
    {
      title: t("overview.flowCompare"),
      detail: last?.appBest
        ? t("overview.flowCompareDetail", {
            mae: fmt(last.appBest.mae, 1),
            run: last.run,
          })
        : t("overview.flowCompareNone"),
      done: false,
    },
    {
      title: t("overview.flowShip"),
      detail: shipped
        ? t("overview.flowShipSame")
        : t("overview.flowShipDiffers"),
      done: shipped,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("app.nav.overview")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("overview.subtitle")}
        </p>
      </header>
      <Card className="border-primary/30 from-primary/10 bg-gradient-to-br to-transparent">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-[260px] flex-1">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {busy
                ? t("overview.kickerRunning")
                : setup
                  ? t("overview.kickerSetup")
                  : t("overview.kickerNext")}
            </div>
            <h2 className="mt-1 text-xl font-semibold">
              {setup ? setup.title : next.title}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {setup ? setup.text : next.text}
            </p>
          </div>
          {setup ? (
            <SetupAction
              step={setup}
              status={status}
              onStarted={reload}
              size="lg"
            />
          ) : (
            <Button size="lg" onClick={() => go(next.view)}>
              {next.label} <ArrowRight />
            </Button>
          )}
        </CardContent>
      </Card>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {flow.map((f, i) => (
          <li
            key={f.title}
            className="bg-card flex items-start gap-3 rounded-xl border p-3"
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                f.done
                  ? "border-[var(--box-car)] text-[var(--box-car)]"
                  : "text-muted-foreground",
              )}
            >
              {f.done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{f.title}</div>
              <div className="text-muted-foreground text-xs">{f.detail}</div>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>{t("overview.labelled")}</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {fmt(s.finished)}{" "}
              <span className="text-muted-foreground text-lg font-normal">
                {t("overview.ofSites", { count: s.sites })}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.sites === 0 && (
              <p className="text-muted-foreground text-xs">
                {t("overview.noSiteList")}
              </p>
            )}
            <Progress
              value={s.sites ? (s.finished / s.sites) * 100 : 0}
              className="h-1.5"
            />
            <div
              className="grid grid-cols-4 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-6"
              aria-label={t("overview.perState")}
            >
              {Object.entries(s.perState).map(([state, v]) => (
                <div
                  key={state}
                  className="flex items-center justify-between gap-1"
                >
                  <span
                    className={cn(
                      "font-medium",
                      v.finished < v.sites && "text-[var(--box-open)]",
                    )}
                  >
                    {state}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {v.finished}/{v.sites}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("overview.installed")}</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {installed?.version ?? "–"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-1 text-sm">
            <div>
              {installedBest
                ? t("overview.countError", {
                    mae: fmt(installedBest.mae, 1),
                    bias: pct(installedBest.bias),
                  })
                : t("overview.notMeasured")}
            </div>
            <div className="break-words">
              {shipped
                ? t("overview.shippedWith", { tag: status.models.release.tag })
                : status.models.release.tag
                  ? t("overview.shipping", { tag: status.models.release.tag })
                  : t("overview.shippingNone")}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
