import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import {
  buildQuestionnaire,
  type Question,
} from "@shared/dealer-questionnaire";
import { AiExplanation } from "@renderer/components/ai/AiExplanation";
import { Button } from "@renderer/components/ui/button";

/** Plain text of the questionnaire: a greeting line and numbered questions. */
export function questionnaireText(
  t: TFunction,
  name: string,
  questions: Question[],
): string {
  return [
    t("questionnaire.intro", { name }),
    "",
    ...questions.map(
      (q, i) => `${i + 1}. ${t(`questionnaire.q.${q.id}`, q.values ?? {})}`,
    ),
  ].join("\n");
}

/**
 * Questions for the dealership, picked by fixed rules from what is missing
 * or uncertain here (estimated stock, high hail zone, boundary to check, old
 * image). Copied as text; the app sends nothing. With an AI provider, the
 * same questions can be reworded into a short message.
 */
export function QuestionnaireSection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element {
  const { t } = useTranslation();
  const questions = useMemo(() => buildQuestionnaire(d), [d]);
  const text = questionnaireText(t, d.name, questions);

  async function copy(value: string): Promise<void> {
    try {
      await window.api.writeClipboardText(value);
      toast.success(t("questionnaire.copied"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        {t("questionnaire.description")}
      </p>
      <ol className="list-decimal space-y-1.5 pl-5">
        {questions.map((q) => (
          <li key={q.id}>
            {t(`questionnaire.q.${q.id}`, q.values ?? {})}
            <span className="block text-xs text-muted-foreground">
              {t(`questionnaire.why.${q.why}`)}
            </span>
          </li>
        ))}
      </ol>
      <Button variant="outline" size="sm" onClick={() => void copy(text)}>
        <Copy /> {t("questionnaire.copy")}
      </Button>
      <AiExplanation
        topic="questionnaire"
        facts={`Dealership: ${d.name}\n\n${text}`}
        label={t("questionnaire.reword")}
      />
    </div>
  );
}
