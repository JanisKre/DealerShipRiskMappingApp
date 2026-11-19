import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { errorReason, notify } from "@renderer/lib/notify";
import {
  MAX_FOOTPRINT_BYTES,
  summarizeEvent,
  type HailEventCell,
  type HailEventDetail,
} from "@shared/hail-events";
import {
  generateOutbreak,
  generateStorm,
  rng,
  SIM_HEADINGS,
  simulationEvidence,
  stormAlongPath,
} from "@shared/hail-sim";
import {
  showCorridor,
  showStorm,
  useHailReplayStore,
} from "@renderer/store/hailReplayStore";
import { useAppStore } from "@renderer/store/appStore";
import { SCENARIO_MODEL_VERSION } from "@renderer/components/map/ScenarioFromSentence";
import { usePortfolioTargets } from "./useHailEventImpact";

/** Afternoon of today (13:00 UTC): when generated storms start. */
function simulationStart(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13);
}

function simulationDetail(
  id: string,
  source: "simulation" | "drawn",
  name: string,
  cells: HailEventCell[],
): HailEventDetail {
  return {
    summary: summarizeEvent(id, source, name, true, cells),
    cells,
    evidence: simulationEvidence(source),
  };
}

/** Known import errors of the main process, in the UI's language. */
const IMPORT_ERRORS: [RegExp, string][] = [
  [/larger than 20 MB/, "hailReplay.importTooLarge"],
  [/not valid JSON/, "hailReplay.importInvalidJson"],
  [/Expected a GeoJSON/, "hailReplay.importNotGeojson"],
  [/no polygon footprints/, "hailReplay.importNoPolygons"],
  [/more than \d+ polygons/, "hailReplay.importTooManyPolygons"],
];

function importErrorText(message: string, t: TFunction): string {
  const known = IMPORT_ERRORS.find(([pattern]) => pattern.test(message));
  return known ? t(known[1]) : message;
}

/**
 * Everything the hail panel and the map can do with events: load the
 * list, open, generate, draw, fetch a historic day, save, import, delete.
 */
