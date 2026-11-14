import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  FileUp,
  History,
  Loader2,
  MousePointerClick,
  PenLine,
  RefreshCw,
  Shuffle,
  Trash2,
} from "lucide-react";
import type { HailEventSummary } from "@shared/hail-events";
import {
  SIM_HEADINGS,
  SIM_STRENGTHS,
  type SimHeading,
  type SimStrength,
} from "@shared/hail-sim";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Slider } from "@renderer/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { num } from "@renderer/lib/format";
import { usePortfolioTargets } from "@renderer/lib/useHailEventImpact";
import { useHailSimActions } from "@renderer/lib/useHailSimActions";
import {
  useHailReplayStore,
  type HailPanelTab,
} from "@renderer/store/hailReplayStore";
import { HAIL_CLASS_COLOR } from "./HailEventReplayLayer";
import { replayDateLabel } from "@renderer/lib/hailTime";
import {
  PANEL_ACTION_CLASS,
  PANEL_CONTROL_CLASS,
  PANEL_HINT_CLASS,
  PANEL_LABEL_CLASS,
} from "./panelStyles";

/** A famous storm to start the historic mode with (checked in the data). */
const ANDREAS_DAY = "2013-07-28";
const MODES: HailPanelTab[] = ["simulate", "draw", "history", "library"];

