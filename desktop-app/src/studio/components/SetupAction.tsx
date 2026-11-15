import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import type { Status } from "@studio/api";
import { startStep, type SetupStep } from "@studio/lib";
import { SitesDialog } from "./SitesDialog";

/** The button for the next setup step: opens the dealer upload or starts the job. */
export function SetupAction({
  step,
  status,
  onStarted,
  size = "sm",
}: {
  step: SetupStep;
  status: Status;
  onStarted: () => void;
  size?: "sm" | "lg";
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const busy = status.job?.status === "running";
  return (
    <>
      <Button
        size={size}
        // Long translations (French) wrap instead of running out of the sidebar.
        className="h-auto max-w-full py-1.5 text-left whitespace-normal"
        disabled={busy}
        title={busy ? t("common.busy") : undefined}
        onClick={() =>
          step.kind === "dealers"
            ? setOpen(true)
            : void startStep(step.step, step.options, onStarted)
        }
      >
        {step.label} <ArrowRight />
      </Button>
      {step.kind === "dealers" && (
        <SitesDialog open={open} onOpenChange={setOpen} onStarted={onStarted} />
      )}
    </>
  );
}
