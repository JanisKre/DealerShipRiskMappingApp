import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, PlugZap } from "lucide-react";
import type { Settings } from "@shared/types";
import {
  DECISION_ENGINE_CHOICES,
  GOOGLE_DECISIONS_DEFAULT_MODEL,
  LOCAL_DECISION_MODELS,
  OLLAMA_DEFAULT_ORIGIN,
  OPENAI_DECISIONS_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_BASE_URL,
  SYSTEMONE_DEFAULT_MODEL,
  type DecisionEngineChoice,
  type DecisionSettings,
} from "@shared/decision-engines";
import {
  calibrate,
  type CalibrationRow,
  type DecisionEngine,
  type ThresholdTable,
} from "@shared/site-questions";
import type { OllamaPullChunk } from "@shared/ipc-schema";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { notify } from "@renderer/lib/notify";
import { useAppStore } from "@renderer/store/appStore";
import { useDecisionStore } from "@renderer/store/decisionStore";

type UpdateSettings = (partial: Partial<Settings>) => Promise<void>;

/** Installed under its name, or with Ollama's ":latest" added. */
function isInstalled(name: string, installed: readonly string[]): boolean {
  return installed.some(
    (m) => m === name || m === `${name}:latest` || m.split(":")[0] === name,
  );
}

