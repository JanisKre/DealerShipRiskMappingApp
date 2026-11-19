import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { notify } from "@renderer/lib/notify";
import { Copy, Loader2, NotebookPen, ScanSearch, Sparkles } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { DEALERSHIP_NOTES_MAX_LENGTH } from "@shared/constants";
import {
  challengeAssumptions,
  challengeFacts,
} from "@shared/assumption-challenge";
import {
  memoFacts,
  type EvidenceMemo,
  type MemoFact,
} from "@shared/evidence-memo";
import {
  featuresSince,
  type BoundaryOpinion,
  type SiteCheck,
  type SiteCheckResult,
} from "@shared/site-check";
import {
  REPLY_MAX_CHARS,
  type QuestionnaireAnswer,
} from "@shared/questionnaire-answers";
import type { Question } from "@shared/dealer-questionnaire";
import { AiExplanation } from "@renderer/components/ai/AiExplanation";
import { LlmErrorMessage } from "@renderer/components/ai/LlmSetupNotice";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { useLlmReady } from "@renderer/lib/useLlmReady";
import { useAppStore } from "@renderer/store/appStore";
import { Disclosure } from "./detail/shared";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Appends a dated line to the location's notes (the existing notes field). */
function useAppendNote(d: AnalyzedDealership): (text: string) => void {
  const { t } = useTranslation();
  const updateNotes = useAppStore((s) => s.updateDealershipNotes);
  return (text) => {
    const next = [d.notes?.trim(), text].filter(Boolean).join("\n\n");
    if (next.length > DEALERSHIP_NOTES_MAX_LENGTH) {
      notify.error(t("aiInsight.notesFull"));
      return;
    }
    void updateNotes(d.id, next)
      .then(() => notify.success(t("aiInsight.addedToNotes")))
      .catch((error: unknown) => notify.failed(error, t("common.saveFailed")));
  };
}

// --- Weakest assumptions ("Advocatus Diaboli") --------------------------------

/**
 * The weakest assumptions behind this location's result, found by fixed
 * rules. With an AI provider the same points can be worded as a
 * counter-argument; no figure comes from the model.
 */
