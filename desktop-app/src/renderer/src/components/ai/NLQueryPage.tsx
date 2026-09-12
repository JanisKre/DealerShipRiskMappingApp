import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import { buildSessionContext } from "@renderer/lib/sessionContext";
import { useLlmStream } from "@renderer/lib/useLlmStream";
import { toNlQueryDealership, useAppStore } from "@renderer/store/appStore";
import { Markdown } from "./ExecutiveSummary";

const EXAMPLE_KEYS = [
  "ai.exampleHighHail",
  "ai.exampleUtilisation",
  "ai.exampleEal",
] as const;

/**
 * Natural-language query (2-phase): phase 1 extracts a filter JSON and
 * returns matching IDs (applied deterministically in the main process);
 * phase 2 streams a summary. Matches can be carried over into the dashboard.
 */
export function NLQueryPage(): React.JSX.Element {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const setNlQueryMatchedIds = useAppStore((s) => s.setNlQueryMatchedIds);
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const { text, streaming, error, matchedIds, start } = useLlmStream();
  const [asked, setAsked] = useState(false);

  function ask(q?: string): void {
    const query = (q ?? question).trim();
    if (!query || dealerships.length === 0) return;
    setQuestion(query);
    setAsked(true);
    start({
      kind: "nlquery",
      question: query,
      dealerships: dealerships.map(toNlQueryDealership),
      sessionContext: buildSessionContext(dealerships),
    });
  }

  function showInDashboard(): void {
    if (matchedIds) setNlQueryMatchedIds(matchedIds);
    navigate("/dashboard");
  }

  const matchedNames =
    matchedIds
      ?.map((id) => dealerships.find((d) => d.id === id)?.name)
      .filter((n): n is string => Boolean(n)) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("ai.naturalLanguageQuery")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder={t("ai.queryInputPlaceholder")}
              disabled={dealerships.length === 0}
            />
            <Button
              onClick={() => ask()}
              disabled={streaming || !question.trim()}
            >
              {streaming ? <Loader2 className="animate-spin" /> : <Search />}{" "}
              {t("ai.ask")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_KEYS.map((key) => {
              const example = t(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => ask(example)}
                  disabled={streaming || dealerships.length === 0}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  {example}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {asked && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {t("ai.result")}
              {matchedIds && (
                <Badge variant="secondary" className="ml-2">
                  {t("ai.matches", { count: matchedIds.length })}
                </Badge>
              )}
            </CardTitle>
            {matchedIds && matchedIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={showInDashboard}>
                {t("ai.showInDashboard")} <ArrowRight />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <p className="text-sm text-destructive">
                {t("ui.error", { error })}
              </p>
            )}
            {matchedNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {matchedNames.map((n) => (
                  <Badge key={n} variant="outline">
                    {n}
                  </Badge>
                ))}
              </div>
            )}
            <Markdown text={text} />
            {streaming && (
              <span className="text-xs text-muted-foreground">
                {t("ui.answering")}
              </span>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
