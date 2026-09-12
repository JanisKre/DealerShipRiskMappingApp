import type { AnalyzedDealership } from "@shared/types";
import { ACCUMULATION_RADIUS_KM } from "@shared/constants";
import {
  accumulationVerdict,
  groupSummary,
  nearbyInsured,
  productLimitBreach,
} from "@shared/risk-math";
import { useAppStore } from "@renderer/store/appStore";
import { eur, num } from "@renderer/lib/format";
import { AlertTriangle, Info, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type Severity = "info" | "ok" | "warning" | "danger";

interface UwMessage {
  severity: Severity;
  title: string;
  detail: string;
}

const SEVERITY_STYLE: Record<
  Severity,
  { border: string; icon: React.ComponentType<{ className?: string }> }
> = {
  info: { border: "border-l-sky-500", icon: Info },
  ok: { border: "border-l-emerald-500", icon: ShieldCheck },
  warning: { border: "border-l-amber-500", icon: AlertTriangle },
  danger: { border: "border-l-destructive", icon: ShieldAlert },
};

/** Human-readable pricing label from the accumulation math's pricing hint. */
function pricingLabel(t: TFunction, hint: "low" | "normal" | "high"): string {
  if (hint === "high") return t("underwriting.pricing.high");
  if (hint === "normal") return t("underwriting.pricing.normal");
  return t("underwriting.pricing.low");
}

/** Hail risk message from the subject's hail score. */
function hailMessage(
  t: TFunction,
  subject: AnalyzedDealership,
): UwMessage | null {
  const hail = subject.risk?.perils.find((p) => p.peril === "hail")?.score;
  if (hail == null) return null;
  if (hail >= 60) {
    return {
      severity: "danger",
      title: t("underwriting.hail.highTitle"),
      detail: t("underwriting.hail.highDetail", { score: hail.toFixed(0) }),
    };
  }
  if (hail < 25) {
    return {
      severity: "ok",
      title: t("underwriting.hail.lowTitle"),
      detail: t("underwriting.hail.lowDetail", { score: hail.toFixed(0) }),
    };
  }
  return {
    severity: "info",
    title: t("underwriting.hail.mediumTitle"),
    detail: t("underwriting.hail.mediumDetail", { score: hail.toFixed(0) }),
  };
}

/** Product limit/coverage cap message; null when uncritical or without a limit. */
function limitMessage(
  t: TFunction,
  subject: AnalyzedDealership,
): UwMessage | null {
  const limit = productLimitBreach(subject);
  if (limit.severity === "breach") {
    return {
      severity: "danger",
      title: t("underwriting.limit.breachTitle"),
      detail: t("underwriting.limit.breachDetail", {
        exposure: eur(limit.exposureEur),
        limit: eur(limit.limitEur ?? 0),
        loss: eur(limit.midEventLossEur),
      }),
    };
  }
  if (limit.severity === "warning") {
    return {
      severity: "warning",
      title: t("underwriting.limit.warningTitle"),
      detail: t("underwriting.limit.warningDetail", {
        exposure: eur(limit.exposureEur),
        limit: eur(limit.limitEur ?? 0),
        loss: eur(limit.midEventLossEur),
      }),
    };
  }
  return null;
}

/** Accumulation message: insured neighbors within the radius incl. pricing/reinsurance. */
function accumulationMessage(
  t: TFunction,
  subject: AnalyzedDealership,
  all: AnalyzedDealership[],
): UwMessage {
  const neighbors = nearbyInsured(subject, all, ACCUMULATION_RADIUS_KM);
  if (neighbors.length === 0) {
    return {
      severity: "ok",
      title: t("underwriting.accumulation.noneTitle"),
      detail: t("underwriting.accumulation.noneDetail", {
        radius: ACCUMULATION_RADIUS_KM,
      }),
    };
  }
  const verdict = accumulationVerdict(
    subject,
    neighbors,
    ACCUMULATION_RADIUS_KM,
  );
  return {
    severity: verdict.reinsure ? "danger" : "warning",
    title: verdict.reinsure
      ? t("underwriting.accumulation.highTitle")
      : t("underwriting.accumulation.nearbyTitle"),
    detail: t("underwriting.accumulation.detail", {
      count: neighbors.length,
      radius: ACCUMULATION_RADIUS_KM,
      exposure: eur(verdict.accumulatedExposureEur),
      reinsureText: verdict.reinsure
        ? t("underwriting.reinsure.yes")
        : t("underwriting.reinsure.no"),
      pricing: pricingLabel(t, verdict.pricingHint),
    }),
  };
}

/** Group-wide view across all locations of the network; null without a group. */
function groupMessage(
  t: TFunction,
  subject: AnalyzedDealership,
  all: AnalyzedDealership[],
): UwMessage | null {
  const group = groupSummary(subject, all);
  if (!group || group.memberCount < 2) return null;
  const breachNote =
    group.productLimitBreaches > 0
      ? t("underwriting.group.breachNote", {
          count: group.productLimitBreaches,
        })
      : "";
  return {
    severity: group.reinsure ? "danger" : "info",
    title: t("underwriting.group.title", {
      group: group.group,
      count: group.memberCount,
    }),
    detail: t("underwriting.group.detail", {
      insured: group.insuredCount,
      total: group.memberCount,
      exposure: eur(group.totalExposureEur),
      vehicles: num(group.totalVehicles),
      maxHail: group.maxHailScore.toFixed(0),
      breachNote,
      reinsureWord: group.reinsure
        ? t("underwriting.reinsure.yesWord")
        : t("underwriting.reinsure.noWord"),
      pricing: pricingLabel(t, group.pricingHint),
    }),
  };
}

/**
 * Computes the underwriting system messages for a subject: hail risk,
 * product limit/coverage cap, accumulation (insured neighbors within the
 * radius), and — for group dealerships — the overall view across all
 * locations of the network.
 */
export function buildUnderwritingMessages(
  t: TFunction,
  subject: AnalyzedDealership,
  all: AnalyzedDealership[],
): UwMessage[] {
  return [
    hailMessage(t, subject),
    limitMessage(t, subject),
    accumulationMessage(t, subject, all),
    groupMessage(t, subject, all),
  ].filter((m): m is UwMessage => m !== null);
}

/**
 * Renders the underwriting system messages for a subject. Reads the full
 * portfolio from the store for the neighborhood analysis.
 */
export function UnderwritingMessages({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const messages = buildUnderwritingMessages(t, d, dealerships);
  if (messages.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">
        {t("underwriting.systemMessages")}
      </h4>
      {messages.map((m, i) => {
        const style = SEVERITY_STYLE[m.severity];
        const Icon = style.icon;
        return (
          <div
            key={i}
            className={`flex gap-2 rounded-lg border border-l-4 ${style.border} bg-muted/40 p-2.5 text-sm`}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{m.title}</div>
              <div className="text-muted-foreground">{m.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
