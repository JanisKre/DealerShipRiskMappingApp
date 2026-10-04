import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { KeyRound, Settings } from "lucide-react";
import { LLM_NOT_CONFIGURED, isLlmSetupError } from "@shared/llm-config";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";

/** Route to the AI section of the settings page. */
export const AI_SETTINGS_PATH = "/settings?section=ai";

/**
 * Prompt shown in place of an AI feature until a provider is set up.
 * `reason="rejected"` is used when the endpoint refused the stored
 * credentials (HTTP 401/403).
 */
export function LlmSetupNotice({
  reason = "missing",
  className,
}: Readonly<{
  reason?: "missing" | "rejected";
  className?: string;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-5 text-center",
        className,
      )}
    >
      <KeyRound className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">
        {t(
          reason === "rejected"
            ? "aiSetup.rejectedTitle"
            : "aiSetup.missingTitle",
        )}
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {t(
          reason === "rejected"
            ? "aiSetup.rejectedDescription"
            : "aiSetup.missingDescription",
        )}
      </p>
      <Button
        size="sm"
        className="mt-1"
        onClick={() => navigate(AI_SETTINGS_PATH)}
      >
        <Settings /> {t("aiSetup.openSettings")}
      </Button>
    </div>
  );
}

/**
 * Renders an AI error: setup/auth failures become the setup prompt, anything
 * else is shown as text (formatted by `format`, default `ui.error`).
 */
export function LlmErrorMessage({
  error,
  format,
  className,
}: Readonly<{
  error: string;
  format?: (error: string) => string;
  className?: string;
}>): React.JSX.Element {
  const { t } = useTranslation();
  if (isLlmSetupError(error)) {
    return (
      <LlmSetupNotice
        className={className}
        reason={error.includes(LLM_NOT_CONFIGURED) ? "missing" : "rejected"}
      />
    );
  }
  return (
    <p className={cn("text-xs text-destructive", className)}>
      {format ? format(error) : t("ui.error", { error })}
    </p>
  );
}