export function useHailSimActions(): {
  refresh: () => Promise<void>;
  open: (id: string, autoplay?: boolean) => Promise<void>;
  simulateOutbreak: (aim: "portfolio" | "germany") => void;
  simulateAt: (point: [number, number]) => void;
  simulateAlong: (path: [number, number][]) => void;
  finishDrawing: (path: [number, number][]) => void;
  loadHistoric: (day: string) => Promise<void>;
  saveCurrent: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  importFile: (file: File) => Promise<void>;
} {
  const { t } = useTranslation();
  const store = useHailReplayStore;
  const targets = usePortfolioTargets();

  const refresh = useCallback(async (): Promise<void> => {
    const s = store.getState();
    s.setListLoading(true);
    s.setListError(null);
    try {
      s.setList(await window.api.hailEventsList());
    } catch (error) {
      console.warn("Loading hail events failed", error);
      s.setListError(t("hailReplay.listFailed"));
    } finally {
      s.setListLoading(false);
    }
  }, [store, t]);

  const open = useCallback(
    async (id: string, autoplay = true): Promise<void> => {
      const s = store.getState();
      s.setDetailLoading(true);
      try {
        const loaded = await window.api.hailEventsGet(id);
        if (!loaded) {
          notify.error(t("hailReplay.eventGone"));
          await refresh();
          return;
        }
        showStorm(loaded, autoplay);
      } catch (error) {
        console.warn("Loading hail event failed", error);
        notify.error(t("hailReplay.eventFailed"));
      } finally {
        s.setDetailLoading(false);
      }
    },
    [refresh, store, t],
  );

  /** Next seed: every click gives a new storm, the number keeps it reproducible. */
  const nextSeed = useCallback((): number => {
    const seed = (store.getState().sim.seed % 99_999) + 1;
    store.getState().setSim({ seed });
    return seed;
  }, [store]);

  const simulateOutbreak = useCallback(
    (aim: "portfolio" | "germany"): void => {
      const seed = nextSeed();
      const { sim } = store.getState();
      let aimed: Array<[number, number]> | undefined;
      if (aim === "portfolio" && targets.length > 0) {
        // A random pick of locations, the same for the same seed.
        const random = rng(seed * 7919);
        const pool = [...targets];
        aimed = [];
        while (aimed.length < sim.storms && pool.length > 0) {
          aimed.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
        }
      }
      const cells = generateOutbreak({
        seed,
        storms: sim.storms,
        strength: sim.strength,
        heading: sim.heading,
        t0: simulationStart(),
        targets: aimed,
      });
      const name = t(
        aim === "portfolio"
          ? "hailReplay.simNamePortfolio"
          : "hailReplay.simNameGermany",
        { seed },
      );
      showStorm(
        simulationDetail(`sim-${seed}`, "simulation", name, cells),
        true,
      );
    },
    [nextSeed, store, t, targets],
  );

  const simulateAt = useCallback(
    (point: [number, number]): void => {
      const seed = nextSeed();
      const { sim } = store.getState();
      const random = rng(seed);
      const cells = generateStorm(
        {
          start: point,
          headingDeg: SIM_HEADINGS[sim.heading] + (random() - 0.5) * 10,
          speedKmh: 45,
          durationMin: 90,
          strength: sim.strength,
          t0: simulationStart(),
          track: 0,
        },
        random,
      );
      showStorm(
        simulationDetail(
          `sim-${seed}`,
          "simulation",
          t("hailReplay.simNamePoint", { seed }),
          cells,
        ),
        true,
      );
      store.getState().setMapMode(null);
    },
    [nextSeed, store, t],
  );

  const simulateAlong = useCallback(
    (path: [number, number][]): void => {
      const seed = nextSeed();
      const { draw, sim } = store.getState();
      const cells = stormAlongPath(
        path,
        draw.speedKmh,
        sim.strength,
        simulationStart(),
        seed,
      );
      if (cells.length === 0) return;
      showStorm(
        simulationDetail(
          `sim-${seed}`,
          "drawn",
          t("hailReplay.drawnName", { seed }),
          cells,
        ),
        true,
      );
      store.getState().setMapMode(null);
    },
    [nextSeed, store, t],
  );

  /**
   * A finished line on the map: a storm along it, or the corridor (which
   * keeps the current corridor's name and id, so redrawing replaces it).
   */
  const finishDrawing = useCallback(
    (path: [number, number][]): void => {
      const { draw, corridor } = store.getState();
      if (draw.kind === "track") {
        simulateAlong(path);
        return;
      }
      if (path.length < 2) return;
      const current = useAppStore.getState().scenario;
      showCorridor({
        id: current?.id ?? crypto.randomUUID(),
        name: current?.name ?? t("map.page.defaultScenarioName"),
        pathCoordinates: path,
        ...corridor,
        modelVersion: SCENARIO_MODEL_VERSION,
      });
      store.getState().setMapMode(null);
    },
    [simulateAlong, store, t],
  );

  const loadHistoric = useCallback(
    async (day: string): Promise<void> => {
      const s = store.getState();
      s.setHistoricLoading(true);
      try {
        const summary = await window.api.hailEventsLoadHistoric(day);
        await refresh();
        if (summary.cells === 0) {
          notify.info(t("hailReplay.historicNone", { day }));
        }
        s.setSpeed("fast");
        await open(summary.id, true);
      } catch (error) {
        notify.error(t("hailReplay.historicFailed"), { cause: error });
      } finally {
        s.setHistoricLoading(false);
      }
    },
    [open, refresh, store, t],
  );

  const saveCurrent = useCallback(async (): Promise<void> => {
    const { detail } = store.getState();
    if (!detail) return;
    const source = detail.summary.source;
    if (source !== "simulation" && source !== "drawn") return;
    try {
      const saved = await window.api.hailEventsSave({
        name: detail.summary.name ?? "",
        source,
        cells: detail.cells,
      });
      notify.success(t("hailReplay.saved", { name: saved.name }));
      await refresh();
    } catch (error) {
      notify.error(t("hailReplay.saveFailed"), { cause: error });
    }
  }, [refresh, store, t]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await window.api.hailEventsDelete(id);
      if (store.getState().detail?.summary.id === id)
        store.getState().setDetail(null);
      await refresh();
    },
    [refresh, store],
  );

  const importFile = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > MAX_FOOTPRINT_BYTES) {
        notify.error(t("hailReplay.importTooLarge"));
        return;
      }
      try {
        const summary = await window.api.hailEventsImport(
          file.name.replace(/\.(geo)?json$/i, ""),
          await file.text(),
        );
        notify.success(t("hailReplay.imported", { name: summary.name }));
        await refresh();
        await open(summary.id, true);
      } catch (error) {
        notify.error(t("hailReplay.importFailed"), {
          description: importErrorText(errorReason(error), t),
        });
      }
    },
    [open, refresh, t],
  );

  return {
    refresh,
    open,
    simulateOutbreak,
    simulateAt,
    simulateAlong,
    finishDrawing,
    loadHistoric,
    saveCurrent,
    remove,
    importFile,
  };
}