function yesterday(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function Field({
  id,
  label,
  children,
}: Readonly<{
  id: string;
  label: string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className={PANEL_LABEL_CLASS}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function StrengthSelect({
  id,
  value,
  onChange,
}: Readonly<{
  id: string;
  value: SimStrength;
  onChange: (v: SimStrength) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SimStrength)}>
      <SelectTrigger id={id} className={PANEL_CONTROL_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SIM_STRENGTHS) as SimStrength[]).map((s) => (
          <SelectItem key={s} value={s}>
            {t(`hailReplay.strengths.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The layer panel's "Hail simulation" section: choose what to play —
 * generated storms, a drawn track, a historic day or an event from the
 * archive. Watching the storm and its impact happens in the event card on
 * the map (HailEventCard).
 */
export function HailSimSection(): React.JSX.Element {
  const { t } = useTranslation();
  const s = useHailReplayStore();
  const actions = useHailSimActions();
  const targets = usePortfolioTargets();
  const fileRef = useRef<HTMLInputElement>(null);
  const { refresh } = actions;

  // The archive list is loaded when its mode is first shown.
  useEffect(() => {
    if (s.tab === "library" && !s.list && !s.listLoading) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tab]);

  const events = s.list?.events ?? [];

  function eventRow(e: HailEventSummary): React.JSX.Element {
    const active = s.detail?.summary.id === e.id;
    const label =
      e.source === "radar" || e.source === "radklim"
        ? replayDateLabel(e.start)
        : (e.name ?? t("hailReplay.importDefaultName"));
    return (
      <li key={e.id} className="flex items-center gap-0.5">
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent ${active ? "bg-accent font-medium" : ""}`}
          onClick={() => void actions.open(e.id)}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: HAIL_CLASS_COLOR[e.maxClass] }}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {t(`hailReplay.sources.${e.source}`)}
          </span>
        </button>
        {e.source !== "radar" && (
          <HintButton
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("hailReplay.deleteEvent")}
            onClick={() => void actions.remove(e.id)}
          >
            <Trash2 className="size-3" />
          </HintButton>
        )}
      </li>
    );
  }

  return (
    <div className="w-full space-y-2.5" data-testid="hail-section">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="w-full"
        value={s.tab}
        onValueChange={(v) => v && s.setTab(v as HailPanelTab)}
        aria-label={t("hailReplay.title")}
      >
        {MODES.map((m) => (
          <ToggleGroupItem key={m} value={m} className="px-1 text-[11px]">
            {t(`hailReplay.tabs.${m}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {s.tab === "simulate" && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Field id="sim-strength" label={t("hailReplay.strength")}>
              <StrengthSelect
                id="sim-strength"
                value={s.sim.strength}
                onChange={(strength) => s.setSim({ strength })}
              />
            </Field>
            <Field id="sim-heading" label={t("hailReplay.heading")}>
              <Select
                value={s.sim.heading}
                onValueChange={(v) => s.setSim({ heading: v as SimHeading })}
              >
                <SelectTrigger id="sim-heading" className={PANEL_CONTROL_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SIM_HEADINGS) as SimHeading[]).map((h) => (
                    <SelectItem key={h} value={h}>
                      {t(`hailReplay.headings.${h}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            id="sim-storms"
            label={t("hailReplay.storms", { count: s.sim.storms })}
          >
            <Slider
              id="sim-storms"
              min={1}
              max={12}
              step={1}
              value={s.sim.storms}
              onValueChange={(storms) => s.setSim({ storms })}
            />
          </Field>
          <div className="space-y-1.5">
            <Button
              size="sm"
              className={PANEL_ACTION_CLASS}
              disabled={targets.length === 0}
              onClick={() => actions.simulateOutbreak("portfolio")}
            >
              <Building2 className="size-3.5" />
              {t("hailReplay.simPortfolio")}
            </Button>
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="outline"
                className={PANEL_ACTION_CLASS}
                onClick={() => actions.simulateOutbreak("germany")}
              >
                <Shuffle className="size-3.5" />
                {t("hailReplay.simGermany")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={PANEL_ACTION_CLASS}
                onClick={() => s.setMapMode("pickStart")}
              >
                <MousePointerClick className="size-3.5" />
                {t("hailReplay.pickStart")}
              </Button>
            </div>
          </div>
          {targets.length === 0 && (
            <p className={PANEL_HINT_CLASS}>{t("hailReplay.noPortfolio")}</p>
          )}
        </>
      )}

      {s.tab === "draw" && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Field id="draw-strength" label={t("hailReplay.strength")}>
              <StrengthSelect
                id="draw-strength"
                value={s.draw.strength}
                onChange={(strength) => s.setDraw({ strength })}
              />
            </Field>
            <Field id="draw-speed" label={t("hailReplay.speedKmh")}>
              <Select
                value={String(s.draw.speedKmh)}
                onValueChange={(v) => s.setDraw({ speedKmh: Number(v) })}
              >
                <SelectTrigger id="draw-speed" className={PANEL_CONTROL_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[30, 50, 70].map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {v} km/h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Button
            size="sm"
            className={PANEL_ACTION_CLASS}
            onClick={() => s.setMapMode("draw")}
          >
            <PenLine className="size-3.5" />
            {t("hailReplay.drawTrack")}
          </Button>
        </>
      )}

      {s.tab === "history" && (
        <>
          <p className={PANEL_HINT_CLASS}>{t("hailReplay.historicIntro")}</p>
          <Button
            size="sm"
            variant="outline"
            className={PANEL_ACTION_CLASS}
            disabled={s.historicLoading}
            onClick={() => {
              s.setHistoricDay(ANDREAS_DAY);
              void actions.loadHistoric(ANDREAS_DAY);
            }}
          >
            <History className="size-3.5" />
            {t("hailReplay.presetAndreas")}
          </Button>
          <div className="flex items-end gap-1.5">
            <Field id="historic-day" label={t("hailReplay.historicDay")}>
              <Input
                id="historic-day"
                type="date"
                className={PANEL_CONTROL_CLASS}
                min="2001-01-01"
                max={yesterday()}
                value={s.historicDay}
                onChange={(e) => s.setHistoricDay(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={s.historicLoading || !s.historicDay}
              onClick={() => void actions.loadHistoric(s.historicDay)}
            >
              {s.historicLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                t("hailReplay.historicLoad")
              )}
            </Button>
          </div>
        </>
      )}

      {s.tab === "library" && (
        <>
          <div className="flex items-center justify-between gap-1">
            <span className={PANEL_HINT_CLASS + " mt-0"}>
              {s.list?.archiveFrom
                ? t("hailReplay.archive", {
                    from: replayDateLabel(Date.parse(s.list.archiveFrom)),
                    to: replayDateLabel(
                      Date.parse(s.list.archiveTo ?? s.list.archiveFrom),
                    ),
                    steps: num(s.list.steps),
                  })
                : s.list
                  ? t("hailReplay.archiveEmpty")
                  : ""}
            </span>
            <HintButton
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={t("hailReplay.refresh")}
              onClick={() => void refresh()}
              disabled={s.listLoading}
            >
              {s.listLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
            </HintButton>
          </div>
          {events.length > 0 ? (
            <ul className="max-h-44 space-y-0.5 overflow-y-auto">
              {events.map(eventRow)}
            </ul>
          ) : (
            s.list && (
              <p className={PANEL_HINT_CLASS}>{t("hailReplay.libraryEmpty")}</p>
            )
          )}
          {s.listError && <p className={PANEL_HINT_CLASS}>{s.listError}</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void actions.importFile(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className={PANEL_ACTION_CLASS}
            onClick={() => fileRef.current?.click()}
          >
            <FileUp className="size-3.5" />
            {t("hailReplay.importFootprint")}
          </Button>
        </>
      )}
    </div>
  );
}
