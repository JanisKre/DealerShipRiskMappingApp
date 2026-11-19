import { hasEalBasis } from "@shared/estimates";
import { BOUNDARY_UNDO_LIMIT } from "@shared/types";
import { type AppState, type StoreSet } from "./types";
import { DETECTION_BOUNDARY_ATTEMPTS, saveBoundaryDraft } from "./runtime";
import { withoutKey, withChange } from "./helpers";

/** Lot boundaries: edit, confirm, undo, revert, and the recount that follows. */
export function boundaryActions(
  set: StoreSet,
  get: () => AppState,
): Pick<
  AppState,
  | "updateBoundary"
  | "updateBoundaryAndRescore"
  | "updateDetectionForBoundary"
  | "markReviewed"
  | "confirmBoundary"
  | "saveBoundaryEdit"
  | "undoBoundaryEdit"
  | "revertBoundaryToDefault"
> {
  return {
    updateBoundary: (id, boundary) =>
      set((s) => {
        const copy = s.dealerships.map((d) =>
          d.id === id ? { ...d, boundary } : d,
        );
        return { dealerships: copy };
      }),

    updateBoundaryAndRescore: async (id, boundary) => {
      const before = get().dealerships.find((x) => x.id === id);
      if (!before?.boundary) return;
      // A reviewer's earlier change (a manual edit, or a confirmed choice of
      // another suggestion) must not become the revert target: keep the
      // original automatic boundary across several changes.
      const reviewed =
        before.boundary.source === "manual" ||
        before.boundary.confirmedAt != null;
      const baseBoundary = reviewed
        ? (before.boundaryBeforeManualEdit ?? before.boundary)
        : before.boundary;

      // 1) Write the boundary + area back immediately so it's visible and keep
      // the first non-manual boundary as the durable revert target.
      set((s) => ({
        dealerships: s.dealerships.map((d) =>
          d.id === id
            ? {
                ...d,
                boundary,
                boundaryBeforeManualEdit: baseBoundary,
              }
            : d,
        ),
        boundaryEditIds: s.boundaryEditIds.includes(id)
          ? s.boundaryEditIds
          : [...s.boundaryEditIds, id],
        boundaryHistory: {
          ...s.boundaryHistory,
          [id]: [...(s.boundaryHistory[id] ?? []), before.boundary!].slice(
            -BOUNDARY_UNDO_LIMIT,
          ),
        },
      }));
      const d = get().dealerships.find((x) => x.id === id);
      if (!d) return;
      set((s) => ({
        pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.includes(id)
          ? s.pendingBoundaryDetectionIds
          : [...s.pendingBoundaryDetectionIds, id],
        detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
      }));
      // 2) Recompute risk with the new area (capacity/utilisation/EAL).
      try {
        const risk = await window.api.scoreRisk(
          d.lat,
          d.lon,
          d.assetValue,
          d.detection,
          boundary,
          get().parameters,
          d.natCat,
          d.hailZone,
        );
        const latest = get().dealerships.find((x) => x.id === id);
        if (latest) get().upsertDealership({ ...latest, risk });
      } catch (err) {
        console.error(`Rescoring after boundary edit failed (${id}):`, err);
      }
      await saveBoundaryDraft(get);
    },

    updateDetectionForBoundary: async (id) => {
      const d = get().dealerships.find((x) => x.id === id);
      if (!d?.boundary) return;
      if (get().detectionUpdateIds.includes(id)) return;

      set((s) => ({
        detectionUpdateIds: [...s.detectionUpdateIds, id],
        detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
      }));
      try {
        // The boundary may be edited again while the detection runs; a count
        // for the outline it replaced must not be stored as the current one.
        let boundary = d.boundary;
        for (let attempt = 1; ; attempt++) {
          const detected = await window.api.detectVehicles(
            d.lat,
            d.lon,
            boundary,
            get().parameters,
          );
          const before = get().dealerships.find((x) => x.id === id);
          if (!before?.boundary) return;
          if (before.boundary.polygon !== boundary.polygon) {
            if (attempt >= DETECTION_BOUNDARY_ATTEMPTS) return;
            boundary = before.boundary;
            continue;
          }
          // Manual counts are read now: they may have been set meanwhile.
          const manual = before.detection;
          const detection =
            manual?.manualVehicleCount == null
              ? detected
              : {
                  ...detected,
                  manualVehicleCount: manual.manualVehicleCount,
                  manualVehiclePoints: manual.manualVehiclePoints,
                  manualVehicleRemovedPoints: manual.manualVehicleRemovedPoints,
                };
          const risk = await window.api.scoreRisk(
            d.lat,
            d.lon,
            d.assetValue,
            detection,
            boundary,
            get().parameters,
            d.natCat,
            d.hailZone,
          );
          const current = get().dealerships.find((x) => x.id === id);
          if (!current?.boundary) return;
          if (current.boundary.polygon !== boundary.polygon) {
            if (attempt >= DETECTION_BOUNDARY_ATTEMPTS) return;
            boundary = current.boundary;
            continue;
          }
          get().upsertDealership({ ...current, detection, risk });
          set((s) => ({
            pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.filter(
              (pendingId) => pendingId !== id,
            ),
            detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
          }));
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `Vehicle detection after boundary edit failed (${id}):`,
          err,
        );
        set((s) => ({
          detectionUpdateErrors: { ...s.detectionUpdateErrors, [id]: message },
        }));
      } finally {
        set((s) => ({
          detectionUpdateIds: s.detectionUpdateIds.filter(
            (runningId) => runningId !== id,
          ),
        }));
      }
    },

    markReviewed: async (id) => {
      const d = get().dealerships.find((x) => x.id === id);
      if (!d) return;
      get().upsertDealership(withChange(d, { kind: "reviewed" }));
      await get().saveSession();
    },

    confirmBoundary: async (id) => {
      const d = get().dealerships.find((x) => x.id === id);
      if (!d?.boundary) return;
      const boundary = {
        ...d.boundary,
        confirmedAt: new Date().toISOString(),
        reviewRequired: false,
      };
      get().upsertDealership(
        withChange(
          { ...d, boundary },
          {
            kind: "boundaryConfirmed",
            value: boundary.provider ?? boundary.source,
            area: Math.round(boundary.areaSqm),
          },
        ),
      );
      // Evidence limitations depend on the review flag, so rescore.
      try {
        const risk = await window.api.scoreRisk(
          d.lat,
          d.lon,
          d.assetValue,
          d.detection,
          boundary,
          get().parameters,
          d.natCat,
          d.hailZone,
        );
        const latest = get().dealerships.find((x) => x.id === id);
        if (latest) get().upsertDealership({ ...latest, risk });
      } catch (err) {
        console.error(
          `Rescoring after boundary confirmation failed (${id}):`,
          err,
        );
      }
      await get()
        .saveSession()
        .catch((err: unknown) => {
          console.error("Saving boundary confirmation failed:", err);
        });
    },

    saveBoundaryEdit: async (id) => {
      if (!get().boundaryEditIds.includes(id)) return;
      if (get().detectionUpdateIds.includes(id)) return;
      // Persist the edited boundary first so it survives a failing detection.
      await get().saveSession();
      await get().updateDetectionForBoundary(id);
      if (get().detectionUpdateErrors[id]) return;
      const saved = get().dealerships.find((d) => d.id === id);
      if (saved?.boundary) {
        // The count before: the last logged one (analysis or earlier edit).
        const before = [...(saved.history ?? [])]
          .reverse()
          .find((change) => change.to != null)?.to;
        set({
          boundaryImpact: {
            id,
            name: saved.name,
            vehiclesBefore: before ?? null,
            vehiclesAfter: saved.detection?.vehicleCount ?? null,
            eal: hasEalBasis(saved) ? (saved.risk?.eal ?? null) : null,
            at: Date.now(),
          },
        });
        get().upsertDealership(
          withChange(saved, {
            kind: "boundaryChanged",
            value: saved.boundary.provider ?? saved.boundary.source,
            area: Math.round(saved.boundary.areaSqm),
            ...(saved.detection ? { to: saved.detection.vehicleCount } : {}),
          }),
        );
      }
      // Close the edit before saving, so it is not stored as still open.
      set((s) => ({
        boundaryEditIds: s.boundaryEditIds.filter((editId) => editId !== id),
      }));
      await get().saveSession();
    },

    undoBoundaryEdit: async (id) => {
      const current = get().dealerships.find((d) => d.id === id);
      const history = get().boundaryHistory[id] ?? [];
      const previous = history.at(-1);
      if (!current || !previous) return;

      const remaining = history.slice(0, -1);
      const baseBoundary =
        previous.source === "manual"
          ? current.boundaryBeforeManualEdit
          : undefined;
      set((s) => ({
        dealerships: s.dealerships.map((d) =>
          d.id === id
            ? {
                ...d,
                boundary: previous,
                boundaryBeforeManualEdit: baseBoundary,
              }
            : d,
        ),
        boundaryHistory: { ...s.boundaryHistory, [id]: remaining },
        boundaryEditIds: s.boundaryEditIds.includes(id)
          ? s.boundaryEditIds
          : [...s.boundaryEditIds, id],
        pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.includes(id)
          ? s.pendingBoundaryDetectionIds
          : [...s.pendingBoundaryDetectionIds, id],
        detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
      }));
      const risk = await window.api.scoreRisk(
        current.lat,
        current.lon,
        current.assetValue,
        current.detection,
        previous,
        get().parameters,
        current.natCat,
        current.hailZone,
      );
      const latest = get().dealerships.find((d) => d.id === id);
      if (latest) get().upsertDealership({ ...latest, risk });
      await saveBoundaryDraft(get);
    },

    revertBoundaryToDefault: async (id) => {
      const current = get().dealerships.find((d) => d.id === id);
      const baseBoundary = current?.boundaryBeforeManualEdit;
      if (!current || !baseBoundary) return;

      set((s) => ({
        dealerships: s.dealerships.map((d) =>
          d.id === id
            ? {
                ...d,
                boundary: baseBoundary,
                boundaryBeforeManualEdit: undefined,
              }
            : d,
        ),
        boundaryHistory: { ...s.boundaryHistory, [id]: [] },
        boundaryEditIds: s.boundaryEditIds.includes(id)
          ? s.boundaryEditIds
          : [...s.boundaryEditIds, id],
        pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.includes(id)
          ? s.pendingBoundaryDetectionIds
          : [...s.pendingBoundaryDetectionIds, id],
        detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
      }));
      const risk = await window.api.scoreRisk(
        current.lat,
        current.lon,
        current.assetValue,
        current.detection,
        baseBoundary,
        get().parameters,
        current.natCat,
        current.hailZone,
      );
      const latest = get().dealerships.find((d) => d.id === id);
      if (latest) get().upsertDealership({ ...latest, risk });
      await saveBoundaryDraft(get);
    },
  };
}
