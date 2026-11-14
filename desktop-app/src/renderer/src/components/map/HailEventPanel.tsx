import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileUp, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  MAX_FOOTPRINT_BYTES,
  type HailEventSummary,
} from "@shared/hail-events";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Label } from "@renderer/components/ui/label";
import { Slider } from "@renderer/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { eur, num } from "@renderer/lib/format";
import { useHailEventImpact } from "@renderer/lib/useHailEventImpact";
import { useAppStore } from "@renderer/store/appStore";
import { useHailReplayStore } from "@renderer/store/hailReplayStore";
import { HAIL_CLASS_COLOR } from "./HailEventReplayLayer";
import { replayClockLabel, replayDateLabel } from "./HailReplayBar";
import {
  PANEL_ACTION_CLASS,
  PANEL_CONTROL_CLASS,
  PANEL_HINT_CLASS,
  PANEL_LABEL_CLASS,
} from "./panelStyles";

/** How far an event can be moved, km in each direction. */
const MAX_SHIFT_KM = 150;
/** Reached locations listed in the panel; the rest are counted. */
const LISTED_HITS = 8;

/**
 * Hail events in the layer panel: pick a radar event from the local
 * archive or an imported footprint, move it on the ground, and see which
 * locations it reaches. The replay itself runs in the bar at the bottom of
 * the map (HailReplayBar) and on the map (HailEventReplayLayer).
 */
