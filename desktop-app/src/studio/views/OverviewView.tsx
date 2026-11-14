import {
  ArrowRight,
  BrainCircuit,
  CircleCheck,
  Gauge,
  PenTool,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";
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
import { Progress } from "@renderer/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { cn } from "@renderer/lib/utils";
import { api, fmt, pct, type Status } from "@studio/api";
import type { View } from "@studio/App";

export function OverviewView({
  status,
  go,
  reload,
}: {
  status: Status;
  go: (v: View) => void;
  reload: () => void;
}): React.JSX.Element {
  const s = status.sites;
  const rv = status.review;
  const au = status.audit;
  const busy = status.job?.status === "running";
  const last = status.rounds[status.rounds.length - 1];
  const installedBest = bestApp(status, "dealer-obb");
  const [alWeights, setAlWeights] = useState(
    status.rounds.length ? last.run : "dealer-obb",
  );

  const run = async (
    step: string,
    options: Record<string, unknown> = {},
  ): Promise<void> => {
    try {
      await api.run(step, options);
      toast.success("Gestartet. Den Fortschritt siehst du oben rechts.");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const next = busy
    ? {
        title: `Läuft: ${status.job!.title}`,
        text: "Du kannst weiter labeln; der Schritt läuft im Hintergrund weiter, auch wenn du die Seite schließt.",
        action: null,
      }
    : rv.questions > 0
      ? {
          title: `${fmt(rv.questions)} Fragen in ${fmt(rv.openSites)} Standorten`,
          text: "Kacheln ansehen, Vorschläge bestätigen oder ablehnen, fehlende Fahrzeuge einzeichnen. Nach einem Schwung „Speichern & neu trainieren“.",
          action: { label: "Labeln", view: "label" as View },
        }
      : au.questions > 0
        ? {
            title: `${fmt(au.questions)} Audit-Fragen`,
            text: "Fehlende oder falsche Labels in fertigen Standorten finden.",
            action: { label: "Audit öffnen", view: "label" as View },
          }
        : {
            title: "Modelle vergleichen",
            text: "Alle Fragen beantwortet. Die letzte Runde mit dem installierten Modell vergleichen.",
            action: { label: "Modelle", view: "models" as View },
          };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Card className="border-primary/30 from-primary/10 bg-gradient-to-br to-transparent">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-[280px] flex-1">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Als Nächstes
            </div>
            <div className="mt-1 text-xl font-semibold">{next.title}</div>
            <p className="text-muted-foreground mt-1 text-sm">{next.text}</p>
          </div>
          {next.action && (
            <Button size="lg" onClick={() => go(next.action!.view)}>
              {next.action.label} <ArrowRight />
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<CircleCheck />}
          label="Standorte fertig"
          value={`${fmt(s.finished)} / ${fmt(s.sites)}`}
        >
          <Progress
            value={s.sites ? (s.finished / s.sites) * 100 : 0}
            className="mt-2 h-1.5"
          />
        </Kpi>
        <Kpi
          icon={<PenTool />}
          label="Offene Fragen"
          value={fmt(rv.questions + au.questions)}
          hint={`${fmt(rv.questions)} offen · ${fmt(au.questions)} Audit`}
        />
        <Kpi
          icon={<BrainCircuit />}
          label="Trainingsrunden"
          value={fmt(status.rounds.length)}
          hint={
            last
              ? `zuletzt ${last.run}${last.appBest ? `, MAE ${fmt(last.appBest.mae, 1)}` : ""}`
              : "noch keine"
          }
        />
        <Kpi
          icon={<Gauge />}
          label="Installiertes Modell"
          value={status.models.installed?.version ?? "–"}
          hint={
            installedBest
              ? `MAE ${fmt(installedBest.mae, 1)} · Bias ${pct(installedBest.bias)} @ ${fmt(installedBest.conf, 2)}`
              : "noch nicht gemessen"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Ablauf</CardTitle>
            <CardDescription>
              Labeln, trainieren, messen, ausliefern. Die Schritte mit „du“
              brauchen dich.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <Step
              n={1}
              done={s.tiles > 0}
              title="Kacheln laden"
              detail={`${fmt(s.tiles)} Kacheln von ${fmt(s.sites)} Standorten`}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run("fetch")}
              >
                Fehlende laden
              </Button>
            </Step>
            <Step
              n={2}
              done={rv.tiles > 0}
              title="Vorschläge berechnen"
              detail={rv.weights ? `aktuell von ${rv.weights}` : "noch keine"}
            >
              <Select value={alWeights} onValueChange={setAlWeights}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {status.weights.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run("autolabel", { weights: alWeights })}
              >
                Berechnen
              </Button>
            </Step>
            <Step
              n={3}
              you
              done={rv.tiles > 0 && rv.doneTiles === rv.tiles}
              title="Labeln"
              detail={`${fmt(rv.doneTiles)} / ${fmt(rv.tiles)} Kacheln · ${fmt(rv.questions)} Fragen`}
            >
              <Button size="sm" onClick={() => go("label")}>
                Öffnen
              </Button>
            </Step>
            <Step
              n={4}
              you
              done={au.tiles > 0 && au.doneTiles === au.tiles}
              title="Audit fertiger Standorte"
              detail={`${fmt(au.doneTiles)} / ${fmt(au.tiles)} Kacheln · ${fmt(au.questions)} Fragen`}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run("autolabel", { weights: alWeights, audit: true })
                }
              >
                Neu berechnen
              </Button>
              <Button size="sm" variant="outline" onClick={() => go("label")}>
                Öffnen
              </Button>
            </Step>
            <Step
              n={5}
              done={status.rounds.length > 0}
              title="Trainingsrunde"
              detail="Datensatz, Feintuning, Messung, neue Vorschläge – ein Klick"
            >
              <Button
                size="sm"
                variant="outline"
                onClick={() => go("training")}
              >
                Training
              </Button>
            </Step>
            <Step
              n={6}
              you
              title="Bestes Modell installieren und ausliefern"
              detail={`Release: ${status.models.release.tag ?? "–"}`}
            >
              <Button size="sm" variant="outline" onClick={() => go("models")}>
                <Rocket /> Modelle
              </Button>
            </Step>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Bundesländer</CardTitle>
              <CardDescription>Fertige Standorte je Land</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
              {Object.entries(s.perState).map(([state, v]) => (
                <div
                  key={state}
                  className="bg-muted/50 rounded-md px-2 py-1.5 text-xs"
                >
                  <div className="flex justify-between">
                    <b>{state}</b>
                    <span className="text-muted-foreground tabular-nums">
                      {v.finished}/{v.sites}
                    </span>
                  </div>
                  <div className="bg-muted mt-1 h-1 overflow-hidden rounded-full">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        v.finished === v.sites
                          ? "bg-[var(--box-car)]"
                          : "bg-[var(--box-open)]",
                      )}
                      style={{
                        width: `${v.sites ? (v.finished / v.sites) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="size-4" /> Weitere Werkzeuge
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Tool
                label="Claude-Bögen erzeugen"
                hint={`${status.claude.sheets} Bögen, ${status.claude.answers} beantwortet. Die Ausschnitte verlassen den Rechner, wenn Claude sie liest.`}
                disabled={busy}
                onClick={() => void run("claude-sheets")}
                icon={<Sparkles />}
              />
              <Tool
                label="Claude-Antworten übernehmen"
                hint="Nur „kein Fahrzeug“ bei schwachen Kandidaten entscheidet."
                disabled={busy || !status.claude.answers}
                onClick={() => void run("claude-apply")}
              />
              <Tool
                label="Korrekturen aus der App lesen"
                hint="Punkte, die du in der App gesetzt oder gelöscht hast."
                disabled={busy}
                onClick={() => void run("harvest")}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function bestApp(
  status: Status,
  run: string,
): { conf: number; mae: number; bias: number; within10: number } | null {
  const e = [...status.evals]
    .reverse()
    .find((x) => x.run === run && x.pipeline === "app-inferWindow");
  return e ? e.thresholds.reduce((a, t) => (t.mae < a.mae ? t : a)) : null;
}

function Kpi({
  icon,
  label,
  value,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground flex items-center gap-2 text-xs [&_svg]:size-3.5">
          {icon}
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && (
          <div className="text-muted-foreground mt-0.5 truncate text-xs">
            {hint}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

function Step({
  n,
  title,
  detail,
  done,
  you,
  children,
}: {
  n: number;
  title: string;
  detail: string;
  done?: boolean;
  you?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
          done
            ? "border-[var(--box-car)] text-[var(--box-car)]"
            : you
              ? "border-[var(--box-open)] text-[var(--box-open)]"
              : "text-muted-foreground",
        )}
      >
        {done ? "✓" : n}
      </div>
      <div className="min-w-[180px] flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {title}
          {you && <Badge variant="outline">du</Badge>}
        </div>
        <div className="text-muted-foreground text-xs">{detail}</div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Tool({
  label,
  hint,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className="text-muted-foreground text-xs">{hint}</div>
      </div>
      <Button size="sm" variant="outline" disabled={disabled} onClick={onClick}>
        {icon}
        Start
      </Button>
    </div>
  );
}
