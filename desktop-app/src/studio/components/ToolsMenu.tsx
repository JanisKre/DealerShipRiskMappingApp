import { ChevronDown } from "lucide-react";
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

/** Occasional steps, in one place instead of a button on every page. */
export function ToolsMenu({
  status,
  reload,
}: {
  status: Status;
  reload: () => void;
}): React.JSX.Element {
  const busy = status.job?.status === "running";
  const run = currentRun(status);
  const item = (
    label: string,
    step: string,
    options: Record<string, unknown> = {},
    disabled = false,
  ): React.JSX.Element => (
    <DropdownMenuItem
      disabled={busy || disabled}
      onSelect={() => void startStep(step, options, reload)}
    >
      {label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          Werkzeuge <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Mit {run || "–"}
        </DropdownMenuLabel>
        {item(
          "Vorschläge für offene Standorte neu berechnen",
          "autolabel",
          { weights: run },
          !run,
        )}
        {item(
          "Audit-Fragen für fertige Standorte berechnen",
          "autolabel",
          { weights: run, audit: true },
          !run,
        )}
        {item(
          "Fehleranalyse (Fehler-Bögen)",
          "errors",
          { weights: run, conf: 0.45 },
          !run,
        )}
        <DropdownMenuSeparator />
        {item("Fehlende Kacheln laden", "fetch")}
        {item("Korrekturen aus der App übernehmen", "harvest")}
        <DropdownMenuSeparator />
        {item("Claude-Bögen erzeugen", "claude-sheets")}
        {item(
          "Claude-Antworten übernehmen",
          "claude-apply",
          {},
          !status.claude.answers,
        )}
        <DropdownMenuLabel className="text-muted-foreground text-[11px] leading-snug font-normal">
          Claude-Bögen verlassen den Rechner, wenn Claude sie liest. Übernommen
          wird nur „kein Fahrzeug“ bei schwachen Kandidaten.
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
