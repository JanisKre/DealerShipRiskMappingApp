import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";

/**
 * ⓘ button next to a tile title or field label. With `topic` it answers
 * "what does this show, how is it calculated, what are the limits?" from
 * `dashboard.info.<topic>.*`; with `text` it shows that one explanation.
 */
export function TileInfo({
  topic,
  text,
  label,
  values,
  align = "start",
  children,
}: Readonly<{
  topic?: string;
  /** A single explanation instead of the what/how/limits sections. */
  text?: string;
  /** What the ⓘ explains (tile title, field label): names the button. */
  label?: string;
  /** Interpolation values (thresholds, radius, …) for the info texts. */
  values?: Record<string, string | number>;
  align?: "start" | "center" | "end";
  /** Free content instead of `topic` or `text`. */
  children?: ReactNode;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const sections = ["what", "how", "limits"] as const;
  const name = label
    ? t("dashboard.info.labelFor", { label })
    : t("dashboard.info.label");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={name}
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={8}
        className="w-80 space-y-2 p-3 text-xs leading-relaxed"
      >
        {children ??
          (text != null ? (
            <p>{text}</p>
          ) : (
            sections.map((section) => (
              <div key={section}>
                <div className="font-semibold">
                  {t(`dashboard.info.${section}`)}
                </div>
                <p className="text-muted-foreground">
                  {t(`dashboard.info.${topic}.${section}`, values)}
                </p>
              </div>
            ))
          ))}
      </PopoverContent>
    </Popover>
  );
}
