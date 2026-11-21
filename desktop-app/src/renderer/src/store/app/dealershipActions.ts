import { attachVehicleTimeline } from "@shared/vehicle-timeline";
import { isUserWebsiteSource, normalizeWebsiteUrl } from "@shared/website";
import { type AppState, type StoreSet } from "./types";
import { removedIds } from "./runtime";
import { withoutKey, withChange } from "./helpers";
import { clearAnswer, mergeAnswers } from "@shared/site-questions";

/** Single locations: metadata, notes, website, vehicle counts, removal. */
export function dealershipActions(
  set: StoreSet,
  get: () => AppState,
): Pick<
  AppState,
  | "upsertDealership"
  | "updateDealershipMeta"
  | "updateDealershipNotes"
  | "setSiteAnswer"
  | "recordSiteAnswers"
  | "updateDealershipWebsite"
  | "setInsuredForDealerships"
  | "updateManualVehicleCount"
  | "saveManualVehicleDetection"
  | "countVehicleTimeline"
  | "countVehicleTimelines"
  | "removeDealership"
  | "removeDealerships"
> {
  return {
    upsertDealership: (d) =>
      set((s) => {
        const idx = s.dealerships.findIndex((x) => x.id === d.id);
        const analysisErrors = d.risk
          ? withoutKey(s.analysisErrors, d.id)
          : s.analysisErrors;
        if (idx === -1)
          return { dealerships: [...s.dealerships, d], analysisErrors };
        const copy = [...s.dealerships];
        copy[idx] = d;
        return { dealerships: copy, analysisErrors };
      }),

    updateDealershipMeta: (id, patch) =>
      set((s) => {
        const copy = s.dealerships.map((d) => {
          if (d.id !== id) return d;
          const next = { ...d, ...patch };
          return patch.insured !== undefined &&
            Boolean(patch.insured) !== Boolean(d.insured)
            ? withChange(next, {
                kind: "businessTypeChanged",
                value: patch.insured ? "existing" : "new",
              })
            : next;
        });
        return { dealerships: copy };
      }),

    setSiteAnswer: async (id, question, value, source) => {
      const current = get().dealerships.find((d) => d.id === id);
      if (!current) return;
      const siteAnswers =
        value == null
          ? clearAnswer(current.siteAnswers, question, source)
          : mergeAnswers(current.siteAnswers, [
              { question, value, source, at: new Date().toISOString() },
            ]);
      set((s) => ({
        dealerships: s.dealerships.map((d) =>
          d.id === id
            ? {
                ...d,
                siteAnswers: siteAnswers.length ? siteAnswers : undefined,
              }
            : d,
        ),
      }));
      await get().saveSession();
    },

    recordSiteAnswers: async (id, answers) => {
      if (answers.length === 0) return;
      // A location deleted while the model looked at it stays deleted.
      if (!get().dealerships.some((d) => d.id === id)) return;
      set((s) => ({
        dealerships: s.dealerships.map((d) =>
          d.id === id
            ? { ...d, siteAnswers: mergeAnswers(d.siteAnswers, answers) }
            : d,
        ),
      }));
      await get().saveSession();
    },

    updateDealershipNotes: async (id, notes) => {
      const current = get().dealerships.find((d) => d.id === id);
      if (!current) return;
      const next = notes.trim() === "" ? undefined : notes;
      if (next === current.notes) return;
      const notesUpdatedAt =
        next === undefined ? undefined : new Date().toISOString();
      set((s) => ({
        dealerships: s.dealerships.map((d) =>
          d.id === id ? { ...d, notes: next, notesUpdatedAt } : d,
        ),
      }));
      await get().saveSession();
    },

    updateDealershipWebsite: async (id, website, source) => {
      const current = get().dealerships.find((d) => d.id === id);
      if (!current) return false;
      const next = website === null ? undefined : normalizeWebsiteUrl(website);
      if (website !== null && !next) return false;
      // A typed or imported link is never replaced by an automatic lookup.
      if (source === "osm" && isUserWebsiteSource(current.websiteSource))
        return true;
      const websiteSource = next ? source : undefined;
      if (next === current.website && websiteSource === current.websiteSource)
        return true;
      set((s) => ({
        dealerships: s.dealerships.map((d) =>
          d.id === id ? { ...d, website: next, websiteSource } : d,
        ),
      }));
      await get().saveSession();
      return true;
    },

    setInsuredForDealerships: (ids, insured) =>
      set((s) => {
        const idSet = new Set(ids);
        return {
          dealerships: s.dealerships.map((d) =>
            idSet.has(d.id) && Boolean(d.insured) !== insured
              ? withChange(
                  { ...d, insured },
                  {
                    kind: "businessTypeChanged",
                    value: insured ? "existing" : "new",
                  },
                )
              : d,
          ),
        };
      }),

    updateManualVehicleCount: async (id, count) => {
      if (count != null && (!Number.isInteger(count) || count < 0)) return;
      const current = get().dealerships.find((d) => d.id === id);
      if (!current?.detection) return;
      const detection = {
        ...current.detection,
        ...(count == null
          ? {
              manualVehicleCount: undefined,
              manualVehiclePoints: undefined,
              manualVehicleRemovedPoints: undefined,
            }
          : { manualVehicleCount: count }),
      };
      const risk = await window.api.scoreRisk(
        current.lat,
        current.lon,
        current.assetValue,
        detection,
        current.boundary,
        get().parameters,
        current.natCat,
        current.hailZone,
      );
      const latest = get().dealerships.find((d) => d.id === id);
      if (latest)
        get().upsertDealership(
          withChange(
            { ...latest, detection, risk },
            {
              kind: "vehicleCountChanged",
              from:
                current.detection.manualVehicleCount ??
                current.detection.vehicleCount,
              ...(count != null ? { to: count } : {}),
            },
          ),
        );
      await get().saveSession();
    },

    saveManualVehicleDetection: async (id, count, points, removedPoints) => {
      if (!Number.isInteger(count) || count < 0) return;
      const current = get().dealerships.find((d) => d.id === id);
      if (!current?.detection) return;
      const detection = {
        ...current.detection,
        manualVehicleCount: count,
        manualVehiclePoints: points.length > 0 ? points : undefined,
        manualVehicleRemovedPoints:
          removedPoints.length > 0 ? removedPoints : undefined,
      };
      const risk = await window.api.scoreRisk(
        current.lat,
        current.lon,
        current.assetValue,
        detection,
        current.boundary,
        get().parameters,
        current.natCat,
        current.hailZone,
      );
      const latest = get().dealerships.find((d) => d.id === id);
      if (latest)
        get().upsertDealership(
          withChange(
            { ...latest, detection, risk },
            {
              kind: "vehiclesReviewed",
              from: current.detection.vehicleCount,
              to: count,
            },
          ),
        );
      await get().saveSession();
    },

    countVehicleTimeline: async (id) => {
      const current = get().dealerships.find((d) => d.id === id);
      if (!current?.detection) return;
      const timeline = await window.api.countVehiclesOverTime(
        current.lat,
        current.lon,
        current.boundary,
        get().parameters,
      );
      const latest = get().dealerships.find((d) => d.id === id);
      if (!latest?.detection) return;
      const detection = attachVehicleTimeline(latest.detection, timeline);
      // The risk carries the stock range; a failed rescore keeps the counts.
      let risk = latest.risk;
      try {
        risk = await window.api.scoreRisk(
          latest.lat,
          latest.lon,
          latest.assetValue,
          detection,
          latest.boundary,
          get().parameters,
          latest.natCat,
          latest.hailZone,
        );
      } catch (err) {
        console.error(`Rescoring after the stock count failed (${id}):`, err);
      }
      const after = get().dealerships.find((d) => d.id === id);
      if (!after?.detection) return;
      // A re-detection meanwhile replaced the counts this timeline belongs to.
      if (after.detection !== latest.detection) return;
      get().upsertDealership({ ...after, detection, risk });
      await get().saveSession();
    },

    countVehicleTimelines: async (ids, onProgress, shouldStop) => {
      let counted = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i++) {
        if (shouldStop?.()) break;
        try {
          await get().countVehicleTimeline(ids[i]);
          counted++;
        } catch (err) {
          console.error(`Stock count failed (${ids[i]}):`, err);
          failed++;
        }
        onProgress?.(i + 1, ids.length);
      }
      return { counted, failed };
    },

    removeDealership: (id) => get().removeDealerships([id]),

    removeDealerships: (ids) =>
      set((s) => {
        const idSet = new Set(ids);
        // A running analysis of a removed location must not bring it back.
        for (const id of ids) removedIds.add(id);
        return {
          dealerships: s.dealerships.filter((d) => !idSet.has(d.id)),
          pendingAnalysis: s.pendingAnalysis.filter((p) => !idSet.has(p.id)),
          selectedId:
            s.selectedId && idSet.has(s.selectedId) ? null : s.selectedId,
          analysisErrors: Object.fromEntries(
            Object.entries(s.analysisErrors).filter(([id]) => !idSet.has(id)),
          ),
          failedInputs: Object.fromEntries(
            Object.entries(s.failedInputs).filter(([id]) => !idSet.has(id)),
          ),
        };
      }),
  };
}
