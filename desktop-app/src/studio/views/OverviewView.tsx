import { ArrowRight, Check } from "lucide-react";
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
import { fmt, pct, type Status } from "@studio/api";
import type { View } from "@studio/App";
import { appEvaluation, bestThreshold } from "@studio/lib";

/** Read-only status with one next step; the actions live in their tabs. */
export function OverviewView({
  status,
  go,
}: {
  status: Status;
  go: (v: View) => void;
}): React.JSX.Element {
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

  const next: { title: string; text: string; label: string; view: View } = busy
    ? {
        title: status.job!.title,
        text: "Läuft im Hintergrund. Du kannst weiterlabeln oder die Seite schließen.",
        label: "Weiter labeln",
        view: "label",
      }
    : rv.questions > 0
      ? {
          title: `${fmt(rv.questions)} Fragen in ${fmt(rv.openSites)} Standorten`,
          text: "Vorschläge bestätigen, fehlende Fahrzeuge einzeichnen. Nach einem Schwung „Speichern & neu trainieren“.",
          label: "Labeln",
          view: "label",
        }
      : au.questions > 0
        ? {
            title: `${fmt(au.questions)} Audit-Fragen`,
            text: "Fehlende oder falsche Labels in fertigen Standorten finden.",
            label: "Audit",
            view: "label",
          }
        : {
            title: "Modelle vergleichen",
            text: "Alles beantwortet. Die letzte Runde mit dem installierten Modell vergleichen.",
            label: "Modelle",
            view: "models",
          };

  const flow = [
    {
      title: "Labeln",
      detail: `${fmt(rv.doneTiles)} / ${fmt(rv.tiles)} Kacheln`,
      done: rv.tiles > 0 && rv.doneTiles === rv.tiles,
    },
    {
      title: "Neu trainieren",
      detail: last
        ? `${status.rounds.length} Runden, zuletzt ${last.run}`
        : "noch keine Runde",
      done: false,
    },
    {
      title: "Vergleichen",
      detail: last?.appBest
        ? `MAE ${fmt(last.appBest.mae, 1)} in ${last.run}`
        : "nach der ersten Runde",
      done: false,
    },
    {
      title: "Ausliefern",
      detail: shipped ? "installiert = Release" : "installiert ≠ Release",
      done: shipped,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <Card className="border-primary/30 from-primary/10 bg-gradient-to-br to-transparent">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-[280px] flex-1">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {busy ? "Läuft" : "Als Nächstes"}
            </div>
            <div className="mt-1 text-xl font-semibold">{next.title}</div>
            <p className="text-muted-foreground mt-1 text-sm">{next.text}</p>
          </div>
          <Button size="lg" onClick={() => go(next.view)}>
            {next.label} <ArrowRight />
          </Button>
        </CardContent>
      </Card>

      <ol className="grid gap-3 sm:grid-cols-4">
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
              <div className="text-muted-foreground truncate text-xs">
                {f.detail}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Fertig gelabelt</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {fmt(s.finished)}{" "}
              <span className="text-muted-foreground text-lg font-normal">
                / {fmt(s.sites)} Standorte
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress
              value={s.sites ? (s.finished / s.sites) * 100 : 0}
              className="h-1.5"
            />
            <div className="grid grid-cols-4 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-7">
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
            <CardDescription>Installiertes Modell</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {installed?.version ?? "–"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-1 text-sm">
            <div>
              {installedBest
                ? `Zählfehler ${fmt(installedBest.mae, 1)} Fahrzeuge je Standort, Bias ${pct(installedBest.bias)}`
                : "Noch nicht gemessen."}
            </div>
            <div>
              {shipped
                ? `Wird mit der App ausgeliefert (${status.models.release.tag}).`
                : `Ausgeliefert wird ${status.models.release.tag ?? "kein Modell"}.`}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
