import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2 } from "lucide-react";
import type { AnalyzedDealership, StructuredMemo } from "@shared/types";
import { LlmErrorMessage } from "@renderer/components/ai/LlmSetupNotice";
import { Button } from "@renderer/components/ui/button";
import { eur } from "@renderer/lib/format";
import { Metric } from "./shared";

export function AiSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const [memo, setMemo] = useState<StructuredMemo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function genMemo(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setMemo(await window.api.llmMemo(d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={genMemo} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <FileText />}{" "}
          {t("ai.memo")}
        </Button>
      </div>

      {error && (
        <LlmErrorMessage
          error={error}
          className="text-sm"
          format={(e) => t("dashboard.detailDialog.errorPrefix", { error: e })}
        />
      )}

      {memo && (
        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label={t("dashboard.detailDialog.recommendedDeductibleLabel")}
              value={eur(memo.recommendedDeductibleEur)}
            />
            <Metric
              label={t("dashboard.detailDialog.premiumLoadingLabel")}
              value={`${memo.suggestedPremiumLoadingPct.toFixed(0)} %`}
            />
          </div>
          {memo.sublimitNotes.length > 0 && (
            <ul className="list-inside list-disc text-muted-foreground">
              {memo.sublimitNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <p>{memo.reasoning}</p>
        </div>
      )}
    </div>
  );
}
