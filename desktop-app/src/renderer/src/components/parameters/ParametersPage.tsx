import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { notify } from "@renderer/lib/notify";
import type { RiskParameters } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { useAppStore } from "@renderer/store/appStore";
import { PageErrorBoundary } from "@renderer/components/common/PageErrorBoundary";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@renderer/components/ui/alert";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Card } from "@renderer/components/ui/card";
import { HintButton } from "@renderer/components/ui/hint-button";
import { TileInfo } from "@renderer/components/dashboard/TileInfo";
import {
  formatParameterValue,
  fromPercentDisplay,
  parameterInputError,
  parseLocaleNumber,
} from "./parameterInput";
import {
  GROUPS,
  type ParameterField,
  type ParameterKey,
  displayRule,
  displayValue,
  hiddenField,
  isPercent,
  unitKey,
} from "./parameterFields";
import {
  type EditorBindings,
  HailEalNotice,
  HailEalTables,
} from "./HailEalTables";
import { NativeDetails, ParameterEditor, ResetDialog } from "./ParameterEditor";
import { ImpactBar } from "./ImpactBar";
import { TemplateControls } from "./TemplateControls";

export function ParametersPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <PageErrorBoundary
      area="Parameters page"
      title={t("parameters.loadErrorTitle")}
      description={t("parameters.loadErrorDescription")}
      retry={t("parameters.retry")}
    >
      <ParametersContent />
    </PageErrorBoundary>
  );
}

