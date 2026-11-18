import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  ChevronRight,
  Crosshair,
  FileUp,
  History,
  Loader2,
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
import type { HailstormScenario } from "@shared/types";
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
import { useLlmReady } from "@renderer/lib/useLlmReady";
import { useAppStore } from "@renderer/store/appStore";
import {
  useHailReplayStore,
  type CorridorSettings,
  type DrawKind,
  type HailPanelTab,
} from "@renderer/store/hailReplayStore";
import { HAIL_CLASS_COLOR } from "./HailEventReplayLayer";
import { INTENSITY_LEVELS } from "./HailstormScenarioLayer";
import { ScenarioFromSentence } from "./ScenarioFromSentence";
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
const DRAW_KINDS: DrawKind[] = ["track", "corridor"];
const RETURN_PERIODS = [10, 50, 100] as const;
const TRACK_SPEEDS = [30, 50, 70];

function yesterday(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Label above a control; every field of the section looks the same. */
function Field({
  id,
  label,
  title,
  children,
}: Readonly<{
  id: string;
  label: string;
  /** Full name when the label is shortened to fit a column. */
  title?: string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1">
      <Label
        id={`${id}-label`}
        htmlFor={id}
        title={title}
        className={`${PANEL_LABEL_CLASS} block truncate`}
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

/** A select of fixed options in the panel's control style. */
function OptionSelect<T extends string>({
  id,
  value,
  options,
  label,
  onChange,
}: Readonly<{
  id: string;
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
}>): React.JSX.Element {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className={PANEL_CONTROL_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {label(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Segmented choice in the panel (mode, kind of drawing). */
function Segmented<T extends string>({
  value,
  options,
  label,
  onChange,
  ...aria
}: Readonly<{
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}>): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="w-full"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      {...aria}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o} className="px-1 text-[11px]">
          {label(o)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Generated storms: on the portfolio, over Germany, or from a click. */
function SimulateMode(): React.JSX.Element {
  const { t } = useTranslation();
  const s = useHailReplayStore();
  const actions = useHailSimActions();
  const targets = usePortfolioTargets();
  const picking = s.mapMode === "pickStart";
  const [optionsOpen, setOptionsOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        className={PANEL_ACTION_CLASS}
        disabled={targets.length === 0}
        onClick={() => actions.simulateOutbreak("portfolio")}
      >
        <Building2 className="size-3" />
        {t("hailReplay.simPortfolio")}
      </Button>
      {targets.length === 0 && (
        <p className={PANEL_HINT_CLASS}>{t("hailReplay.noPortfolio")}</p>
      )}
      {/* Strength, direction and the other starting points are for the
          second storm, not the first: closed until asked for, open while a
          start point is being picked. */}
      <details
        className="group"
        open={optionsOpen || picking}
        onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 shrink-0 transition-transform duration-150 group-open:rotate-90" />
          {t("hailReplay.simOptions")}
        </summary>
        <div className="space-y-2.5 pt-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Field id="sim-strength" label={t("hailReplay.strength")}>
              <OptionSelect
                id="sim-strength"
                value={s.sim.strength}
                options={Object.keys(SIM_STRENGTHS) as SimStrength[]}
                label={(v) => t(`hailReplay.strengths.${v}`)}
                onChange={(strength) => s.setSim({ strength })}
              />
            </Field>
            <Field id="sim-heading" label={t("hailReplay.heading")}>
              <OptionSelect
                id="sim-heading"
                value={s.sim.heading}
                options={Object.keys(SIM_HEADINGS) as SimHeading[]}
                label={(v) => t(`hailReplay.headings.${v}`)}
                onChange={(heading) => s.setSim({ heading })}
              />
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
              variant="outline"
              className={PANEL_ACTION_CLASS}
              onClick={() => actions.simulateOutbreak("germany")}
            >
              <Shuffle className="size-3" />
              {t("hailReplay.simGermany")}
            </Button>
            <Button
              size="sm"
              variant={picking ? "default" : "outline"}
              className={PANEL_ACTION_CLASS}
              aria-pressed={picking}
              onClick={() => s.setMapMode(picking ? null : "pickStart")}
            >
              <Crosshair className="size-3" />
              {picking ? t("hailReplay.drawCancel") : t("hailReplay.pickStart")}
            </Button>
          </div>
        </div>
      </details>
    </>
  );
}

/** Settings of the corridor: the drawn one, or the next one. */
function CorridorFields(): React.JSX.Element {
  const { t } = useTranslation();
  const defaults = useHailReplayStore((st) => st.corridor);
  const setDefaults = useHailReplayStore((st) => st.setCorridor);
  const scenario = useAppStore((st) => st.scenario);
  const setScenario = useAppStore((st) => st.setScenario);
  const c: CorridorSettings = scenario
    ? {
        widthKm: scenario.widthKm,
        intensityLevel: scenario.intensityLevel,
        returnPeriodYears: scenario.returnPeriodYears ?? 100,
        exposureMultiplier: scenario.exposureMultiplier ?? 1,
      }
    : defaults;

  function patch(p: Partial<CorridorSettings>): void {
    setDefaults(p);
    if (scenario) setScenario({ ...scenario, ...p });
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <Field id="corridor-intensity" label={t("hailReplay.strength")}>
          <OptionSelect
            id="corridor-intensity"
            value={c.intensityLevel}
            options={INTENSITY_LEVELS}
            label={(v) => t(`risk.${v}`)}
            onChange={(intensityLevel: HailstormScenario["intensityLevel"]) =>
              patch({ intensityLevel })
            }
          />
        </Field>
        <Field
          id="corridor-return-period"
          label={t("hailReplay.returnPeriodShort")}
          title={t("ui.returnPeriod")}
        >
          <OptionSelect
            id="corridor-return-period"
            value={String(c.returnPeriodYears)}
            options={RETURN_PERIODS.map(String)}
            label={(v) => `${v} ${t("ui.years")}`}
            onChange={(v) =>
              patch({ returnPeriodYears: Number(v) as 10 | 50 | 100 })
            }
          />
        </Field>
      </div>
      <Field
        id="corridor-width"
        label={t("hailReplay.corridorWidth", { km: num(c.widthKm) })}
      >
        <Slider
          id="corridor-width"
          min={1}
          max={100}
          step={1}
          value={c.widthKm}
          onValueChange={(widthKm) => patch({ widthKm })}
        />
      </Field>
      <Field
        id="corridor-exposure"
        label={t("hailReplay.corridorExposure", {
          value: num(c.exposureMultiplier, 1),
        })}
      >
        <Slider
          id="corridor-exposure"
          min={0.1}
          max={5}
          step={0.1}
          value={c.exposureMultiplier}
          onValueChange={(exposureMultiplier) => patch({ exposureMultiplier })}
        />
      </Field>
    </>
  );
}

/** A line drawn on the map: a moving storm, or a static corridor. */
function DrawMode(): React.JSX.Element {
  const { t } = useTranslation();
  const s = useHailReplayStore();
  const hasCorridor = useAppStore((st) => st.scenario != null);
  const llmReady = useLlmReady();
  const drawing = s.mapMode === "draw";
  const corridor = s.draw.kind === "corridor";
  const startLabel = corridor
    ? hasCorridor
      ? t("hailReplay.redrawCorridor")
      : t("hailReplay.drawCorridor")
    : t("hailReplay.drawTrack");
  return (
    <>
      <div className="min-w-0 space-y-1">
        <Label id="draw-kind-label" className={PANEL_LABEL_CLASS}>
          {t("hailReplay.drawKind")}
        </Label>
        <Segmented
          aria-labelledby="draw-kind-label"
          value={s.draw.kind}
          options={DRAW_KINDS}
          label={(v) => t(`hailReplay.drawKinds.${v}`)}
          onChange={(kind) => {
            s.setDraw({ kind });
            s.setMapMode(null);
          }}
        />
        <p className={PANEL_HINT_CLASS}>
          {corridor
            ? t("hailReplay.corridorIntro")
            : t("hailReplay.trackIntro")}
        </p>
      </div>

      {corridor ? (
        <CorridorFields />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <Field id="draw-strength" label={t("hailReplay.strength")}>
            <OptionSelect
              id="draw-strength"
              value={s.draw.strength}
              options={Object.keys(SIM_STRENGTHS) as SimStrength[]}
              label={(v) => t(`hailReplay.strengths.${v}`)}
              onChange={(strength) => s.setDraw({ strength })}
            />
          </Field>
          <Field
            id="draw-speed"
            label={t("hailReplay.speedShort")}
            title={t("hailReplay.speedKmh")}
          >
            <OptionSelect
              id="draw-speed"
              value={String(s.draw.speedKmh)}
              options={TRACK_SPEEDS.map(String)}
              label={(v) => `${v} km/h`}
              onChange={(v) => s.setDraw({ speedKmh: Number(v) })}
            />
          </Field>
        </div>
      )}

      <div>
        <Button
          size="sm"
          variant={drawing ? "default" : "outline"}
          className={PANEL_ACTION_CLASS}
          aria-pressed={drawing}
          onClick={() => s.setMapMode(drawing ? null : "draw")}
        >
          <PenLine className="size-3" />
          {drawing ? t("hailReplay.drawCancel") : startLabel}
        </Button>
      </div>

      {corridor && llmReady && !drawing && <ScenarioFromSentence />}
    </>
  );
}

/** Real storm days from the DWD radar climatology. */
function HistoryMode(): React.JSX.Element {
  const { t } = useTranslation();
  const s = useHailReplayStore();
  const actions = useHailSimActions();
  return (
    <>
      <div className="flex items-end gap-1.5">
        <div className="min-w-0 flex-1">
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
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2.5"
          disabled={s.historicLoading || !s.historicDay}
          onClick={() => void actions.loadHistoric(s.historicDay)}
        >
          {/* The label keeps its width while the spinner shows. */}
          <span className="relative">
            <span className={s.historicLoading ? "invisible" : undefined}>
              {t("hailReplay.historicLoad")}
            </span>
            {s.historicLoading && (
              <Loader2 className="absolute inset-0 m-auto size-3 animate-spin" />
            )}
          </span>
        </Button>
      </div>
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
        <History className="size-3" />
        {t("hailReplay.presetAndreas")}
      </Button>
      <p className={PANEL_HINT_CLASS}>{t("hailReplay.historicIntro")}</p>
    </>
  );
}

/** Saved scenarios, imported footprints and the radar archive. */
function LibraryMode(): React.JSX.Element {
  const { t } = useTranslation();
  const s = useHailReplayStore();
  const actions = useHailSimActions();
  const fileRef = useRef<HTMLInputElement>(null);
  const { refresh } = actions;
  const events = s.list?.events ?? [];

  // The list is loaded when the mode is first shown.
  useEffect(() => {
    const st = useHailReplayStore.getState();
    if (!st.list && !st.listLoading) void refresh();
  }, [refresh]);

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
          aria-current={active || undefined}
          onClick={() => void actions.open(e.id)}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: HAIL_CLASS_COLOR[e.maxClass] }}
          />
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {t(`hailReplay.sources.${e.source}`)}
          </span>
        </button>
        {e.source === "radar" ? (
          // Same width as the delete button, so the rows line up.
          <span className="size-6 shrink-0" aria-hidden />
        ) : (
          <HintButton
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={t("hailReplay.deleteEventNamed", { name: label })}
            onClick={() => void actions.remove(e.id)}
          >
            <Trash2 className="size-3" />
          </HintButton>
        )}
      </li>
    );
  }

  const status = s.list?.archiveFrom
    ? t("hailReplay.archive", {
        from: replayDateLabel(Date.parse(s.list.archiveFrom)),
        to: replayDateLabel(Date.parse(s.list.archiveTo ?? s.list.archiveFrom)),
        steps: num(s.list.steps),
      })
    : s.list
      ? t("hailReplay.archiveEmpty")
      : t("hailReplay.listLoading");

  return (
    <>
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 text-[11px] leading-snug text-muted-foreground">
          {status}
        </p>
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
        <ul
          className="max-h-44 space-y-0.5 overflow-y-auto"
          aria-label={t("hailReplay.libraryList")}
        >
          {events.map(eventRow)}
        </ul>
      ) : (
        s.list && (
          <p className={PANEL_HINT_CLASS}>{t("hailReplay.libraryEmpty")}</p>
        )
      )}
      {s.listError && (
        <p className="text-[11px] leading-snug text-destructive">
          {s.listError}
        </p>
      )}
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
        <FileUp className="size-3" />
        {t("hailReplay.importFootprint")}
      </Button>
    </>
  );
}

/**
 * The layer panel's "Hail scenarios" section, one place for every storm:
 * generated storms, a drawn track or corridor, a historic day, or a saved
 * or imported event. What a storm or corridor does to the portfolio is
 * shown in the cards on the map (HailEventCard).
 */
export function HailSimSection(): React.JSX.Element {
  const { t } = useTranslation();
  const tab = useHailReplayStore((st) => st.tab);
  const setTab = useHailReplayStore((st) => st.setTab);
  return (
    <div className="w-full space-y-2.5" data-testid="hail-section">
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("hailReplay.intro")}
      </p>
      <Segmented
        aria-label={t("hailReplay.title")}
        value={tab}
        options={MODES}
        label={(m) => t(`hailReplay.tabs.${m}`)}
        onChange={setTab}
      />
      <p className="text-xs leading-snug">{t(`hailReplay.modeHint.${tab}`)}</p>
      {tab === "simulate" && <SimulateMode />}
      {tab === "draw" && <DrawMode />}
      {tab === "history" && <HistoryMode />}
      {tab === "library" && <LibraryMode />}
    </div>
  );
}