export function HailEventPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const list = useHailReplayStore((s) => s.list);
  const listLoading = useHailReplayStore((s) => s.listLoading);
  const listError = useHailReplayStore((s) => s.listError);
  const detail = useHailReplayStore((s) => s.detail);
  const detailLoading = useHailReplayStore((s) => s.detailLoading);
  const shift = useHailReplayStore((s) => s.shift);
  const setList = useHailReplayStore((s) => s.setList);
  const setListLoading = useHailReplayStore((s) => s.setListLoading);
  const setListError = useHailReplayStore((s) => s.setListError);
  const setDetail = useHailReplayStore((s) => s.setDetail);
  const setDetailLoading = useHailReplayStore((s) => s.setDetailLoading);
  const setShift = useHailReplayStore((s) => s.setShift);
  const dealerships = useAppStore((s) => s.dealerships);
  const select = useAppStore((s) => s.select);
  const impact = useHailEventImpact();
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      setList(await window.api.hailEventsList());
    } catch (error) {
      console.warn("Loading hail events failed", error);
      setListError(t("hailReplay.listFailed"));
    } finally {
      setListLoading(false);
    }
  }, [setList, setListError, setListLoading, t]);

  // Loaded when the section is first opened.
  useEffect(() => {
    if (!list && !listLoading) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(id: string): Promise<void> {
    setDetailLoading(true);
    try {
      const loaded = await window.api.hailEventsGet(id);
      if (!loaded) {
        toast.error(t("hailReplay.eventGone"));
        await refresh();
        return;
      }
      setDetail(loaded);
    } catch (error) {
      console.warn("Loading hail event failed", error);
      toast.error(t("hailReplay.eventFailed"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FOOTPRINT_BYTES) {
      toast.error(t("hailReplay.importTooLarge"));
      return;
    }
    try {
      const summary = await window.api.hailEventsImport(
        file.name.replace(/\.(geo)?json$/i, ""),
        await file.text(),
      );
      toast.success(t("hailReplay.imported", { name: summary.name }));
      await refresh();
      await open(summary.id);
    } catch (error) {
      // The main process explains what was wrong with the file.
      const message =
        error instanceof Error
          ? error.message.replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              "",
            )
          : "";
      toast.error(t("hailReplay.importFailed"), { description: message });
    }
  }

  async function removeImport(id: string): Promise<void> {
    await window.api.hailEventsDelete(id);
    if (detail?.summary.id === id) setDetail(null);
    await refresh();
  }

  function eventLabel(e: HailEventSummary): string {
    const cls = t(`radarHail.class.${e.maxClass}`);
    if (e.source === "import")
      return `${e.name ?? t("hailReplay.importDefaultName")} · ${t("hailReplay.importTag")}`;
    return `${replayDateLabel(e.start)} · ${cls} · ${t("hailReplay.tracks", { count: e.tracks })}`;
  }

  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );
  const events = list?.events ?? [];
  const selectedId = detail?.summary.id;

  return (
    <div className="w-full space-y-2.5">
      <div className="flex gap-1.5">
        <Select
          value={selectedId ?? ""}
          onValueChange={(id) => void open(id)}
          disabled={events.length === 0 || detailLoading}
        >
          <SelectTrigger
            className={`${PANEL_CONTROL_CLASS} min-w-0 flex-1`}
            aria-label={t("hailReplay.chooseEvent")}
          >
            <SelectValue placeholder={t("hailReplay.chooseEvent")} />
          </SelectTrigger>
          <SelectContent>
            {events.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {eventLabel(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HintButton
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t("hailReplay.refresh")}
          onClick={() => void refresh()}
          disabled={listLoading}
        >
          {listLoading || detailLoading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
        </HintButton>
      </div>

      {listError && <p className={PANEL_HINT_CLASS}>{listError}</p>}
      {list && events.length === 0 && (
        <p className={PANEL_HINT_CLASS}>{t("hailReplay.emptyArchive")}</p>
      )}
      {list && (
        <p className={PANEL_HINT_CLASS}>
          {list.archiveFrom
            ? t("hailReplay.archive", {
                from: replayDateLabel(Date.parse(list.archiveFrom)),
                to: replayDateLabel(
                  Date.parse(list.archiveTo ?? list.archiveFrom),
                ),
                steps: num(list.steps),
              })
            : t("hailReplay.archiveEmpty")}
          {list.syncing && ` ${t("hailReplay.syncing")}`}
          {!list.synced && !list.syncing && ` ${t("hailReplay.offline")}`}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        className="hidden"
        onChange={(e) => void onFile(e)}
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

      {detail && (
        <>
          {detail.summary.source === "import" && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => void removeImport(detail.summary.id)}
            >
              <Trash2 className="size-3" />
              {t("hailReplay.deleteImport")}
            </Button>
          )}
          {!detail.summary.timed && (
            <p className={PANEL_HINT_CLASS}>{t("hailReplay.staticHint")}</p>
          )}

          <div className="space-y-2 border-t pt-2.5">
            <div className="flex items-center justify-between gap-1">
              <span className={`${PANEL_LABEL_CLASS} font-medium`}>
                {t("hailReplay.shift")}
              </span>
              {(shift.eastKm !== 0 || shift.northKm !== 0) && (
                <HintButton
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={t("hailReplay.resetShift")}
                  onClick={() => setShift({ eastKm: 0, northKm: 0 })}
                >
                  <RotateCcw className="size-3" />
                </HintButton>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="hail-shift-north" className={PANEL_LABEL_CLASS}>
                {t("hailReplay.shiftNorth", { km: num(shift.northKm) })}
              </Label>
              <Slider
                id="hail-shift-north"
                min={-MAX_SHIFT_KM}
                max={MAX_SHIFT_KM}
                step={5}
                value={shift.northKm}
                onValueChange={(v) => setShift({ ...shift, northKm: v })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hail-shift-east" className={PANEL_LABEL_CLASS}>
                {t("hailReplay.shiftEast", { km: num(shift.eastKm) })}
              </Label>
              <Slider
                id="hail-shift-east"
                min={-MAX_SHIFT_KM}
                max={MAX_SHIFT_KM}
                step={5}
                value={shift.eastKm}
                onValueChange={(v) => setShift({ ...shift, eastKm: v })}
              />
            </div>
          </div>

          {impact && (
            <div className="space-y-1 border-t pt-2.5 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("ui.affected")}
                </span>
                <span className="font-medium">
                  {t("hailReplay.affectedCount", { count: impact.hits.length })}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("dashboard.totalExposure")}
                </span>
                <span className="font-medium">
                  {eur(impact.totalExposureEur)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("hailReplay.stressLoss")}
                </span>
                <span className="font-semibold text-destructive">
                  {eur(impact.totalLossEur)}
                </span>
              </div>
              {impact.hits.length > 0 && (
                <ul
                  aria-label={t("hailReplay.hitsList")}
                  className="max-h-40 space-y-0.5 overflow-y-auto pt-1"
                >
                  {impact.hits.slice(0, LISTED_HITS).map((hit) => {
                    const d = byId.get(hit.id);
                    return (
                      <li key={hit.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                          onClick={() => select(hit.id)}
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              background: HAIL_CLASS_COLOR[hit.hailClass],
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {d?.name ?? hit.id}
                          </span>
                          {detail.summary.timed && (
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {replayClockLabel(hit.firstAt)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {impact.hits.length > LISTED_HITS && (
                    <li className="px-1 text-[11px] text-muted-foreground">
                      {t("hailReplay.moreHits", {
                        count: impact.hits.length - LISTED_HITS,
                      })}
                    </li>
                  )}
                </ul>
              )}
              <p className={PANEL_HINT_CLASS}>
                {t("hailReplay.note", { radius: num(impact.radiusKm) })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
