import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";

/**
 * ⓘ button next to a tile title. Answers "what does this show, how is it
 * calculated, what are the limits?" from `dashboard.info.<topic>.*`.
 */
export function TileInfo({
  topic,
  values,
}: Readonly<{
  topic: string;
  /** Interpolation values (thresholds, radius, …) for the info texts. */
  values?: Record<string, string | number>;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const sections = ["what", "how", "limits"] as const;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("dashboard.info.label")}
          title={t("dashboard.info.label")}
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3 text-xs">
        {sections.map((section) => (
          <div key={section}>
            <div className="font-semibold">
              {t(`dashboard.info.${section}`)}
            </div>
            <p className="leading-relaxed text-muted-foreground">
              {t(`dashboard.info.${topic}.${section}`, values)}
            </p>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
