import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";
import type { AnalyzedDealership, DealershipChange } from "@shared/types";
import { num } from "@renderer/lib/format";
import { candidateLabel } from "./boundaryText";
import { Disclosure } from "./shared";

/** One line of the change history, in the user's language. */
function changeText(t: TFunction, change: DealershipChange): string {
  const boundary = change.value
    ? candidateLabel(t, { provider: change.value, source: change.value })
    : undefined;
  const parts: string[] = [];
  switch (change.kind) {
    case "analyzed":
      parts.push(t("dashboard.detailDialog.history.analyzed"));
      if (boundary) parts.push(boundary);
      if (change.area != null) parts.push(`${num(change.area)} m²`);
      if (change.to != null)
        parts.push(
          t("dashboard.detailDialog.history.vehicles", { count: change.to }),
        );
      return parts.join(" · ");
    case "boundaryConfirmed":
      return [
        t("dashboard.detailDialog.history.boundaryConfirmed"),
        boundary,
        change.area != null ? `${num(change.area)} m²` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "boundaryChanged":
      return [
        t("dashboard.detailDialog.history.boundaryChanged"),
        boundary,
        change.area != null ? `${num(change.area)} m²` : undefined,
        change.to != null
          ? t("dashboard.detailDialog.history.vehicles", { count: change.to })
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "vehicleCountChanged":
      return change.to != null
        ? t("dashboard.detailDialog.history.vehicleCountSet", {
            from: change.from ?? "—",
            to: change.to,
          })
        : t("dashboard.detailDialog.history.vehicleCountCleared", {
            from: change.from ?? "—",
          });
    case "vehiclesReviewed":
      return t("dashboard.detailDialog.history.vehiclesReviewed", {
        from: change.from ?? "—",
        to: change.to ?? "—",
      });
    case "businessTypeChanged":
      return change.value === "existing"
        ? t("dashboard.detailDialog.history.markedExisting")
        : t("dashboard.detailDialog.history.markedNew");
    case "reviewed":
      return t("dashboard.detailDialog.history.reviewed");
  }
}

/** What was changed at this location, newest first. */
export function HistorySection({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const entries = [...(d.history ?? [])].reverse();
  return (
    <Disclosure
      title={t("dashboard.detailDialog.history.title")}
      summary={
        entries.length > 0
          ? t("dashboard.detailDialog.history.count", { count: entries.length })
          : undefined
      }
    >
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.history.empty")}
        </p>
      ) : (
        <ol className="space-y-1.5 text-xs">
          {entries.map((change, index) => (
            <li key={`${change.at}-${index}`} className="flex gap-3">
              <time
                dateTime={change.at}
                className="w-28 shrink-0 tabular-nums text-muted-foreground"
              >
                {new Date(change.at).toLocaleString(i18n.language, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </time>
              <span className="min-w-0">{changeText(t, change)}</span>
            </li>
          ))}
        </ol>
      )}
    </Disclosure>
  );
}
