import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@renderer/lib/notify";
import { Copy, Mail } from "lucide-react";
import type { HailEventHit } from "@shared/hail-events";
import { noticeFacts, noticeSites } from "@shared/event-notice";
import { AiExplanation } from "@renderer/components/ai/AiExplanation";
import { Button } from "@renderer/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";

/**
 * Event watch: the locations a real hail event reached, as a list to copy
 * and, with an AI provider, as a drafted message to the dealerships. The
 * app sends nothing. Radar shows where hail was likely, not damage, and the
 * stress-test loss is left out of both texts.
 */
export function EventNotice({
  eventName,
  hits,
  radiusKm,
  names,
}: Readonly<{
  eventName: string;
  hits: readonly HailEventHit[];
  radiusKm: number;
  names: ReadonlyMap<string, string>;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const sites = useMemo(() => noticeSites(hits, names), [hits, names]);
  if (sites.length === 0) return null;

  const list = [
    t("eventNotice.listHeading", { event: eventName, count: sites.length }),
    ...sites.map(
      (s) => `- ${s.name}: ${s.date}, ${t(`radarHail.class.${s.hailClass}`)}`,
    ),
  ].join("\n");

  // A popover from a small button: the card must not grow over the map's
  // drag handle.
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-1.5"
          aria-label={t("eventNotice.title")}
          title={t("eventNotice.title")}
        >
          <Mail className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 text-xs">
        <p className="font-medium">{t("eventNotice.title")}</p>
        <p className="text-muted-foreground">{t("eventNotice.description")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void notify.copy(list, t("eventNotice.copied"))}
        >
          <Copy /> {t("eventNotice.copyList")}
        </Button>
        <AiExplanation
          topic="eventNotice"
          facts={noticeFacts(eventName, sites, radiusKm)}
          label={t("eventNotice.draft")}
        />
      </PopoverContent>
    </Popover>
  );
}