function TextSetting({
  label,
  hint,
  value,
  placeholder,
  onSave,
}: Readonly<{
  label: string;
  hint?: string;
  value: string | undefined;
  placeholder: string;
  onSave: (value: string) => Promise<void>;
}>): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <Input
        value={draft}
        placeholder={placeholder}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() !== (value ?? "")) void onSave(draft.trim());
        }}
      />
      {hint && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

function KeySetting({
  kind,
  present,
  onSaved,
}: Readonly<{
  kind: "google" | "systemone";
  present: boolean | undefined;
  onSaved: () => Promise<void>;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  async function save(value: string): Promise<void> {
    try {
      await window.api.setDecisionKey(kind, value);
      setDraft("");
      await onSaved();
      notify.success(
        value
          ? t("siteQuestions.settings.keySaved")
          : t("siteQuestions.settings.keyRemoved"),
      );
    } catch (error) {
      notify.failed(error, t("common.saveFailed"));
    }
  }
  return (
    <div className="space-y-1">
      <span className="text-sm font-medium">
        {t("siteQuestions.settings.apiKey")}
      </span>
      <div className="flex gap-2">
        <Input
          type="password"
          value={draft}
          autoComplete="off"
          placeholder={
            present
              ? t("siteQuestions.settings.keyStored")
              : t("siteQuestions.settings.keyMissing")
          }
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={!draft.trim()}
          onClick={() => void save(draft)}
        >
          {t("common.save")}
        </Button>
        {present && (
          <Button variant="ghost" onClick={() => void save("")}>
            {t("siteQuestions.settings.removeKey")}
          </Button>
        )}
      </div>
    </div>
  );
}

type PullState = {
  model: string;
  chunk: OllamaPullChunk | null;
  error?: string;
} | null;

/** Open-weight decision models in a local Ollama: choose and download. */
function LocalModels({
  decisions,
  onUpdate,
}: Readonly<{
  decisions: DecisionSettings | undefined;
  onUpdate: (patch: Partial<DecisionSettings>) => Promise<void>;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<{
    reachable: boolean;
    installed: string[];
  } | null>(null);
  const [pull, setPull] = useState<PullState>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  async function refresh(): Promise<void> {
    setState(await window.api.localDecisionModels().catch(() => null));
  }
  useEffect(() => {
    void refresh();
    return () => cancelRef.current?.();
  }, [decisions?.ollamaBaseUrl]);

  function install(model: string): void {
    cancelRef.current?.();
    setPull({ model, chunk: null });
    cancelRef.current = window.api.pullOllamaModel(model, (chunk) => {
      if (chunk.type === "done") {
        cancelRef.current = null;
        setPull(null);
        void refresh();
        void onUpdate({ ollamaModel: model });
        notify.success(t("siteQuestions.settings.installed", { model }));
      } else if (chunk.type === "error") {
        cancelRef.current = null;
        setPull({ model, chunk, error: chunk.message });
      } else {
        setPull({ model, chunk });
      }
    });
  }

  const installed = state?.installed ?? [];
  const others = installed.filter(
    (m) => !LOCAL_DECISION_MODELS.some((r) => isInstalled(r.name, [m])),
  );

  return (
    <div className="space-y-3">
      <TextSetting
        label={t("siteQuestions.settings.ollamaUrl")}
        hint={t("siteQuestions.settings.ollamaUrlHint")}
        value={decisions?.ollamaBaseUrl}
        placeholder={OLLAMA_DEFAULT_ORIGIN}
        onSave={(ollamaBaseUrl) => onUpdate({ ollamaBaseUrl })}
      />
      {state && !state.reachable && (
        <p className="text-xs text-destructive">
          {t("siteQuestions.settings.ollamaUnreachable")}
        </p>
      )}
      <ul className="space-y-2">
        {LOCAL_DECISION_MODELS.map((m) => {
          const has = isInstalled(m.name, installed);
          const chosen = decisions?.ollamaModel === m.name;
          const running = pull?.model === m.name && !pull.error;
          const progress =
            running && pull.chunk?.type === "progress" && pull.chunk.totalBytes
              ? Math.round(
                  ((pull.chunk.completedBytes ?? 0) / pull.chunk.totalBytes) *
                    100,
                )
              : null;
          return (
            <li
              key={m.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {m.label}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {m.name}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`siteQuestions.settings.modelNote.${m.note}`, {
                    size: m.sizeGb,
                    licence: m.licence,
                  })}
                </p>
                {pull?.model === m.name && pull.error && (
                  <p className="text-xs text-destructive">{pull.error}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {chosen && <Badge>{t("siteQuestions.settings.chosen")}</Badge>}
                {has ? (
                  !chosen && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onUpdate({ ollamaModel: m.name })}
                    >
                      {t("siteQuestions.settings.use")}
                    </Button>
                  )
                ) : running ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      cancelRef.current?.();
                      cancelRef.current = null;
                      setPull(null);
                    }}
                  >
                    <Loader2 className="animate-spin" />
                    {progress != null ? `${progress} %` : ""}{" "}
                    {t("common.cancel")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={state?.reachable === false || pull != null}
                    onClick={() => install(m.name)}
                  >
                    <Download />
                    {t("siteQuestions.settings.download", { size: m.sizeGb })}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <TextSetting
        label={t("siteQuestions.settings.ollamaModel")}
        hint={
          others.length > 0
            ? t("siteQuestions.settings.otherInstalled", {
                models: others.slice(0, 8).join(", "),
              })
            : t("siteQuestions.settings.ollamaModelHint")
        }
        value={decisions?.ollamaModel}
        placeholder="d1:2b"
        onSave={(ollamaModel) => onUpdate({ ollamaModel })}
      />
    </div>
  );
}

function fmt(value: number | null, locale: string, percent = false): string {
  if (value == null) return "–";
  return new Intl.NumberFormat(locale, {
    style: percent ? "percent" : "decimal",
    maximumFractionDigits: percent ? 0 : 3,
  }).format(value);
}

/**
 * The engines compared with the underwriter's and the dealer's answers in
 * the open portfolio; measured thresholds can be taken over per engine.
 */
function Calibration({
  thresholds,
  onSave,
}: Readonly<{
  thresholds: ThresholdTable | undefined;
  onSave: (next: ThresholdTable) => Promise<void>;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const rows = useMemo(() => calibrate(dealerships), [dealerships]);
  const byKey = useMemo(() => {
    const map = new Map<string, CalibrationRow[]>();
    for (const row of rows)
      map.set(row.key, [...(map.get(row.key) ?? []), row]);
    return map;
  }, [rows]);

  async function adopt(key: string, list: CalibrationRow[]): Promise<void> {
    const measured = Object.fromEntries(
      list.flatMap((r) => (r.suggested ? [[r.question, r.suggested]] : [])),
    );
    await onSave({ ...thresholds, [key]: measured });
  }

  async function reset(key: string): Promise<void> {
    const next = { ...thresholds };
    delete next[key];
    await onSave(next);
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">
        {t("siteQuestions.settings.calibrationTitle")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("siteQuestions.settings.calibrationHint")}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("siteQuestions.settings.calibrationEmpty")}
        </p>
      ) : (
        [...byKey].map(([key, list]) => {
          const measured = thresholds?.[key];
          const canAdopt = list.some((r) => r.suggested);
          return (
            <div key={key} className="space-y-2 rounded-md border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {t(`siteQuestions.engine.${list[0].engine}`)}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {list[0].model}
                  </span>
                </p>
                <div className="flex gap-2">
                  {measured && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void reset(key)}
                    >
                      {t("siteQuestions.settings.resetThresholds")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canAdopt}
                    onClick={() => void adopt(key, list)}
                  >
                    {t("siteQuestions.settings.adoptThresholds")}
                  </Button>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("siteQuestions.settings.question")}
                    </TableHead>
                    <TableHead>{t("siteQuestions.settings.labels")}</TableHead>
                    <TableHead>{t("siteQuestions.settings.brier")}</TableHead>
                    <TableHead>
                      {t("siteQuestions.settings.accuracy")}
                    </TableHead>
                    <TableHead>{t("siteQuestions.settings.unclear")}</TableHead>
                    <TableHead>
                      {t("siteQuestions.settings.suggested")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => (
                    <TableRow key={r.question}>
                      <TableCell>
                        {t(`siteQuestions.short.${r.question}`)}
                      </TableCell>
                      <TableCell>
                        {t("siteQuestions.settings.labelCount", {
                          n: r.n,
                          yes: r.positives,
                        })}
                      </TableCell>
                      <TableCell>{fmt(r.brier, i18n.language)}</TableCell>
                      <TableCell>
                        {fmt(r.accuracyDefault, i18n.language, true)}
                      </TableCell>
                      <TableCell>
                        {fmt(r.unclearDefault, i18n.language, true)}
                      </TableCell>
                      <TableCell>
                        {r.suggested
                          ? t("siteQuestions.settings.thresholdPair", {
                              yes: fmt(r.suggested.yes, i18n.language, true),
                              no: fmt(r.suggested.no, i18n.language, true),
                            })
                          : t("siteQuestions.settings.tooFewLabels")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {measured && (
                <p className="text-xs text-muted-foreground">
                  {t("siteQuestions.settings.measuredInUse")}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Settings of the site questions: which engine answers (a decision API,
 * an open-weight model in Ollama, or the AI model above), its address,
 * model and key, a test, and the comparison with the user's own answers.
 */
export function SiteQuestionsSettingsCard({
  settings,
  onUpdate,
}: Readonly<{
  settings: Settings;
  onUpdate: UpdateSettings;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const decisions = settings.decisions;
  const choice: DecisionEngineChoice = decisions?.engine ?? "auto";
  const resolved = useDecisionStore((s) => s.engine);
  const resolvedModel = useDecisionStore((s) => s.model);
  const local = useDecisionStore((s) => s.local);
  const load = useDecisionStore((s) => s.load);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load, settings.decisions, settings.llm]);

  async function update(patch: Partial<DecisionSettings>): Promise<void> {
    await onUpdate({
      decisions: { engine: "auto", ...decisions, ...patch },
    });
    await load();
  }

  const engine: DecisionEngine | null = choice === "auto" ? resolved : choice;

  async function runTest(): Promise<void> {
    if (!engine) return;
    setTesting(true);
    setTest(null);
    try {
      const result = await window.api.testDecisionEngine(engine);
      setTest(
        result.ok
          ? result.probability == null
            ? t("siteQuestions.settings.testOkNoProbability", {
                model: result.model,
              })
            : t("siteQuestions.settings.testOk", {
                model: result.model,
                p: Math.round(result.probability * 100),
              })
          : t("siteQuestions.settings.testFailed", {
              error: result.error ?? "",
            }),
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("siteQuestions.settings.title")}</CardTitle>
        <CardDescription>
          {t("siteQuestions.settings.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">
            {t("siteQuestions.settings.engine")}
          </span>
          <Select
            value={choice}
            onValueChange={(v) =>
              void update({ engine: v as DecisionEngineChoice })
            }
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DECISION_ENGINE_CHOICES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`siteQuestions.choice.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <p className="text-xs text-muted-foreground">
          {resolved
            ? t(
                local
                  ? "siteQuestions.settings.answersLocal"
                  : "siteQuestions.settings.answersRemote",
                {
                  engine: t(`siteQuestions.engine.${resolved}`),
                  model: resolvedModel,
                },
              )
            : t("siteQuestions.settings.noEngine")}
        </p>

        {engine === "openai" && (
          <TextSetting
            label={t("siteQuestions.settings.model")}
            hint={t("siteQuestions.settings.openaiHint")}
            value={decisions?.openaiModel}
            placeholder={OPENAI_DECISIONS_DEFAULT_MODEL}
            onSave={(openaiModel) => update({ openaiModel })}
          />
        )}
        {engine === "google" && (
          <>
            <TextSetting
              label={t("siteQuestions.settings.model")}
              hint={t("siteQuestions.settings.googleHint")}
              value={decisions?.googleModel}
              placeholder={GOOGLE_DECISIONS_DEFAULT_MODEL}
              onSave={(googleModel) => update({ googleModel })}
            />
            <KeySetting
              kind="google"
              present={decisions?.hasGoogleKey}
              onSaved={() => update({})}
            />
          </>
        )}
        {engine === "systemone" && (
          <>
            <TextSetting
              label={t("siteQuestions.settings.serverUrl")}
              hint={t("siteQuestions.settings.systemoneHint")}
              value={decisions?.systemoneBaseUrl}
              placeholder={SYSTEMONE_DEFAULT_BASE_URL}
              onSave={(systemoneBaseUrl) =>
                update({ systemoneBaseUrl }).catch((error: unknown) =>
                  notify.failed(error, t("common.saveFailed")),
                )
              }
            />
            <TextSetting
              label={t("siteQuestions.settings.model")}
              value={decisions?.systemoneModel}
              placeholder={SYSTEMONE_DEFAULT_MODEL}
              onSave={(systemoneModel) => update({ systemoneModel })}
            />
            <KeySetting
              kind="systemone"
              present={decisions?.hasSystemoneKey}
              onSaved={() => update({})}
            />
          </>
        )}
        {engine === "ollama" && (
          <LocalModels
            decisions={decisions}
            onUpdate={(patch) =>
              update(patch).catch((error: unknown) =>
                notify.failed(error, t("common.saveFailed")),
              )
            }
          />
        )}
        {engine === "llm" && (
          <p className="text-xs text-muted-foreground">
            {t("siteQuestions.settings.llmHint")}
          </p>
        )}
        {choice === "auto" && engine !== "ollama" && (
          <p className="text-xs text-muted-foreground">
            {t("siteQuestions.settings.openSourceHint")}
          </p>
        )}

        {engine && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={testing}
              onClick={() => void runTest()}
            >
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {t("siteQuestions.settings.test")}
            </Button>
            {test && <span className="text-xs">{test}</span>}
          </div>
        )}

        <Calibration
          thresholds={decisions?.thresholds}
          onSave={(thresholds) =>
            update({ thresholds }).then(() =>
              notify.success(t("siteQuestions.settings.thresholdsSaved")),
            )
          }
        />
      </CardContent>
    </Card>
  );
}
