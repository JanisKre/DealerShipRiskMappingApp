import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, Square } from "lucide-react";
import type { LlmStreamRequest } from "@shared/ipc-schema";
import { Button } from "@renderer/components/ui/button";
import { useLlmReady } from "@renderer/lib/useLlmReady";
import { useLlmStream } from "@renderer/lib/useLlmStream";
import { LlmErrorMessage } from "./LlmSetupNotice";
import { Markdown } from "./Markdown";

type ExplainTopic = Extract<LlmStreamRequest, { kind: "explain" }>["topic"];

/**
 * Optional AI explanation under a result the app computed. Without an AI
 * provider nothing is rendered: the result above stands on its own. The
 * explanation is cleared whenever the facts change, so it never describes
 * an older result.
 */
export function AiExplanation({
  topic,
  facts,
  label,
  className,
}: Readonly<{
  topic: ExplainTopic;
  /** Facts computed by the app; null while there is nothing to explain. */
  facts: string | null;
  label: string;
  className?: string;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const ready = useLlmReady();
  const { text, streaming, error, start, cancel, reset } = useLlmStream();

  useEffect(() => reset(), [facts, reset]);

  if (!ready || !facts) return null;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={streaming}
          onClick={() => start({ kind: "explain", topic, facts })}
        >
          {streaming ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {label}
        </Button>
        {streaming && (
          <Button variant="ghost" size="sm" onClick={cancel}>
            <Square /> {t("ai.explain.stop")}
          </Button>
        )}
      </div>
      {error && <LlmErrorMessage error={error} className="mt-2" />}
      {text && (
        <div className="mt-2 rounded-md border bg-muted/40 p-3">
          <Markdown text={text} />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("ai.explain.disclaimer")}
          </p>
        </div>
      )}
    </div>
  );
}
