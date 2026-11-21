import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Loader2, ScanSearch } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { LLM_NOT_CONFIGURED } from "@shared/llm-config";
import {
  SITE_QUESTION_IDS,
  questionOptions,
  resolveAll,
  shownProbability,
  type ResolvedAnswer,
  type SiteAnswer,
  type SiteQuestionId,
  type ThresholdTable,
} from "@shared/site-questions";
import { LlmErrorMessage } from "@renderer/components/ai/LlmSetupNotice";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { notify } from "@renderer/lib/notify";
import { useAppStore } from "@renderer/store/appStore";
import {
  ensureDecisionState,
  useDecisionStore,
} from "@renderer/store/decisionStore";
import { Disclosure } from "./detail/shared";

type PersonSource = "underwriter" | "dealer";
const NONE = "__none__";

/** "ja", "die meisten", "unklar" … */
export function valueLabel(t: TFunction, value: string): string {
  return t(`siteQuestions.value.${value}`);
}

function percent(p: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(p);
}

/** Who gave an answer, and for a model on which image. */
export function answerOrigin(
  t: TFunction,
  a: SiteAnswer,
  locale: string,
): string {
  if (a.source !== "model") {
    return t(`siteQuestions.source.${a.source}`, {
      date: new Date(a.at).toLocaleDateString(locale),
    });
  }
  return t("siteQuestions.source.model", {
    engine: t(`siteQuestions.engine.${a.engine ?? "llm"}`),
    model: a.model ?? "",
    date: a.imageCapturedAt ?? t("siteCheck.dateUnknown"),
  });
}

function ResolvedRow({
  resolved,
  thresholds,
  source,
  answers,
  onChange,
}: Readonly<{
  resolved: ResolvedAnswer;
  thresholds: ThresholdTable | undefined;
  source: PersonSource;
  answers: readonly SiteAnswer[];
  onChange: (question: SiteQuestionId, value: string | null) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const id = resolved.question;
  const own = answers.find((a) => a.question === id && a.source === source);
  const shown = resolved.answer;
  const probability = shown ? shownProbability(shown, thresholds) : null;
  const models = [shown, ...resolved.others].filter(
    (a): a is SiteAnswer => a != null && a.source === "model" && a !== shown,
  );
  return (
    <li className="space-y-1 border-b pb-2 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-1">{t(`siteQuestions.q.${id}`)}</span>
        <Select
          value={own?.value ?? NONE}
          onValueChange={(v) => onChange(id, v === NONE ? null : v)}
        >
          <SelectTrigger
            className="h-8 w-36 bg-background text-xs"
            aria-label={t("siteQuestions.answerFor", {
              question: t(`siteQuestions.q.${id}`),
            })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("siteQuestions.noAnswer")}</SelectItem>
            {[...questionOptions(id), "unclear"].map((option) => (
              <SelectItem key={option} value={option}>
                {valueLabel(t, option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {shown ? (
          <>
            <Badge
              variant={
                resolved.value === "yes" && shown.source !== "model"
                  ? "default"
                  : "outline"
              }
            >
              {shown.source === "model"
                ? t("siteQuestions.modelValue", {
                    value: valueLabel(t, resolved.value),
                  })
                : valueLabel(t, resolved.value)}
              {probability != null &&
                ` · ${percent(probability, i18n.language)}`}
            </Badge>
            <span>{answerOrigin(t, shown, i18n.language)}</span>
          </>
        ) : (
          <span>{t("siteQuestions.unanswered")}</span>
        )}
      </div>
      {models.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {models.map((a) => (
            <li key={`${a.engine}-${a.at}`}>
              {answerOrigin(t, a, i18n.language)}: {valueLabel(t, a.value)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The site questions of one location: answered by hand (underwriter, or
 * the dealer's statement), and optionally by an image model on the aerial
 * image. Works without AI. The answers are observations; the count, the
 * boundary and the hail EAL stay as they are.
 */
export function SiteQuestionsSection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element {
  const { t } = useTranslation();
  const setSiteAnswer = useAppStore((s) => s.setSiteAnswer);
  const recordSiteAnswers = useAppStore((s) => s.recordSiteAnswers);
  const engine = useDecisionStore((s) => s.engine);
  const model = useDecisionStore((s) => s.model);
  const local = useDecisionStore((s) => s.local);
  const thresholds = useDecisionStore((s) => s.thresholds);
  const [source, setSource] = useState<PersonSource>("underwriter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(ensureDecisionState, []);
  useEffect(() => setError(null), [d.id]);

  const answers = d.siteAnswers ?? [];
  const resolved = useMemo(
    () => resolveAll(d.siteAnswers, thresholds),
    [d.siteAnswers, thresholds],
  );
  const answered = resolved.filter((r) => r.value !== "unanswered").length;

  function change(question: SiteQuestionId, value: string | null): void {
    void setSiteAnswer(d.id, question, value, source).catch((err: unknown) =>
      notify.failed(err, t("common.saveFailed")),
    );
  }

  async function ask(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const run = await window.api.answerSiteQuestions({
        lat: d.lat,
        lon: d.lon,
        boundary: d.boundary,
      });
      await recordSiteAnswers(d.id, run.answers);
      if (!run.imageUsable) notify.info(t("siteQuestions.imageUnusable"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Disclosure
      title={t("siteQuestions.title")}
      summary={t("siteQuestions.summary", {
        answered,
        total: SITE_QUESTION_IDS.length,
      })}
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("siteQuestions.description")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("siteQuestions.answersBy")}
          </span>
          <Select
            value={source}
            onValueChange={(v) => setSource(v as PersonSource)}
          >
            <SelectTrigger
              className="h-8 w-40 bg-background text-xs"
              aria-label={t("siteQuestions.answersBy")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="underwriter">
                {t("siteQuestions.by.underwriter")}
              </SelectItem>
              <SelectItem value="dealer">
                {t("siteQuestions.by.dealer")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ul className="space-y-2">
          {resolved.map((r) => (
            <ResolvedRow
              key={r.question}
              resolved={r}
              thresholds={thresholds}
              source={source}
              answers={answers}
              onChange={change}
            />
          ))}
        </ul>
        {engine && (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void ask()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              {t("siteQuestions.ask", {
                engine: t(`siteQuestions.engine.${engine}`),
              })}
            </Button>
            <p className="text-xs text-muted-foreground">
              {local
                ? t("siteQuestions.staysLocal", { model })
                : t("siteQuestions.leavesComputer", {
                    engine: t(`siteQuestions.engine.${engine}`),
                    model,
                  })}{" "}
              {engine === "llm"
                ? t("siteQuestions.noProbabilities")
                : t("siteQuestions.probabilitiesHidden")}
            </p>
            {error &&
              (error.includes(LLM_NOT_CONFIGURED) ? (
                <p role="alert" className="text-xs text-destructive">
                  {t("siteQuestions.notSetUp")}
                </p>
              ) : (
                <LlmErrorMessage error={error} />
              ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("siteQuestions.disclaimer")}
        </p>
      </div>
    </Disclosure>
  );
}