export function ChallengeSection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const challenges = useMemo(
    () => challengeAssumptions(d, parameters),
    [d, parameters],
  );
  return (
    <Disclosure
      title={t("challenge.title")}
      summary={t("challenge.count", { count: challenges.length })}
    >
      <div className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("challenge.description")}
        </p>
        <ul className="space-y-1.5">
          {challenges.map((c) => (
            <li key={c.kind} className="flex items-start gap-2">
              <Badge
                variant={c.severity === 3 ? "destructive" : "secondary"}
                className="mt-0.5 shrink-0"
              >
                {t(`challenge.severity.${c.severity}`)}
              </Badge>
              <span>
                {t(`challenge.kind.${c.kind}`, c.values ?? {})}
                <span className="block text-xs text-muted-foreground">
                  {t(`challenge.effect.${c.effect}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <AiExplanation
          topic="challenge"
          facts={
            challenges.length > 0 ? challengeFacts(d.name, challenges) : null
          }
          label={t("challenge.argue")}
        />
      </div>
    </Disclosure>
  );
}

// --- Evidence memo -------------------------------------------------------------

function factLabel(t: TFunction, fact: MemoFact, locale: string): string {
  const value =
    typeof fact.value === "number"
      ? new Intl.NumberFormat(locale).format(fact.value)
      : fact.value;
  return `${t(`evidenceMemo.fact.${fact.key}`)}: ${value}`;
}

/**
 * AI note in which every figure was checked against the app's facts;
 * sentences with any other number are removed before display. Rendered only
 * with an AI provider: the facts themselves are in the dialog above.
 */
export function EvidenceMemoSection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const ready = useLlmReady();
  const parameters = useAppStore((s) => s.parameters);
  const facts = useMemo(() => memoFacts(d), [d]);
  const [memo, setMemo] = useState<EvidenceMemo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appendNote = useAppendNote(d);

  // A memo describes one result: clear it when the location changes.
  useEffect(() => {
    setMemo(null);
    setError(null);
  }, [d]);

  if (!ready || !d.risk) return null;

  async function write(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setMemo(
        await window.api.writeEvidenceMemo({ dealership: d, parameters }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const byId = new Map(facts.map((f) => [f.id, f]));
  const text = memo?.sentences.map((s) => s.text).join(" ") ?? "";

  return (
    <Disclosure
      title={t("dashboard.detailDialog.aiMemoGroup")}
      summary={t("aiInsight.optional")}
    >
      <div className="space-y-2 text-sm">
        <Button size="sm" variant="outline" disabled={busy} onClick={write}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {t("evidenceMemo.write")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("evidenceMemo.hint")}
        </p>
        {error && <LlmErrorMessage error={error} />}
        {memo && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            {memo.sentences.length === 0 ? (
              <p>{t("evidenceMemo.nothingLeft")}</p>
            ) : (
              <ul className="space-y-2">
                {memo.sentences.map((sentence, i) => (
                  <li key={i}>
                    {sentence.text}
                    {sentence.facts.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {t("evidenceMemo.basedOn")}{" "}
                        {sentence.facts
                          .map((id) => byId.get(id))
                          .filter((f): f is MemoFact => f != null)
                          .map((f) => factLabel(t, f, i18n.language))
                          .join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {memo.removed.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("evidenceMemo.removed", { count: memo.removed.length })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("evidenceMemo.disclaimer")}
            </p>
            {text && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void notify.copy(text, t("aiInsight.copied"))}
                >
                  <Copy /> {t("aiInsight.copy")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    appendNote(`${t("evidenceMemo.noteHeading")}\n${text}`)
                  }
                >
                  <NotebookPen /> {t("aiInsight.addToNotes")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Disclosure>
  );
}

// --- Aerial image check (vision) -----------------------------------------------

function CheckRow({
  check,
}: Readonly<{ check: SiteCheck }>): React.JSX.Element {
  const { t } = useTranslation();
  const f = check.findings;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {t("siteCheck.image", {
          label: check.imageLabel,
          date: check.imageCapturedAt ?? t("siteCheck.dateUnknown"),
        })}
      </p>
      {f.imageUsable ? (
        <div className="flex flex-wrap gap-1.5">
          {(["hailNet", "canopy", "parkingStructure"] as const).map((key) => (
            <Badge key={key} variant={f[key] === "yes" ? "default" : "outline"}>
              {t(`siteCheck.feature.${key}`)}: {t(`siteCheck.seen.${f[key]}`)}
            </Badge>
          ))}
          <Badge variant="outline">
            {t("siteCheck.openAir")}: {t(`siteCheck.share.${f.openAirShare}`)}
          </Badge>
        </div>
      ) : (
        <p>{t("siteCheck.unusable")}</p>
      )}
      {f.note && <p>{f.note}</p>}
    </div>
  );
}

/**
 * Optional AI look at the aerial image: visible hail protection, and a
 * second opinion on the lot boundary. Observations only; the vehicle count,
 * the boundary and the hail EAL stay as they are. Rendered only with an AI
 * provider.
 */
export function SiteCheckSection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element | null {
  const { t } = useTranslation();
  const ready = useLlmReady();
  const [result, setResult] = useState<SiteCheckResult | null>(null);
  const [opinion, setOpinion] = useState<BoundaryOpinion | null>(null);
  const [busy, setBusy] = useState<"check" | "history" | "boundary" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const appendNote = useAppendNote(d);

  useEffect(() => {
    setResult(null);
    setOpinion(null);
    setError(null);
  }, [d.id, d.boundary]);

  if (!ready) return null;

  async function run(history: boolean): Promise<void> {
    setBusy(history ? "history" : "check");
    setError(null);
    try {
      setResult(
        await window.api.checkSite({
          lat: d.lat,
          lon: d.lon,
          boundary: d.boundary,
          history,
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function askBoundary(): Promise<void> {
    if (!d.boundary) return;
    setBusy("boundary");
    setError(null);
    try {
      setOpinion(
        await window.api.boundaryOpinion({
          lat: d.lat,
          lon: d.lon,
          boundary: d.boundary,
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const since = result ? featuresSince(result) : [];
  function noteText(r: SiteCheckResult): string {
    const f = r.current.findings;
    return [
      t("siteCheck.noteHeading", {
        date: r.current.imageCapturedAt ?? t("siteCheck.dateUnknown"),
        model: r.current.model,
      }),
      ...(["hailNet", "canopy", "parkingStructure"] as const).map(
        (key) =>
          `${t(`siteCheck.feature.${key}`)}: ${t(`siteCheck.seen.${f[key]}`)}`,
      ),
      f.note,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return (
    <Disclosure title={t("siteCheck.title")} summary={t("aiInsight.optional")}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("siteCheck.description")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void run(false)}
          >
            {busy === "check" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <ScanSearch />
            )}
            {t("siteCheck.run")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void run(true)}
          >
            {busy === "history" && <Loader2 className="animate-spin" />}
            {t("siteCheck.runHistory")}
          </Button>
          {d.boundary && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void askBoundary()}
            >
              {busy === "boundary" && <Loader2 className="animate-spin" />}
              {t("siteCheck.boundaryOpinion")}
            </Button>
          )}
        </div>
        {error && <LlmErrorMessage error={error} />}

        {result && (
          <div className="space-y-3 rounded-md border bg-muted/40 p-3">
            <CheckRow check={result.current} />
            {since.map((s) => (
              <p key={s.feature}>
                {s.absentOn
                  ? t("siteCheck.sinceBetween", {
                      feature: t(`siteCheck.feature.${s.feature}`),
                      since: s.seenSince ?? t("siteCheck.dateUnknown"),
                      absent: s.absentOn,
                    })
                  : t("siteCheck.sinceAtLeast", {
                      feature: t(`siteCheck.feature.${s.feature}`),
                      since: s.seenSince ?? t("siteCheck.dateUnknown"),
                    })}
              </p>
            ))}
            {result.history.length > 0 && (
              <details>
                <summary className="text-xs text-muted-foreground">
                  {t("siteCheck.olderImages", { count: result.history.length })}
                </summary>
                <div className="mt-2 space-y-2">
                  {result.history.map((check) => (
                    <CheckRow
                      key={`${check.imageLabel}-${check.imageCapturedAt}`}
                      check={check}
                    />
                  ))}
                </div>
              </details>
            )}
            <p className="text-xs text-muted-foreground">
              {t("siteCheck.disclaimer", { model: result.current.model })}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => appendNote(noteText(result))}
            >
              <NotebookPen /> {t("aiInsight.addToNotes")}
            </Button>
          </div>
        )}

        {opinion && (
          <div className="space-y-1 rounded-md border bg-muted/40 p-3">
            <p>
              <Badge
                variant={
                  opinion.verdict === "plausible" ? "outline" : "secondary"
                }
              >
                {t(`siteCheck.verdict.${opinion.verdict}`)}
              </Badge>
            </p>
            {opinion.note && <p>{opinion.note}</p>}
            <p className="text-xs text-muted-foreground">
              {t("siteCheck.boundaryDisclaimer", { model: opinion.model })}
            </p>
          </div>
        )}
      </div>
    </Disclosure>
  );
}

// --- Dealership reply → answers -----------------------------------------------

/**
 * Paste the dealership's reply; the AI assigns passages to the questions
 * asked. Only answers whose quote is literally in the reply are shown.
 * Rendered only with an AI provider.
 */
export function QuestionnaireAnswersSection({
  d,
  questions,
}: Readonly<{
  d: AnalyzedDealership;
  questions: Question[];
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const ready = useLlmReady();
  const [reply, setReply] = useState("");
  const [answers, setAnswers] = useState<QuestionnaireAnswer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appendNote = useAppendNote(d);

  if (!ready) return null;

  async function extract(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.extractQuestionnaireAnswers({
        questions: questions.map((q) => ({
          id: q.id,
          text: t(`questionnaire.q.${q.id}`, q.values ?? {}),
        })),
        reply,
      });
      setAnswers(result.answers);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const noteText = (list: QuestionnaireAnswer[]): string =>
    [
      t("questionnaire.answers.noteHeading"),
      ...list.map(
        (a) =>
          `- ${t(`questionnaire.q.${a.questionId}`, questions.find((q) => q.id === a.questionId)?.values ?? {})}\n  ${a.answer} („${a.quote}“)`,
      ),
    ].join("\n");

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        {t("questionnaire.answers.description")}
      </p>
      <Textarea
        value={reply}
        maxLength={REPLY_MAX_CHARS}
        rows={4}
        placeholder={t("questionnaire.answers.placeholder")}
        aria-label={t("questionnaire.answers.placeholder")}
        onChange={(e) => {
          setReply(e.target.value);
          setAnswers(null);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || reply.trim().length < 20}
        onClick={() => void extract()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {t("questionnaire.answers.extract")}
      </Button>
      {error && <LlmErrorMessage error={error} />}
      {answers && answers.length === 0 && (
        <p className="text-sm">{t("questionnaire.answers.none")}</p>
      )}
      {answers && answers.length > 0 && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
          <ul className="space-y-2">
            {answers.map((a) => (
              <li key={a.questionId}>
                <span className="block text-xs text-muted-foreground">
                  {t(
                    `questionnaire.q.${a.questionId}`,
                    questions.find((q) => q.id === a.questionId)?.values ?? {},
                  )}
                </span>
                {a.answer}
                <span className="block text-xs italic text-muted-foreground">
                  „{a.quote}“
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("questionnaire.answers.disclaimer")}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => appendNote(noteText(answers))}
          >
            <NotebookPen /> {t("aiInsight.addToNotes")}
          </Button>
        </div>
      )}
    </div>
  );
}