function ParametersContent(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const parameters = useAppStore((s) => s.parameters);
  const parametersUpdating = useAppStore((s) => s.parametersUpdating);
  const updateParameters = useAppStore((s) => s.updateParameters);
  const resetParameters = useAppStore((s) => s.resetParameters);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Partial<Record<ParameterKey, string>>>(
    {},
  );
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          displayValue(key as ParameterKey, value, locale),
        ]),
      ),
    );
  }, [parameters, locale]);
  function setError(key: ParameterKey, message?: string): void {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }
  function revertDraft(field: ParameterField): void {
    setError(field.key);
    setDraft((current) => ({
      ...current,
      [field.key]: displayValue(field.key, parameters[field.key], locale),
    }));
  }
  function ruleText(shown: ParameterField): string {
    const field = displayRule(shown);
    const fmt = (n: number): string => formatParameterValue(n, locale);
    if (field.max == null)
      return t("parameters.validation.atLeast", { min: fmt(field.min) });
    return t(
      field.integer
        ? "parameters.validation.wholeBetween"
        : "parameters.validation.between",
      { min: fmt(field.min), max: fmt(field.max) },
    );
  }
  async function commitValue(
    field: ParameterField,
    raw: string,
  ): Promise<void> {
    const error = parameterInputError(raw, displayRule(field), locale);
    if (error) {
      // Keep what was typed and say, at this field, why it was not taken;
      // Escape restores the stored value.
      setError(
        field.key,
        t(`parameters.validation.${error}`, {
          label: fieldLabel(field),
          rule: ruleText(field),
          value: displayValue(field.key, parameters[field.key], locale),
        }),
      );
      return;
    }
    setError(field.key);
    const typed = parseLocaleNumber(raw, locale);
    const value = isPercent(field) ? fromPercentDisplay(typed) : typed;
    // Unchanged ("30000" for 30.000): show it in the usual notation again.
    if (value === parameters[field.key]) {
      revertDraft(field);
      return;
    }
    // One vehicle value on the page: the hidden default follows it.
    const patch = {
      [field.key]: value,
      ...(field.key === "vehicleValueCarEur" &&
      parameters.vehicleValueDefaultEur === parameters.vehicleValueCarEur
        ? { vehicleValueDefaultEur: value }
        : {}),
    } as Partial<RiskParameters>;
    try {
      await updateParameters(patch);
    } catch (err) {
      setError(
        field.key,
        t("parameters.validation.rejected", {
          label: fieldLabel(field),
          error: (err as Error).message,
        }),
      );
    }
  }
  const changedFromDefaults = (
    Object.keys(DEFAULT_RISK_PARAMETERS) as ParameterKey[]
  ).filter((key) => parameters[key] !== DEFAULT_RISK_PARAMETERS[key]).length;
  function requestReset(): void {
    if (changedFromDefaults === 0) {
      notify.info(t("parameters.resetNothing"));
      return;
    }
    setConfirmReset(true);
  }
  async function reset(): Promise<void> {
    setConfirmReset(false);
    const previous = parameters;
    await resetParameters();
    notify.success(t("parameters.resetDone"), {
      action: {
        label: t("parameters.resetUndo"),
        onClick: () => void updateParameters(previous),
      },
    });
  }
  const fieldLabel = (field: ParameterField): string =>
    t(`parameters.parameterFields.${field.key}.label`);
  const fieldDescription = (field: ParameterField): string =>
    t(`parameters.parameterFields.${field.key}.description`);
  const bindings: EditorBindings = {
    parameters,
    draft,
    disabled: parametersUpdating,
    label: fieldLabel,
    onDraftChange: (key, value) =>
      setDraft((current) => ({ ...current, [key]: value })),
    onCommit: (field, raw) => void commitValue(field, raw),
    errors,
    onRevert: revertDraft,
    locale,
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      {/* Changes autosave (header: "Automatisch gespeichert · …"), so the
          page has no Save button; only the recalculation state and reset. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{t("parameters.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("parameters.description")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {parametersUpdating && (
            <Badge variant="secondary">
              <Loader2 className="mr-1 size-3 animate-spin" />
              {t("parameters.recalculating")}
            </Badge>
          )}
          <TemplateControls disabled={parametersUpdating} />
          <Button
            variant="outline"
            onClick={requestReset}
            disabled={parametersUpdating}
          >
            <RotateCcw className="mr-2 size-4" />
            {t("parameters.reset")}
          </Button>
        </div>
      </div>
      <Alert variant="info">
        <AlertTitle>{t("parameters.startHereTitle")}</AlertTitle>
        <AlertDescription>
          {t("parameters.startHereDescription")}
        </AlertDescription>
        <AlertDescription>{t("parameters.fractionHint")}</AlertDescription>
      </Alert>
      <div className="space-y-4">
        {GROUPS.map((group) => {
          const recommendedFields = group.fields.filter(
            (field) => field.recommended,
          );
          const advancedFields = group.fields.filter(
            (field) => !field.recommended,
          );
          const recommendedCount = recommendedFields.length;
          return (
            <Card key={group.id} className="overflow-hidden">
              <NativeDetails initiallyOpen={group.defaultOpen}>
                <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {t(`parameters.groups.${group.id}.title`)}
                      </span>
                      {recommendedCount > 0 && group.id !== "risk" && (
                        <Badge variant="secondary" className="text-[10px]">
                          {recommendedCount} {t("parameters.recommended")}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {t(`parameters.groups.${group.id}.description`)}
                    </span>
                  </span>
                </summary>
                <div className="space-y-4 px-5 pb-5">
                  {group.id === "risk" ? (
                    <>
                      <HailEalNotice parameters={parameters} />
                      <HailEalTables bindings={bindings} />
                    </>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {[...recommendedFields, ...advancedFields]
                        .filter((field) => !hiddenField(field, parameters))
                        .map((field) => (
                          <div
                            key={field.key}
                            className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_180px] sm:items-center"
                          >
                            <div className="min-w-0">
                              {/* Tips sit behind an ⓘ popover: Electron
                                  doesn't show native `title` tooltips. */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <label
                                  htmlFor={`parameter-${field.key}`}
                                  className="text-sm font-medium"
                                >
                                  {fieldLabel(field)}
                                </label>
                                {field.recommended && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px]"
                                  >
                                    {t("parameters.recommended")}
                                  </Badge>
                                )}
                                {field.tip && (
                                  <TileInfo
                                    label={fieldLabel(field)}
                                    text={t(
                                      `parameters.parameterFields.${field.key}.tip`,
                                    )}
                                  />
                                )}
                                {parameters[field.key] !==
                                  DEFAULT_RISK_PARAMETERS[field.key] && (
                                  <>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {t("parameters.changedBadge", {
                                        value: `${displayValue(field.key, DEFAULT_RISK_PARAMETERS[field.key], locale)}${isPercent(field) ? " %" : ""}`,
                                      })}
                                    </Badge>
                                    <HintButton
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="size-6"
                                      disabled={parametersUpdating}
                                      aria-label={t("parameters.resetField", {
                                        label: fieldLabel(field),
                                      })}
                                      onClick={() =>
                                        void commitValue(
                                          field,
                                          displayValue(
                                            field.key,
                                            DEFAULT_RISK_PARAMETERS[field.key],
                                            locale,
                                          ),
                                        )
                                      }
                                    >
                                      <RotateCcw className="size-3" />
                                    </HintButton>
                                  </>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {fieldDescription(field)}
                              </p>
                            </div>
                            <ParameterEditor
                              field={field}
                              label={fieldLabel(field)}
                              unit={t(`parameters.units.${unitKey(field)}`)}
                              value={
                                draft[field.key] ??
                                displayValue(
                                  field.key,
                                  parameters[field.key],
                                  locale,
                                )
                              }
                              locale={locale}
                              onRevert={() => revertDraft(field)}
                              onDraftChange={(value) =>
                                setDraft((current) => ({
                                  ...current,
                                  [field.key]: value,
                                }))
                              }
                              onCommit={(raw) => void commitValue(field, raw)}
                              disabled={parametersUpdating}
                              error={errors[field.key]}
                            />
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </NativeDetails>
            </Card>
          );
        })}
      </div>
      <ImpactBar />
      <ResetDialog
        open={confirmReset}
        changedCount={changedFromDefaults}
        onOpenChange={setConfirmReset}
        onConfirm={() => void reset()}
      />
    </div>
  );
}
