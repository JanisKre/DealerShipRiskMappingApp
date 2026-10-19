import { useTranslation } from "react-i18next";
import { Badge } from "@renderer/components/ui/badge";
import type { PlaceSuggestion } from "@shared/ipc-schema";

const SOURCE_LABEL = { osm: "OSM", overture: "Overture" } as const;

/**
 * Small provenance tag on a place suggestion: which data source found it.
 * "OSM + Overture" when both know the place.
 */
export function PlaceSourceTag({
  source,
  sources,
}: Readonly<
  Pick<PlaceSuggestion, "source" | "sources">
>): React.JSX.Element | null {
  const shown = sources?.length ? sources : source ? [source] : [];
  if (shown.length === 0) return null;
  return (
    <span className="ml-auto shrink-0 self-center rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
      {shown.map((s) => SOURCE_LABEL[s]).join(" + ")}
    </span>
  );
}

/**
 * Says that a suggestion already is a saved portfolio location, with the
 * start of its note, so the underwriter does not add it twice.
 */
export function PlacePortfolioBadge({
  portfolio,
}: Readonly<Pick<PlaceSuggestion, "portfolio">>): React.JSX.Element | null {
  const { t } = useTranslation();
  const first = portfolio?.[0];
  if (!first) return null;
  const more = (portfolio?.length ?? 1) - 1;
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
      <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
        {more > 0
          ? t("places.inPortfolioMore", {
              portfolio: first.sessionName,
              count: more,
            })
          : t("places.inPortfolio", { portfolio: first.sessionName })}
      </Badge>
      {first.notesExcerpt && (
        <span className="truncate text-xs text-muted-foreground">
          {first.notesExcerpt}
        </span>
      )}
    </span>
  );
}
