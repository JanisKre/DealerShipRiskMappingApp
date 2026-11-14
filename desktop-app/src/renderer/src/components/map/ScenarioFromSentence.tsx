import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import type { HailstormScenario } from "@shared/types";
import { scenarioFromDraft, type ScenarioDraft } from "@shared/scenario-draft";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { useAppStore } from "@renderer/store/appStore";
import {
  PANEL_ACTION_CLASS,
  PANEL_CONTROL_CLASS,
  PANEL_HINT_CLASS,
} from "./panelStyles";

/** Model version of drawn and drafted scenarios alike. */
export const SCENARIO_MODEL_VERSION = "scenario-screening-0.2.0";

/**
 * Optional: describe a hailstorm in one sentence instead of drawing it. The
 * AI extracts places, width and intensity; the app geocodes the places and
 * shows the draft, which is applied only on "Apply" and can then be edited
 * like a drawn corridor. Rendered only when an AI provider is set up.
 */
export function ScenarioFromSentence(): React.JSX.Element {
  const { t } = useTranslation();
  const scenario = useAppStore((s) => s.scenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    draft: ScenarioDraft;
    scenario: HailstormScenario;
    labels: string[];
  } | null>(null);

  async function run(): Promise<void> {
    const description = text.trim();
    if (description.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const result = await window.api.draftScenario({
        description,
        fallbackName: t("map.page.defaultScenarioName"),
      });
      const found = await Promise.all(
        result.places.map((place) =>
          window.api
            .geocode(place)
            .then((hits) => hits[0] ?? null)
            .catch(() => null),
        ),
      );
      const built = scenarioFromDraft(result, found, {
        id: scenario?.id ?? crypto.randomUUID(),
        modelVersion: SCENARIO_MODEL_VERSION,
      });
      if ("missing" in built) {
        setError(
          t("scenarioDraft.notFound", { places: built.missing.join(", ") }),
        );
        return;
      }
      setDraft({
        draft: result,
        scenario: built.scenario,
        labels: found.map((hit, i) => hit?.label ?? result.places[i]),
      });
    } catch (err) {
      setError(
        t("scenarioDraft.failed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 border-t pt-2.5">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input
          className={`${PANEL_CONTROL_CLASS} flex-1`}
          value={text}
          maxLength={500}
          placeholder={t("scenarioDraft.placeholder")}
          aria-label={t("scenarioDraft.label")}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className={PANEL_ACTION_CLASS}
          disabled={busy || text.trim().length < 3}
          title={t("scenarioDraft.hint")}
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {t("scenarioDraft.run")}
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {draft && (
        <div className="space-y-1.5 rounded-md border bg-muted/40 p-2 text-xs">
          <div className="font-medium">{draft.draft.name}</div>
          <div className="text-muted-foreground">
            {draft.labels.join(" → ")}
          </div>
          <div className="text-muted-foreground">
            {t("scenarioDraft.summary", {
              width: draft.draft.widthKm,
              intensity: t(`risk.${draft.draft.intensityLevel}`),
            })}
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className={PANEL_ACTION_CLASS}
              onClick={() => {
                setScenario(draft.scenario);
                setDraft(null);
                setText("");
              }}
            >
              <Check className="size-3" />
              {t("scenarioDraft.apply")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={PANEL_ACTION_CLASS}
              onClick={() => setDraft(null)}
            >
              <X className="size-3" />
              {t("scenarioDraft.discard")}
            </Button>
          </div>
        </div>
      )}
      {!draft && !error && (
        <p className={PANEL_HINT_CLASS}>{t("scenarioDraft.hint")}</p>
      )}
    </div>
  );
}
