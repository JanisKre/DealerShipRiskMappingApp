import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import type { Status } from "@studio/api";
import { currentRun, startStep } from "@studio/lib";
import { SitesDialog } from "./SitesDialog";

/** Occasional steps, in one place instead of a button on every page. */
export function ToolsMenu({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [sitesOpen, setSitesOpen] = useState(false);
  const busy = status.job?.status === "running";
  const run = currentRun(status);
  const base = status.baseModels.includes(status.defaultBase)
    ? status.defaultBase
    : status.baseModels[0];
  const noRun = run ? null : t("tools.noRun");
  /** A menu item; a disabled one says why underneath. */
  const item = (
    label: string,
    step: string,
    options: Record<string, unknown> = {},
    why: string | null = null,
  ): React.JSX.Element => (
    <DropdownMenuItem
      disabled={busy || Boolean(why)}
      className="flex-col items-start gap-0.5"
      onSelect={() => void startStep(step, options, reload)}
    >
      {label}
      {(why || busy) && (
        <span className="text-muted-foreground text-[11px] leading-snug">
          {busy ? t("common.busy") : why}
        </span>
      )}
    </DropdownMenuItem>
  );
  const harvestWhy =
    status.harvestBlocked === "sandbox_harvest"
      ? t("tools.harvestSandbox")
      : status.harvestBlocked === "no_app_db"
        ? t("tools.noAppDb")
        : null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            {t("tools.menu")} <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {run
              ? t("tools.model", { model: run })
              : base
                ? t("tools.modelBase", { model: base })
                : t("tools.modelNone")}
          </DropdownMenuLabel>
          {run
            ? item(t("tools.suggestAgain"), "autolabel", { weights: run })
            : item(
                t("tools.suggestFirst"),
                "autolabel",
                { base },
                base ? null : t("tools.needWeights"),
              )}
          {item(
            t("tools.audit"),
            "autolabel",
            { weights: run, audit: true },
            noRun,
          )}
          {item(
            t("tools.errors"),
            "errors",
            { weights: run, conf: 0.45 },
            noRun,
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            className="flex-col items-start gap-0.5"
            onSelect={() => setSitesOpen(true)}
          >
            {t("tools.sites")}
            {busy && (
              <span className="text-muted-foreground text-[11px] leading-snug">
                {t("common.busy")}
              </span>
            )}
          </DropdownMenuItem>
          {item(
            t("tools.fetch"),
            "fetch",
            {},
            status.sites.sites ? null : t("tools.needSites"),
          )}
          {item(t("tools.harvest"), "harvest", {}, harvestWhy)}
          <DropdownMenuSeparator />
          {item(t("tools.claudeSheets"), "claude-sheets")}
          {item(
            t("tools.claudeApply"),
            "claude-apply",
            {},
            status.claude.answers ? null : t("tools.noAnswers"),
          )}
          <DropdownMenuLabel className="text-muted-foreground text-[11px] leading-snug font-normal">
            {t("tools.claudeNote")}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
      <SitesDialog
        open={sitesOpen}
        onOpenChange={setSitesOpen}
        onStarted={reload}
      />
    </>
  );
}
