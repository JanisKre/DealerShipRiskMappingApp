import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { ealCoverage } from "@shared/estimates";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@renderer/components/ui/breadcrumb";
import { boundaryReviewQueue } from "@renderer/components/map/mapSelection";
import { useModelAvailable } from "@renderer/lib/useModelAvailable";
import { cn } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/appStore";

type StepState = "done" | "open" | "warning" | "running";

interface Step {
  id: "prepare" | "import" | "review" | "evaluate";
  state: StepState;
  /** Short status after the label ("7", "3 offen", "vorläufig"). */
  detail?: string;
  onClick: () => void;
}

/**
 * The four phases of a portfolio — prepare, import, review, evaluate — as
 * one line in the header, each with its state and a click to where it is
 * done. The pages stay where they are; this only says what is next.
 */
export function WorkflowSteps(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dealerships = useAppStore((s) => s.dealerships);
  const analyzing = useAppStore((s) => s.analyzing);
  const progress = useAppStore((s) => s.progress);
  const select = useAppStore((s) => s.select);
  const modelAvailable = useModelAvailable();

  const reviewIds = boundaryReviewQueue(dealerships);
  const { withBasis, analyzed } = ealCoverage(dealerships);
  const provisional = analyzed > 0 && withBasis < analyzed;

  const steps: Step[] = [
    {
      id: "prepare",
      state: modelAvailable === false ? "warning" : "done",
      detail: modelAvailable === false ? t("workflow.modelMissing") : undefined,
      onClick: () =>
        navigate(
          modelAvailable === false ? "/settings?section=data" : "/parameters",
        ),
    },
    {
      id: "import",
      state: analyzing ? "running" : dealerships.length > 0 ? "done" : "open",
      detail:
        analyzing && progress
          ? `${progress.done}/${progress.total}`
          : dealerships.length > 0
            ? String(dealerships.length)
            : undefined,
      onClick: () => navigate("/"),
    },
    {
      id: "review",
      state:
        dealerships.length === 0
          ? "open"
          : reviewIds.length > 0
            ? "warning"
            : "done",
      detail:
        reviewIds.length > 0
          ? t("workflow.openCount", { count: reviewIds.length })
          : undefined,
      onClick: () => {
        // The map's review notice takes over from the first open site.
        if (reviewIds.length > 0) select(reviewIds[0]);
        navigate("/");
      },
    },
    {
      id: "evaluate",
      state: analyzed === 0 ? "open" : provisional ? "warning" : "done",
      detail: provisional ? t("workflow.provisional") : undefined,
      onClick: () => navigate("/dashboard"),
    },
  ];

  const current: Step["id"] =
    pathname.startsWith("/parameters") || pathname.startsWith("/settings")
      ? "prepare"
      : pathname.startsWith("/dashboard")
        ? "evaluate"
        : dealerships.length > 0 && reviewIds.length > 0
          ? "review"
          : "import";

  return (
    <Breadcrumb aria-label={t("workflow.label")}>
      <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1">
        {steps.map((step, index) => (
          <BreadcrumbItem key={step.id} className="contents">
            {index > 0 && <BreadcrumbSeparator className="mx-0.5" />}
            <button
              type="button"
              onClick={step.onClick}
              aria-current={current === step.id ? "step" : undefined}
              title={t(`workflow.steps.${step.id}`)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current === step.id && "bg-accent font-medium text-foreground",
              )}
            >
              <StepIcon state={step.state} number={index + 1} />
              {/* Narrower headers keep icon and status; the name is the
                  button's title and accessible name there. */}
              <span className="sr-only 2xl:not-sr-only">
                {t(`workflow.steps.${step.id}`)}
              </span>
              {step.detail && (
                <span
                  className={cn(
                    "rounded px-1 tabular-nums",
                    step.state === "warning"
                      ? "bg-warning/15 text-warning-foreground"
                      : "bg-muted",
                  )}
                >
                  {step.detail}
                </span>
              )}
            </button>
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function StepIcon({
  state,
  number,
}: Readonly<{ state: StepState; number: number }>): React.JSX.Element {
  if (state === "running")
    return <Loader2 aria-hidden className="size-3.5 animate-spin" />;
  if (state === "warning")
    return <TriangleAlert aria-hidden className="size-3.5 text-warning" />;
  if (state === "done")
    return <Check aria-hidden className="size-3.5 text-success" />;
  return (
    <span
      aria-hidden
      className="flex size-3.5 items-center justify-center rounded-full border text-[9px] leading-none"
    >
      {number}
    </span>
  );
}
