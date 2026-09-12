import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, X } from "lucide-react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { buildSessionContext } from "@renderer/lib/sessionContext";
import { useLlmStream } from "@renderer/lib/useLlmStream";
import { useAppStore } from "@renderer/store/appStore";
import { computeClusterRisk } from "@shared/risk-math";

/** Minimum number of analyzed locations from which the concentration metric is meaningful. */
const MIN_ANALYZED_FOR_SUMMARY = 2;

/**
 * Executive Summary: streams a markdown portfolio analysis. Also shows a
 * concentration badge (share of the largest EAL cluster in the total EAL).
 * Only appears from two analyzed locations onward (with just one, "100%
 * concentration" is trivial and misleading) and can be dismissed via X.
 */
export function ExecutiveSummary(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const { text, streaming, error, start } = useLlmStream();
  const [started, setStarted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const analyzedCount = dealerships.filter((d) => d.risk).length;
  if (dismissed || analyzedCount < MIN_ANALYZED_FOR_SUMMARY) return null;

  const concentration = concentrationBadge(dealerships, i18n.language);

  function generate(): void {
    setStarted(true);
    start({
      kind: "summary",
      sessionContext: buildSessionContext(dealerships),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{t("ai.summary")}</CardTitle>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={() => setDismissed(true)}
            title={t("ui.dismiss")}
            aria-label={t("ui.dismissSummary")}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {concentration && (
            <Badge variant={concentration.severe ? "destructive" : "secondary"}>
              {t("ui.concentration", { value: concentration.label })}
            </Badge>
          )}
          <Button
            size="sm"
            className="ml-auto"
            onClick={generate}
            disabled={streaming || dealerships.length === 0}
          >
            {streaming ? <Loader2 className="animate-spin" /> : <Sparkles />}{" "}
            {t("ui.generate")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive">{t("ui.error", { error })}</p>
        )}
        {!started && !error && (
          <p className="text-sm text-muted-foreground">
            {t("ui.summaryDescription")}
          </p>
        )}
        {started && <Markdown text={text} />}
        {streaming && (
          <span className="text-xs text-muted-foreground">
            {t("ui.answering")}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function concentrationBadge(
  dealerships: Parameters<typeof computeClusterRisk>[0],
  locale: string,
): { label: string; severe: boolean } | null {
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  if (totalEal <= 0) return null;
  const clusters = computeClusterRisk(dealerships);
  const maxCluster = clusters.reduce(
    (max, c) => Math.max(max, c.totalEalEur),
    0,
  );
  const share = maxCluster / totalEal;
  return {
    label: new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(share),
    severe: share >= 0.5,
  };
}

/**
 * Minimal markdown renderer for streamed output (## headings, lists,
 * paragraphs). Deliberately lightweight — no external dependency.
 */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = text.split("\n").map((line, i) => {
    const key = `${i}-${line.slice(0, 8)}`;
    if (line.startsWith("## ")) {
      return (
        <h3 key={key} className="mt-3 text-sm font-semibold">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith("# ")) {
      return (
        <h2 key={key} className="mt-3 text-base font-semibold">
          {line.slice(2)}
        </h2>
      );
    }
    if (/^\s*[-*]\s+/.test(line)) {
      return (
        <li key={key} className="ml-4 list-disc text-sm">
          {line.replace(/^\s*[-*]\s+/, "")}
        </li>
      );
    }
    if (line.trim() === "") return <div key={key} className="h-2" />;
    return (
      <p key={key} className="text-sm">
        {line}
      </p>
    );
  });
  return <div className="space-y-0.5">{blocks}</div>;
}
